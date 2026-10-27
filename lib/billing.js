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

import { readForBilling, readVoForBilling, writeStage, writeStages, readQuoteStages, writeQuoteRow, writeQuoteRows, readClientContact, getConfig } from '@/lib/quotes';
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

import { acceptanceBlocker, attemptInFlight, settlingBlocker } from '@/lib/clientAcceptance.mjs';
import { parseStageIds, selectStages, stagesLabel } from '@/lib/stageSelection.mjs';
import { sumAmounts } from '@/lib/quoteMaths.mjs';

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

/**
 * Everything needed to bill one stage, or several together on one invoice, plus `blockers`:
 * every reason it cannot be billed now, in words for the screen. Reads Xero (contact,
 * numbers in use) but never writes. `stageIds` (array or "ST-1,ST-2") or `stageId`.
 */
export async function prepareStageBill({ quoteId, stageId, stageIds, skipNumbers = [] }) {
  const ids = parseStageIds(stageIds ?? stageId);
  if (!ids.length) return fail(400, 'Choose at least one stage to bill');
  const data = await readForBilling(quoteId);
  if (!data) return fail(404, `No quote with id ${quoteId}`);
  const { quote, project, schedule, vos, usedNumbers } = data;
  const pick = selectStages(schedule.stages, ids);
  if (pick.missing.length) return fail(404, `No stage ${pick.missing.join(', ')} on ${quoteId}`);
  const { stages, retryNumber } = pick;
  const label = stagesLabel(stages);
  const final = stages.find(s => s.isFinal);

  // The VOs this invoice settles, as full rows: recorded on success. Only the final has any.
  const settlingIds = new Set((final && !final.xeroInvoiceId ? final.settling : []).map(v => v.id));
  const settling = vos.filter(v => settlingIds.has(v.id));

  const blockers = [];
  if (quote.kind !== 'quote') blockers.push('Variation orders are billed from the variation order itself.');
  if (pick.problem) blockers.push(pick.problem);
  // No invoice before the client accepts. A quote already billed before this rule keeps going.
  // A retry of an earlier attempt (`sending`, or `error` with its number kept) is never
  // blocked: the invoice may already exist in Xero, and the retry is what finds it.
  const retrying = !!retryNumber;
  const accepted = acceptanceBlocker(quote, { anyBilled: schedule.stages.some(s => s.xeroInvoiceId) });
  if (accepted && !retrying) blockers.push(accepted);
  // Every VO going onto the final invoice needs the client's yes too
  if (!retrying) for (const vo of settling) {
    const why = settlingBlocker(vo);
    if (why) blockers.push(why);
  }
  for (const st of stages.filter(x => x.xeroInvoiceId)) blockers.push(`${st.name} is already billed as ${st.xeroInvoiceNumber || st.xeroInvoiceId}.`);
  if (schedule.overAllocated) blockers.push(`The stages add up to ${schedule.sharesTotal}%, more than 100%. Reduce a share first.`);
  if (schedule.finalNegative) {
    blockers.push(final && final.balance >= 0
      ? 'The omissions come to more than what is left to bill, so the final invoice would be negative. Fix the quote first.'
      : 'The contract sum is now less than what has already been billed. Fix the quote first.');
  }
  for (const st of stages.filter(x => !(x.amount > 0))) blockers.push(`${st.name} is $0.00. Give it a share of the contract sum first.`);
  // A VO whose own invoice may or may not exist cannot also go onto this one
  for (const vo of settling.filter(attemptInFlight)) {
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
  let invoiceNumber = retryNumber;
  if (!invoiceNumber || skipNumbers.includes(invoiceNumber) || !invoiceNumber.startsWith(invoicePrefix(date))) {
    const inXero = await listInvoiceNumbers(invoicePrefix(date));
    invoiceNumber = nextInvoiceNumber(date, [...usedNumbers, ...inXero], skipNumbers);
  }

  let invoice = null;
  if (!blockers.length) {
    invoice = buildStageInvoice({
      contactId: contact.xeroContactId, invoiceNumber, date, dueDate,
      reference: project.address, accountCode: String(accountCode).trim(),
      trackingOption: String(trackingOption || '').trim(), stages, contractSum: quote.contractSum,
    });
  }
  const amount = sumAmounts(stages.map(st => st.amount || 0));

  return {
    ok: true,
    dryRun: isDryRun(),
    blockers,
    quote, project, stage: stages[0], stages, retryNumber, settling, contact, xeroContactName: xeroContact?.Name || '',
    preview: {
      quoteId, stageId: stages[0]?.id, stageIds: stages.map(st => st.id), label, quoteVersion: quote.currentVersion,
      invoiceNumber, date, dueDate, amount,
      client: xeroContact?.Name || contact?.name || project?.clientName || '',
      reference: project?.address || '',
      description: invoice?.LineItems[0].Description || '',
      // Several lines (stages billed together, or the final with VOs): the confirm step lists them
      ...(invoice && invoice.LineItems.length > 1 ? { lines: invoice.LineItems } : {}),
      accountCode: String(accountCode || '').trim(),
    },
    invoice,
  };
}

// Presses on the same quote queue in this process: stages billed together overlap, so the
// lock is per quote, not per stage. Across server instances, the check in claimStages()
// does the same job.
const inFlight = new Map();   // quoteId → promise

export function billStage(args) {
  const key = args.quoteId;
  const run = (inFlight.get(key) || Promise.resolve()).catch(() => {})
    .then(() => billStageOnce(args))
    .then(async result => (result.ok && result.billed ? { ...result, pdf: await attachQuotePdfOnce(args.quoteId) } : result));
  inFlight.set(key, run);
  run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
  return run;
}

const CLAIM_SETTLE_MS = 2500;
const pause = ms => new Promise(r => setTimeout(r, ms));
const newToken = () => Math.random().toString(36).slice(2, 10);

/**
 * Claim the stages for one attempt before Xero is called, so two server instances do not
 * both send them. `prior` is each stage as this attempt last saw it (id → row).
 * Sheets has no compare-and-set, so this is timing-based: it holds as long as each claim's
 * write lands within the pause of its read (seconds; a request takes well under one). Two
 * people billing the SAME stages are also covered by Xero's Idempotency-Key.
 *   1. Re-read now; refuse if any stage moved on since (billed, or claimed by someone else).
 *   2. Write "sending:<token>" and the number onto the fresh rows.
 *   3. Pause, read back: if any row no longer carries our token, someone else claimed it in
 *      between. Give up before Xero, and put back the rows still ours.
 * Returns { held } (the rows as written) or { error }.
 */
async function claimStages(quoteId, ids, prior, number, quoteVersion) {
  const busy = list => `${stagesLabel(list)} ${list.length === 1 ? 'is' : 'are'} being billed from another phone right now, or ${list.length === 1 ? 'was' : 'were'} just billed. Nothing was sent. Refresh and check before trying again.`;
  const before = await readQuoteStages(quoteId);
  const fresh = ids.map(id => before.find(x => x.id === id));
  const moved = fresh.filter((f, i) => {
    const was = prior.get(ids[i]);
    return !f || f.xeroInvoiceId
      || (f.xeroInvoiceNumber || '') !== (was?.xeroInvoiceNumber || '')
      || (f.xeroSyncStatus || '') !== (was?.xeroSyncStatus || '');
  });
  if (moved.length) return { error: busy(moved.filter(Boolean).length ? moved.filter(Boolean) : fresh.filter(Boolean)) };

  const token = `sending:${newToken()}`;
  const held = fresh.map(f => ({ ...f, xeroInvoiceNumber: number, xeroSyncStatus: token, quoteVersion }));
  await writeStages(held);
  await pause(CLAIM_SETTLE_MS);
  const after = await readQuoteStages(quoteId);
  const lost = held.filter(h => {
    const f = after.find(x => x.id === h.id);
    return !f || f.xeroInvoiceId || f.xeroSyncStatus !== token || f.xeroInvoiceNumber !== number;
  });
  if (!lost.length) return { held };
  const stillOurs = fresh.filter(f => !lost.some(l => l.id === f.id));
  if (stillOurs.length) await writeStages(stillOurs);
  return { error: busy(lost) };
}

/**
 * `expected` is what the person confirmed: { amount, quoteVersion }. If the quote has
 * changed since, nothing is sent and they are asked to look again.
 */
async function billStageOnce({ quoteId, stageId, stageIds, pin, expected = {} }) {
  const user = await verifyPin(pin);
  if (!user) return fail(401, 'That PIN is not right.');
  if (!can(user.role, PERMISSIONS.QUOTES)) return fail(403, `${user.name} cannot bill to Xero.`);

  const ids = parseStageIds(stageIds?.length ? stageIds : stageId);
  let prep = await prepareStageBill({ quoteId, stageIds: ids });
  if (!prep.ok) return prep;
  const { stages, settling, contact, project } = prep;

  if (stages.every(st => st.xeroInvoiceId)) {
    return { ok: true, alreadyBilled: true, stage: stages[0], message: `Already billed as ${[...new Set(stages.map(st => st.xeroInvoiceNumber))].join(', ')}.` };
  }
  if (prep.blockers.length) return fail(409, prep.blockers.join(' '), { blockers: prep.blockers });
  if (Math.round(expected.amount * 100) !== Math.round(prep.preview.amount * 100)
      || expected.quoteVersion !== prep.preview.quoteVersion) {
    return fail(409, 'The quote has changed since you opened this. Review the invoice again before billing.', { changed: true });
  }

  if (prep.dryRun) {
    return { ok: true, dryRun: true, invoice: prep.invoice, preview: prep.preview };
  }

  // An invoice found by number is adopted only if it is line for line the one this attempt
  // builds: same contact, reference, total AND the same stage lines. Another stage's invoice
  // with an equal total is never mistaken for this one.
  const wantFor = p => ({ contactId: contact.xeroContactId, amount: p.preview.amount, reference: project.address, lines: p.invoice.LineItems });
  const keyOf = number => `${ids.join('+')}:${number}`;
  let prior = new Map(stages.map(st => [st.id, st]));

  // A number stored by an earlier attempt: did that attempt reach Xero after all?
  if (prep.retryNumber) {
    const found = await findInvoiceByNumber(prep.retryNumber);
    if (found && matchesStageInvoice(found, wantFor(prep))) return recordBilled(stages, found, user, stages[0].quoteVersion ?? prep.quote.currentVersion, settling);
    if (found) prep = await prepareStageBill({ quoteId, stageIds: ids, skipNumbers: [prep.retryNumber] });
    if (!prep.ok || prep.blockers.length) return prep.ok ? fail(409, prep.blockers.join(' '), { blockers: prep.blockers }) : prep;
  }

  // Up to two attempts: the second only if Xero says the number is taken
  const skip = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = prep.preview.invoiceNumber;
    const claim = await claimStages(quoteId, ids, prior, number, prep.quote.currentVersion);
    if (claim.error) return fail(409, claim.error, { changed: true });
    prior = new Map(claim.held.map(h => [h.id, h]));
    try {
      const { invoice } = await createInvoice(prep.invoice, { idempotencyKey: keyOf(number) });
      return recordBilled(stages, invoice, user, prep.quote.currentVersion, settling);
    } catch (err) {
      const messages = validationMessages(err);
      const duplicate = messages.some(m => /must be unique|already exists/i.test(m));
      if (duplicate && attempt === 0) {
        const found = await findInvoiceByNumber(number);
        if (found && matchesStageInvoice(found, wantFor(prep))) return recordBilled(stages, found, user, prep.quote.currentVersion, settling);
        skip.push(number);
        prep = await prepareStageBill({ quoteId, stageIds: ids, skipNumbers: skip });
        if (!prep.ok || prep.blockers.length) {
          // Nothing of ours reached Xero (it refused the number): release the claim
          await releaseClaim(quoteId, claim.held, '');
          return prep.ok ? fail(409, prep.blockers.join(' '), { blockers: prep.blockers }) : prep;
        }
        continue;
      }
      // Xero answered with reasons: it created nothing, so the number is released and the
      // quote can be edited. No answer (timeout, dropped connection): the invoice may exist,
      // so the number is kept and only a retry, which looks it up first, may continue.
      await releaseClaim(quoteId, claim.held, messages.length > 0 ? '' : number);
      return fail(502, `Xero did not create the invoice: ${messages.join(' ') || err.message}. ${stages.length > 1 ? 'The stages are' : 'The stage is'} still unbilled; you can try again.`);
    }
  }
  return fail(502, `Xero rejected the invoice number twice. ${stages.length > 1 ? 'The stages are' : 'The stage is'} still unbilled; try again.`);
}

