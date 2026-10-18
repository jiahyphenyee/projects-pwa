// Billing one payment stage: an approved, one-line sales invoice in Xero. The final payment
// is the one exception: it also carries one signed line per variation order not billed
// early (see lib/stageInvoice.mjs), and on success those VOs are recorded as settled on it.
//
// Two calls from the screen. prepareStageBill() builds exactly what would be sent and the
// reasons it cannot be sent yet; the confirm step shows it. billStage() re-runs every check
// on fresh data, verifies the PIN on the server, and only then calls Xero.
//
// What makes it safe to press twice, or retry after an error:
//   - a stage with an xero_invoice_id is never sent again;
//   - the intended number is stored on the stage (status "sending") BEFORE the Xero call,
//     so a retry after a lost response looks that number up in Xero first and adopts the
//     invoice if it is this stage's, instead of creating a second one;
//   - the call carries an Idempotency-Key, so Xero itself returns the first invoice for a
//     repeated request;
//   - presses on the same stage are serialised in this process.
//
// Dry run (XERO_DRY_RUN anything but "false") writes NOTHING: the stage stays unbilled and
// the screen shows the payload that would have been sent.

import { readForBilling, readVoForBilling, writeStage, writeQuoteRow, writeQuoteRows, readClientContact, getConfig } from '@/lib/quotes';
import { verifyPin } from '@/lib/pin';
import { can, PERMISSIONS } from '@/lib/roles.mjs';
import {
  isDryRun, getXeroContact, listInvoiceNumbers, findInvoiceByNumber, createInvoice, attachToInvoice, validationMessages,
} from '@/lib/xero';
import { buildQuotePdf } from '@/lib/quoteDocument';
import { invoicePrefix, nextInvoiceNumber, addDays } from '@/lib/invoiceNumbers.mjs';
import { buildStageInvoice, matchesStageInvoice } from '@/lib/stageInvoice.mjs';
import { buildVoInvoice } from '@/lib/voInvoice.mjs';
import { todaySingapore, nowIsoSingapore } from '@/lib/dates';

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

/**
 * Everything needed to bill a stage, plus `blockers`: every reason it cannot be billed now,
 * in words for the screen. Reads Xero (contact, numbers in use) but never writes.
 */
