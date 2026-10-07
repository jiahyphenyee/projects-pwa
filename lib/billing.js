// Billing one payment stage: an approved, one-line sales invoice in Xero.
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

import { readForBilling, writeStage, readClientContact, getConfig } from '@/lib/quotes';
import { verifyPin } from '@/lib/pin';
import {
  isDryRun, getXeroContact, listInvoiceNumbers, findInvoiceByNumber, createInvoice, validationMessages,
} from '@/lib/xero';
import { invoicePrefix, nextInvoiceNumber, addDays } from '@/lib/invoiceNumbers.mjs';
import { buildStageInvoice, matchesStageInvoice } from '@/lib/stageInvoice.mjs';
import { todaySingapore, nowIsoSingapore } from '@/lib/dates';

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

/**
 * Everything needed to bill a stage, plus `blockers`: every reason it cannot be billed now,
 * in words for the screen. Reads Xero (contact, numbers in use) but never writes.
 */
export async function prepareStageBill({ quoteId, stageId, skipNumbers = [] }) {
  const data = await readForBilling(quoteId);
  if (!data) return fail(404, `No quote with id ${quoteId}`);
  const { quote, project, schedule, usedNumbers } = data;
  const stage = schedule.stages.find(s => s.id === stageId);
  if (!stage) return fail(404, `No stage ${stageId} on ${quoteId}`);

  const blockers = [];
  if (quote.kind !== 'quote') blockers.push('Variation orders are billed from the variation order itself.');
  if (stage.xeroInvoiceId) blockers.push(`Already billed as ${stage.xeroInvoiceNumber || stage.xeroInvoiceId}.`);
  if (schedule.overAllocated) blockers.push(`The stages add up to ${schedule.sharesTotal}%, more than 100%. Reduce a share first.`);
  if (schedule.finalNegative) blockers.push('The contract sum is now less than what has already been billed. Fix the quote first.');
  if (!(stage.amount > 0)) blockers.push('This stage is $0.00. Give it a share of the contract sum first.');

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
    quote, project, stage, contact, xeroContactName: xeroContact?.Name || '',
    preview: {
      quoteId, stageId, quoteVersion: quote.currentVersion,
      invoiceNumber, date, dueDate, amount: stage.amount,
      client: xeroContact?.Name || contact?.name || project?.clientName || '',
      reference: project?.address || '',
      description: invoice?.LineItems[0].Description || '',
      accountCode: String(accountCode || '').trim(),
    },
    invoice,
  };
}

const inFlight = new Map();   // stageId → promise, so double presses in one process queue

export function billStage(args) {
  const key = args.stageId;
  const run = (inFlight.get(key) || Promise.resolve()).catch(() => {}).then(() => billStageOnce(args));
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

  let prep = await prepareStageBill({ quoteId, stageId });
  if (!prep.ok) return prep;
  const { stage, contact, project } = prep;

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
    if (found && matchesStageInvoice(found, want)) return recordBilled(stage, found, user);
    if (found) prep = await prepareStageBill({ quoteId, stageId, skipNumbers: [stage.xeroInvoiceNumber] });
  }

  // Up to two attempts: the second only if Xero says the number is taken
  const skip = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = prep.preview.invoiceNumber;
    await writeStage({ ...stripComputed(stage), xeroInvoiceNumber: number, xeroSyncStatus: 'sending', quoteVersion: prep.quote.currentVersion });
    try {
      const { invoice } = await createInvoice(prep.invoice, { idempotencyKey: `${stage.id}:${number}` });
      return recordBilled(stage, invoice, user);
    } catch (err) {
      const messages = validationMessages(err);
      const duplicate = messages.some(m => /must be unique|already exists/i.test(m));
      if (duplicate && attempt === 0) {
        const found = await findInvoiceByNumber(number);
        if (found && matchesStageInvoice(found, want)) return recordBilled(stage, found, user);
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
  const { amount, billed, ...row } = stage;
  void amount; void billed;
  // The final stage's share is computed (100% minus the rest), never stored
  if (row.isFinal) row.sharePct = null;
  return row;
}

async function recordBilled(stage, invoice, user) {
  const billed = {
    ...stripComputed(stage),
    billedAmount:      stage.amount,
    billedAt:          nowIsoSingapore(),
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
  return { ok: true, billed: true, stage: billed, invoiceNumber: invoice.InvoiceNumber, invoiceId: invoice.InvoiceID };
}