/**
 * Mark an attempt "error", keeping `number` (outcome unknown) or releasing it (''). Only
 * rows still carrying this attempt's token are touched: a retry that took over meanwhile
 * (and may have recorded the invoice) is never overwritten.
 */
async function releaseClaim(quoteId, held, number) {
  const token = held[0]?.xeroSyncStatus;
  const now = await readQuoteStages(quoteId);
  const ours = held.filter(h => now.find(x => x.id === h.id)?.xeroSyncStatus === token);
  if (ours.length) await writeStages(ours.map(h => ({ ...h, xeroInvoiceNumber: number, xeroSyncStatus: 'error' })));
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
 * Every stage on the invoice is recorded as billed by it: the same invoice ID and number,
 * each with its own amount. `settling` are the VOs whose lines are on it (the final payment
 * only); each is recorded as billed by it — the same fields as a VO billed on its own, plus
 * the final stage — so it is locked, counted as billed, and never put on another invoice.
 */
async function recordBilled(stages, invoice, user, quoteVersion, settling = []) {
  const now = nowIsoSingapore();
  const billed = stages.map(stage => ({
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
  }));
  try {
    await writeStages(billed);
  } catch (err) {
    // The invoice exists in Xero. Say so plainly: a retry will find it by number and adopt
    // it, so nothing is duplicated, but the sheet does not show it yet.
    return fail(500, `Invoice ${invoice.InvoiceNumber} WAS created in Xero, but the sheet could not be updated (${err.message}). Press Bill now again to record it; it will not create a second invoice.`);
  }
  const final = stages.find(st => st.isFinal);
  const result = { ok: true, billed: true, stage: billed[0], stages: billed, invoiceNumber: invoice.InvoiceNumber, invoiceId: invoice.InvoiceID, settled: settling.map(v => v.id) };
  if (settling.length && final) {
    try {
      await writeQuoteRows(settling.map(vo => ({
        ...vo, status: 'billed', settledOnStageId: final.id,
        billedAmount: vo.contractSum, billedAt: now, billedBy: user.name,
        xeroInvoiceId: invoice.InvoiceID, xeroInvoiceNumber: invoice.InvoiceNumber,
      })));
    } catch (err) {
      // The stages are recorded, so a retry says "already billed" and will not resend; the
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
  const { quote, project, lines, categories, usedNumbers, finalInFlight } = data;
  if (quote.kind !== 'vo') return fail(400, `${quoteId} is the main quote; its stages are billed from the payment schedule`);

  const blockers = [];
  if (quote.xeroInvoiceId) {
    blockers.push(quote.settledOnStageId
      ? `Already settled on the final payment invoice ${quote.xeroInvoiceNumber || quote.xeroInvoiceId}.`
      : `Already billed as ${quote.xeroInvoiceNumber || quote.xeroInvoiceId}.`);
  }
  if (!lines.some(l => l.kind === 'item')) blockers.push('This variation order has no lines.');
  // It may already be on that invoice: the final's retry must finish first
  if (finalInFlight && !quote.xeroInvoiceId) {
    blockers.push(`The final payment invoice ${finalInFlight.xeroInvoiceNumber}, which may include this variation order, has an unfinished attempt. Press Retry bill on the final payment first.`);
  }
  if (!quote.xeroInvoiceId && !attemptInFlight(quote)) {
    const accepted = acceptanceBlocker(quote, { what: 'variation order' });
    if (accepted) blockers.push(accepted);
  }
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

  // Adopted only if line for line this VO's invoice (see billStageOnce)
  const want = { contactId: contact.xeroContactId, amount: quote.contractSum, reference: project.address, lines: prep.invoice.LineItems };
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
      // Xero answered with reasons: nothing was created, so the number is released
      await writeQuoteRow({ ...quote, xeroInvoiceNumber: messages.length ? '' : number, status: 'error' });
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