export async function prepareStageBill({ quoteId, stageId, skipNumbers = [] }) {
  const data = await readForBilling(quoteId);
  if (!data) return fail(404, `No quote with id ${quoteId}`);
  const { quote, project, schedule, vos, usedNumbers } = data;
  const stage = schedule.stages.find(s => s.id === stageId);
  if (!stage) return fail(404, `No stage ${stageId} on ${quoteId}`);

  // The VOs this invoice settles, as full rows: recorded on success. Only the final has any.
  const settlingIds = new Set((stage.isFinal && !stage.xeroInvoiceId ? stage.settling : []).map(v => v.id));
  const settling = vos.filter(v => settlingIds.has(v.id));

  const blockers = [];
  if (quote.kind !== 'quote') blockers.push('Variation orders are billed from the variation order itself.');
  if (stage.xeroInvoiceId) blockers.push(`Already billed as ${stage.xeroInvoiceNumber || stage.xeroInvoiceId}.`);
  if (schedule.overAllocated) blockers.push(`The stages add up to ${schedule.sharesTotal}%, more than 100%. Reduce a share first.`);
  if (schedule.finalNegative) {
    blockers.push(stage.isFinal && stage.balance >= 0
      ? 'The omissions come to more than what is left to bill, so the final invoice would be negative. Fix the quote first.'
      : 'The contract sum is now less than what has already been billed. Fix the quote first.');
  }
  if (!(stage.amount > 0)) blockers.push('This stage is $0.00. Give it a share of the contract sum first.');
  // A VO whose own invoice may or may not exist cannot also go onto this one
  for (const vo of settling.filter(v => v.status === 'sending')) {
    blockers.push(`VO${vo.voNumber} has an unfinished billing attempt. Open it and press Retry bill first, so the app can check Xero.`);
  }

  const [contact, accountCode, dueDays, trackingOption] = await Promise.all([
    readClientContact(project?.clientId),
    getConfig('XERO_SALES_ACCOUNT_CODE'),
    getConfig('INVOICE_DUE_DAYS'),
    getConfig('STAGE_TRACKING_OPTION'),
  ]);
  if (!project?.clientName) {
    blockers.push('This project has no client. Set its client before billing.');
  } else if (!contact) {
    blockers.push(`The client "${project.clientName}" is not in the Contacts tab.`);
  } else if (!contact.xeroContactId) {
    blockers.push(`"${contact.name}" is not linked to a Xero contact. Put its Xero ContactID in the Contacts tab, column H (xero_contact_id).`);
  }
  if (!String(accountCode || '').trim()) blockers.push('XERO_SALES_ACCOUNT_CODE is not set in System config.');

  let xeroContact = null;
  if (contact?.xeroContactId) {
    xeroContact = await getXeroContact(contact.xeroContactId);
    if (!xeroContact) blockers.push(`No Xero contact has the ContactID stored for "${contact.name}". Check column H of the Contacts tab.`);
    else if (xeroContact.ContactStatus && xeroContact.ContactStatus !== 'ACTIVE') blockers.push(`The Xero contact "${xeroContact.Name}" is ${xeroContact.ContactStatus.toLowerCase()}.`);
  }

  const date = todaySingapore();
  const dueDate = addDays(date, Number(dueDays) || 14);
  // A number stored by an earlier attempt is reused: that is what lets a retry find it
  let invoiceNumber = stage.xeroInvoiceNumber;
  if (!invoiceNumber || skipNumbers.includes(invoiceNumber) || !invoiceNumber.startsWith(invoicePrefix(date))) {
    const inXero = await listInvoiceNumbers(invoicePrefix(date));
    invoiceNumber = nextInvoiceNumber(date, [...usedNumbers, ...inXero], skipNumbers);
  }

  let invoice = null;
  if (!blockers.length) {
    invoice = buildStageInvoice({
      contactId: contact.xeroContactId, invoiceNumber, date, dueDate,
      reference: project.address, accountCode: String(accountCode).trim(),
      trackingOption: String(trackingOption || '').trim(), stage, contractSum: quote.contractSum,
    });
  }

  return {
    ok: true,
    dryRun: isDryRun(),
    blockers,
    quote, project, stage, settling, contact, xeroContactName: xeroContact?.Name || '',
    preview: {
      quoteId, stageId, quoteVersion: quote.currentVersion,
      invoiceNumber, date, dueDate, amount: stage.amount,
      client: xeroContact?.Name || contact?.name || project?.clientName || '',
      reference: project?.address || '',
      description: invoice?.LineItems[0].Description || '',
      // The final payment with VOs to settle is a multi-line invoice: the confirm step lists them
      ...(settling.length ? { lines: invoice?.LineItems || [] } : {}),
      accountCode: String(accountCode || '').trim(),
    },
    invoice,
  };
}

const inFlight = new Map();   // stageId → promise, so double presses in one process queue

export function billStage(args) {
  const key = args.stageId;
  const run = (inFlight.get(key) || Promise.resolve()).catch(() => {})
    .then(() => billStageOnce(args))
    .then(async result => (result.ok && result.billed ? { ...result, pdf: await attachQuotePdfOnce(args.quoteId) } : result));
  inFlight.set(key, run);
  run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
  return run;
}

/**
 * `expected` is what the person confirmed: { amount, quoteVersion, invoiceNumber }. If the
 * quote has changed since, nothing is sent and they are asked to look again.
 */
async function billStageOnce({ quoteId, stageId, pin, expected = {} }) {
  const user = await verifyPin(pin);
  if (!user) return fail(401, 'That PIN is not right.');
  if (!can(user.role, PERMISSIONS.QUOTES)) return fail(403, `${user.name} cannot bill to Xero.`);

  let prep = await prepareStageBill({ quoteId, stageId });
  if (!prep.ok) return prep;
  const { stage, settling, contact, project } = prep;

  if (stage.xeroInvoiceId) {
    return { ok: true, alreadyBilled: true, stage, message: `Already billed as ${stage.xeroInvoiceNumber}.` };
  }
  if (prep.blockers.length) return fail(409, prep.blockers.join(' '), { blockers: prep.blockers });
  if (Math.round(expected.amount * 100) !== Math.round(prep.preview.amount * 100)
      || expected.quoteVersion !== prep.preview.quoteVersion) {
    return fail(409, 'The quote has changed since you opened this. Review the invoice again before billing.', { changed: true });
  }

  if (prep.dryRun) {
    return { ok: true, dryRun: true, invoice: prep.invoice, preview: prep.preview };
  }

  const want = { contactId: contact.xeroContactId, amount: stage.amount, reference: project.address };

  // A number stored by an earlier attempt: did that attempt reach Xero after all?
  if (stage.xeroInvoiceNumber) {
    const found = await findInvoiceByNumber(stage.xeroInvoiceNumber);
    if (found && matchesStageInvoice(found, want)) return recordBilled(stage, found, user, stage.quoteVersion ?? prep.quote.currentVersion, settling);
    if (found) prep = await prepareStageBill({ quoteId, stageId, skipNumbers: [stage.xeroInvoiceNumber] });
  }

  // Up to two attempts: the second only if Xero says the number is taken
  const skip = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = prep.preview.invoiceNumber;
    await writeStage({ ...stripComputed(stage), xeroInvoiceNumber: number, xeroSyncStatus: 'sending', quoteVersion: prep.quote.currentVersion });
    try {
      const { invoice } = await createInvoice(prep.invoice, { idempotencyKey: `${stage.id}:${number}` });
      return recordBilled(stage, invoice, user, prep.quote.currentVersion, settling);
    } catch (err) {
      const messages = validationMessages(err);
      const duplicate = messages.some(m => /must be unique|already exists/i.test(m));
      if (duplicate && attempt === 0) {
        const found = await findInvoiceByNumber(number);
        if (found && matchesStageInvoice(found, want)) return recordBilled(stage, found, user, prep.quote.currentVersion, settling);
        skip.push(number);
        prep = await prepareStageBill({ quoteId, stageId, skipNumbers: skip });
        if (!prep.ok || prep.blockers.length) break;
        continue;
      }
      await writeStage({ ...stripComputed(stage), xeroInvoiceNumber: number, xeroSyncStatus: 'error', quoteVersion: prep.quote.currentVersion });
      return fail(502, `Xero did not create the invoice: ${messages.join(' ') || err.message}. The stage is still unbilled; you can try again.`);
    }
  }
  return fail(502, 'Xero rejected the invoice number twice. The stage is still unbilled; try again.');
}

/** The stage row fields only, without the amounts describeSchedule adds. */
function stripComputed(stage) {
  const { amount, billed, balance, voAdjustment, settling, ...row } = stage;
  void amount; void billed; void balance; void voAdjustment; void settling;
  // The final stage's share is computed (100% minus the rest), never stored
  if (row.isFinal) row.sharePct = null;
  return row;
}

/**
 * `settling` are the VOs whose lines are on this invoice (the final payment only). Each is
 * recorded as billed by it — the same fields as a VO billed on its own, plus the stage —
 * so it is locked, counted as billed, and never put on another invoice.
 */
async function recordBilled(stage, invoice, user, quoteVersion, settling = []) {
  const now = nowIsoSingapore();
  const billed = {
    ...stripComputed(stage),
    // The lines version this invoice was made from. Prune keeps it while a billed stage
    // names it; without it, a later save could tidy away the version that was invoiced.
    quoteVersion,
    billedAmount:      stage.amount,
    billedAt:          now,
    billedBy:          user.name,
    xeroInvoiceId:     invoice.InvoiceID,
    xeroInvoiceNumber: invoice.InvoiceNumber,
    xeroSyncStatus:    'billed',
  };
  try {
    await writeStage(billed);
  } catch (err) {
    // The invoice exists in Xero. Say so plainly: a retry will find it by number and adopt
    // it, so nothing is duplicated, but the sheet does not show it yet.
    return fail(500, `Invoice ${invoice.InvoiceNumber} WAS created in Xero, but the sheet could not be updated (${err.message}). Press Bill now again to record it; it will not create a second invoice.`);
  }
  const result = { ok: true, billed: true, stage: billed, invoiceNumber: invoice.InvoiceNumber, invoiceId: invoice.InvoiceID, settled: settling.map(v => v.id) };
  if (settling.length) {
    try {
      await writeQuoteRows(settling.map(vo => ({
        ...vo, status: 'billed', settledOnStageId: stage.id,
        billedAmount: vo.contractSum, billedAt: now, billedBy: user.name,
        xeroInvoiceId: invoice.InvoiceID, xeroInvoiceNumber: invoice.InvoiceNumber,
      })));
    } catch (err) {
      // The stage is recorded, so a retry says "already billed" and will not resend; the
      // VOs just do not show as settled yet. Name them so it can be put right by hand.
      result.voWarning = `Invoice ${invoice.InvoiceNumber} is recorded, but ${settling.map(v => `VO${v.voNumber}`).join(', ')} could not be marked as settled on it (${err.message}). Mark them in the Quotes tab by hand.`;
    }
  }
  return result;
}



// ── Variation orders ─────────────────────────────────────────────────────────────────
//
// A VO is billed in full as one invoice. Its billed state lives on its Quotes row
// (xero_invoice_id, xero_invoice_number, billed_*), with Quotes.status carrying
// sending / error / billed the way a stage's xero_sync_status does. The same protections
// apply: never resend a billed VO, store the number before the call, look it up on retry,
// Idempotency-Key, one retry on a duplicate number.

/** Who the client is in Xero, and every reason they cannot be billed. Shared by both kinds. */
async function clientCheck(project) {
  const blockers = [];
  const contact = await readClientContact(project?.clientId);
  if (!project?.clientName) blockers.push('This project has no client. Set its client before billing.');
  else if (!contact) blockers.push(`The client "${project.clientName}" is not in the Contacts tab.`);
  else if (!contact.xeroContactId) blockers.push(`"${contact.name}" is not linked to a Xero contact. Put its Xero ContactID in the Contacts tab, column H (xero_contact_id).`);
  let xeroContact = null;
  if (contact?.xeroContactId) {
    xeroContact = await getXeroContact(contact.xeroContactId);
    if (!xeroContact) blockers.push(`No Xero contact has the ContactID stored for "${contact.name}". Check column H of the Contacts tab.`);
    else if (xeroContact.ContactStatus && xeroContact.ContactStatus !== 'ACTIVE') blockers.push(`The Xero contact "${xeroContact.Name}" is ${xeroContact.ContactStatus.toLowerCase()}.`);
  }
  return { blockers, contact, xeroContact };
}

export async function prepareVoBill({ quoteId, skipNumbers = [] }) {
  const data = await readVoForBilling(quoteId);
  if (!data) return fail(404, `No variation order ${quoteId}`);
  const { quote, project, lines, categories, usedNumbers } = data;
  if (quote.kind !== 'vo') return fail(400, `${quoteId} is the main quote; its stages are billed from the payment schedule`);

  const blockers = [];
  if (quote.xeroInvoiceId) {
    blockers.push(quote.settledOnStageId
      ? `Already settled on the final payment invoice ${quote.xeroInvoiceNumber || quote.xeroInvoiceId}.`
      : `Already billed as ${quote.xeroInvoiceNumber || quote.xeroInvoiceId}.`);
  }
  if (!lines.some(l => l.kind === 'item')) blockers.push('This variation order has no lines.');
  // Only an addition can be billed on its own; an omission (or a VO netting to $0) settles
  // on the final payment invoice, where a negative line is fine but a negative total is not
  if (!(quote.contractSum > 0)) blockers.push('This variation order comes to $0.00 or less, so it cannot be invoiced on its own. It settles on the final payment invoice.');

  const [client, accountCode, dueDays] = await Promise.all([
    clientCheck(project), getConfig('XERO_SALES_ACCOUNT_CODE'), getConfig('INVOICE_DUE_DAYS'),
  ]);
  blockers.push(...client.blockers);
  if (!String(accountCode || '').trim()) blockers.push('XERO_SALES_ACCOUNT_CODE is not set in System config.');

  const date = todaySingapore();
  const dueDate = addDays(date, Number(dueDays) || 14);
  let invoiceNumber = quote.xeroInvoiceNumber;
  if (!invoiceNumber || skipNumbers.includes(invoiceNumber) || !invoiceNumber.startsWith(invoicePrefix(date))) {
    const inXero = await listInvoiceNumbers(invoicePrefix(date));
    invoiceNumber = nextInvoiceNumber(date, [...usedNumbers, ...inXero], skipNumbers);
  }

  const optionByCode = new Map(categories.map(c => [c.code, c.xeroOption]));
  let built = null;
  if (!blockers.length) {
    try {
      built = buildVoInvoice({
        contactId: client.contact.xeroContactId, invoiceNumber, date, dueDate,
        reference: project.address, accountCode: String(accountCode).trim(), voNumber: quote.voNumber,
        lines, discountMode: quote.discountMode, discountValue: quote.discountValue,
        trackingFor: code => optionByCode.get(code) || '',
      });
      // The saved contract sum and the lines must agree too, or something was edited by hand
      if (Math.round(built.contractSum * 100) !== Math.round(quote.contractSum * 100)) {
        blockers.push(`The saved total ($${quote.contractSum.toFixed(2)}) does not match the lines ($${built.contractSum.toFixed(2)}). Open and save the variation order again.`);
        built = null;
      }
    } catch (err) {
      blockers.push(err.message);
    }
  }

  return {
    ok: true,
    dryRun: isDryRun(),
    blockers,
    quote, project, contact: client.contact,
    preview: {
      quoteId, quoteVersion: quote.currentVersion, voNumber: quote.voNumber,
      invoiceNumber, date, dueDate, amount: quote.contractSum,
      client: client.xeroContact?.Name || client.contact?.name || project?.clientName || '',
      reference: project?.address || '',
      lines: built ? built.invoice.LineItems : [],
      accountCode: String(accountCode || '').trim(),
    },
    invoice: built?.invoice || null,
  };
}

export function billVo(args) {
  const key = args.quoteId;
  const run = (inFlight.get(key) || Promise.resolve()).catch(() => {}).then(() => billVoOnce(args));
  inFlight.set(key, run);
  run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
  return run;
}

async function billVoOnce({ quoteId, pin, expected = {} }) {
  const user = await verifyPin(pin);
  if (!user) return fail(401, 'That PIN is not right.');
  if (!can(user.role, PERMISSIONS.QUOTES)) return fail(403, `${user.name} cannot bill to Xero.`);

  let prep = await prepareVoBill({ quoteId });
  if (!prep.ok) return prep;
  const { quote, contact, project } = prep;
  if (quote.xeroInvoiceId) return { ok: true, alreadyBilled: true, message: `Already billed as ${quote.xeroInvoiceNumber}.` };
  if (prep.blockers.length) return fail(409, prep.blockers.join(' '), { blockers: prep.blockers });
  if (Math.round(expected.amount * 100) !== Math.round(prep.preview.amount * 100) || expected.quoteVersion !== prep.preview.quoteVersion) {
    return fail(409, 'The variation order has changed since you opened this. Review the invoice again before billing.', { changed: true });
  }
  if (prep.dryRun) return { ok: true, dryRun: true, invoice: prep.invoice, preview: prep.preview };

  const want = { contactId: contact.xeroContactId, amount: quote.contractSum, reference: project.address };
  const record = invoice => recordVoBilled(quote, invoice, user);

  if (quote.xeroInvoiceNumber) {
    const found = await findInvoiceByNumber(quote.xeroInvoiceNumber);
    if (found && matchesStageInvoice(found, want)) return record(found);
    if (found) prep = await prepareVoBill({ quoteId, skipNumbers: [quote.xeroInvoiceNumber] });
  }

  const skip = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = prep.preview.invoiceNumber;
    await writeQuoteRow({ ...quote, xeroInvoiceNumber: number, status: 'sending' });
    try {
      const { invoice } = await createInvoice(prep.invoice, { idempotencyKey: `${quote.id}:${number}` });
      return record(invoice);
    } catch (err) {
      const messages = validationMessages(err);
      const duplicate = messages.some(m => /must be unique|already exists/i.test(m));
      if (duplicate && attempt === 0) {
        const found = await findInvoiceByNumber(number);
        if (found && matchesStageInvoice(found, want)) return record(found);
        skip.push(number);
        prep = await prepareVoBill({ quoteId, skipNumbers: skip });
        if (!prep.ok || prep.blockers.length) break;
        continue;
      }
      await writeQuoteRow({ ...quote, xeroInvoiceNumber: number, status: 'error' });
      return fail(502, `Xero did not create the invoice: ${messages.join(' ') || err.message}. The variation order is still unbilled; you can try again.`);
    }
  }
  return fail(502, 'Xero rejected the invoice number twice. The variation order is still unbilled; try again.');
}

async function recordVoBilled(quote, invoice, user) {
  const billed = {
    ...quote,
    status:            'billed',
    billedAmount:      quote.contractSum,
    billedAt:          nowIsoSingapore(),
    billedBy:          user.name,
    xeroInvoiceId:     invoice.InvoiceID,
    xeroInvoiceNumber: invoice.InvoiceNumber,
  };
  try {
    await writeQuoteRow(billed);
  } catch (err) {
    return fail(500, `Invoice ${invoice.InvoiceNumber} WAS created in Xero, but the sheet could not be updated (${err.message}). Press Bill now again to record it; it will not create a second invoice.`);
  }
  return { ok: true, billed: true, invoiceNumber: invoice.InvoiceNumber, invoiceId: invoice.InvoiceID };
}

// ── The quote PDF on the first stage invoice ─────────────────────────────────────────

/**
 * Attach the current quote PDF to the invoice of the first stage billed, once per quote.
 * "Once" is recorded on that stage as pdf_attached_at; if any stage of the quote has it,
 * nothing is sent. Never fails billing: the invoice already exists, so a problem here is
 * reported for a retry rather than thrown.
 *
 * Returns { attached, invoiceNumber } | { skipped } | { error }.
 */
export async function attachQuotePdfOnce(quoteId) {
  try {
    const data = await readForBilling(quoteId);
    if (!data) return { error: `No quote with id ${quoteId}` };
    if (data.quote.kind !== 'quote') return { skipped: 'Variation orders do not carry the quote PDF.' };
    if (data.stages.some(s => s.pdfAttachedAt)) return { skipped: 'The quote PDF is already on an earlier invoice.' };
    const first = data.stages
      .filter(s => s.xeroInvoiceId && !String(s.xeroInvoiceId).startsWith('DRYRUN'))
      .sort((a, b) => String(a.billedAt).localeCompare(String(b.billedAt)))[0];
    if (!first) return { skipped: 'No stage has been billed yet.' };

    const pdf = await buildQuotePdf(quoteId);
    const sent = await attachToInvoice(first.xeroInvoiceId, pdf.fileName, pdf.bytes);
    if (sent.dryRun) return { skipped: 'Dry run: the PDF was not attached.' };
    await writeStage({ ...first, pdfAttachedAt: nowIsoSingapore() });
    return { attached: true, invoiceNumber: first.xeroInvoiceNumber };
  } catch (err) {
    console.error(`[billing] attaching the quote PDF to ${quoteId} failed:`, err.message);
    return { error: `The invoice was created, but the quote PDF was not attached: ${err.message}. Use "Attach quote PDF" on the payment schedule to try again.` };
  }
}

/** The retry for a failed attachment, behind the same PIN check as billing. */
export async function attachQuotePdfWithPin({ quoteId, pin }) {
  const user = await verifyPin(pin);
  if (!user) return fail(401, 'That PIN is not right.');
  if (!can(user.role, PERMISSIONS.QUOTES)) return fail(403, `${user.name} cannot bill to Xero.`);
  const result = await attachQuotePdfOnce(quoteId);
  if (result.error) return fail(502, result.error);
  return { ok: true, ...result };
}
