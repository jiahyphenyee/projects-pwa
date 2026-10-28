// Billing a progress claim: an approved Xero invoice for % done of the main quote, less what
// is already billed, plus the accepted VOs the person ticked at their full amounts. The
// figures and the invoice are lib/progressClaims.mjs; this is the reading, checking and
// writing around them, with the same protections as stage billing (lib/billing.js):
//
//   - the claim row is written ("sending:<token>", with its number) BEFORE Xero is called,
//     then read back after a pause: another claim or bill for this quote started meanwhile
//     → stop before Xero;
//   - Idempotency-Key per claim and number; a lost answer keeps the number, and Retry looks
//     it up and adopts the invoice only if its lines are this claim's;
//   - the claim and its VOs are recorded as billed in ONE write;
//   - presses on the same quote queue in this process (shared with stage billing).
//
// Dry run writes nothing at all.

import { readForBilling, readClaims, appendClaim, writeClaims, writeClaimBilled, getConfig } from '@/lib/quotes';
import { verifyPin } from '@/lib/pin';
import { can, PERMISSIONS } from '@/lib/roles.mjs';
import { isDryRun, listInvoiceNumbers, findInvoiceByNumber, createInvoice, validationMessages } from '@/lib/xero';
import { invoicePrefix, nextInvoiceNumber, addDays } from '@/lib/invoiceNumbers.mjs';
import { matchesStageInvoice } from '@/lib/stageInvoice.mjs';
import { todaySingapore, nowIsoSingapore } from '@/lib/dates';
import { acceptanceBlocker, attemptInFlight, settlingBlocker } from '@/lib/clientAcceptance.mjs';
import { claimCounts, claimFigures, buildClaimInvoice, mainBilledBefore, lastPct } from '@/lib/progressClaims.mjs';
import { fail, clientCheck, withQuoteLock, pause, CLAIM_SETTLE_MS } from '@/lib/billing';

const newToken = () => `sending:${Math.random().toString(36).slice(2, 10)}`;

/** The VOs a claim may carry: unbilled, no attempt of their own in flight. */
const openVos = vos => vos.filter(v => !v.xeroInvoiceId && !attemptInFlight(v));

/**
 * Everything needed to make a claim, plus `blockers`. Either a new claim ({ pct, voIds })
 * or the retry of one already written ({ claimId }), which is rebuilt from its own row.
 * Reads Xero (contact, numbers in use) but never writes.
 */
export async function prepareClaim({ quoteId, pct, voIds = [], claimId = '', skipNumbers = [] }) {
  const data = await readForBilling(quoteId);
  if (!data) return fail(404, `No quote with id ${quoteId}`);
  const { quote, project, stages, vos, claims, usedNumbers } = data;
  if (quote.kind !== 'quote') return fail(400, 'Progress claims are made on the main quote.');

  const retry = claimId ? claims.find(c => c.id === claimId) : null;
  if (claimId && !retry) return fail(404, `No claim ${claimId} on ${quoteId}`);
  if (retry?.xeroInvoiceId) return { ok: true, alreadyBilled: true, claim: retry };
  if (retry && !attemptInFlight(retry)) return fail(409, `Claim ${retry.claimNo} never reached Xero. Make a new claim instead.`);

  // A retry keeps its own %, VOs and "already billed" (itself excluded), so it rebuilds
  // exactly the invoice its first attempt sent
  const others = claims.filter(c => c.id !== retry?.id);
  const wantPct = retry ? retry.pctDone : Number(pct);
  const pickedIds = retry ? retry.voIds : [...new Set((voIds || []).map(String))];
  const blockers = [];

  const open = openVos(vos);
  // 100% is the last claim: every remaining accepted VO goes on it
  const accepted = open.filter(v => !settlingBlocker(v));
  const chosenIds = !retry && wantPct === 100 ? [...new Set([...pickedIds, ...accepted.map(v => v.id)])] : pickedIds;
  const chosen = retry
    ? vos.filter(v => chosenIds.includes(v.id))
    : open.filter(v => chosenIds.includes(v.id));
  if (!retry) {
    for (const id of chosenIds.filter(id => !chosen.some(v => v.id === id))) {
      const vo = vos.find(v => v.id === id);
      blockers.push(vo ? `VO${vo.voNumber} is already billed or has an unfinished attempt.` : `No variation order ${id} on this project.`);
    }
    for (const vo of chosen) {
      const why = settlingBlocker(vo);
      if (why) blockers.push(why);
    }
    const acc = acceptanceBlocker(quote, { anyBilled: stages.some(s => s.xeroInvoiceId) || others.some(claimCounts) });
    if (acc) blockers.push(acc);
    if (stages.some(s => s.isFinal && s.xeroInvoiceId)) blockers.push('The final payment is already invoiced, so there is nothing left to claim.');
    const stageBusy = stages.find(attemptInFlight);
    if (stageBusy) blockers.push(`${stageBusy.name} has an unfinished billing attempt (${stageBusy.xeroInvoiceNumber}). Press Retry bill on it first.`);
    const claimBusy = others.find(attemptInFlight);
    if (claimBusy) blockers.push(`Claim ${claimBusy.claimNo} has an unfinished attempt (${claimBusy.xeroInvoiceNumber}). Press Retry on it first.`);
  }

  const figures = retry
    ? claimFigures({ contractSum: retry.contractSum, pct: retry.pctDone, billedBefore: retry.billedBefore, previousPct: 0, vos: chosen })
    : claimFigures({ contractSum: quote.contractSum, pct: wantPct, billedBefore: mainBilledBefore(stages, others), previousPct: lastPct(others), vos: chosen });
  blockers.push(...figures.problems);

  const client = await clientCheck(project);
  blockers.push(...client.blockers);
  const [accountCode, dueDays, trackingOption] = await Promise.all([
    getConfig('XERO_SALES_ACCOUNT_CODE'), getConfig('INVOICE_DUE_DAYS'), getConfig('STAGE_TRACKING_OPTION'),
  ]);
  if (!String(accountCode || '').trim()) blockers.push('XERO_SALES_ACCOUNT_CODE is not set in System config.');

  const date = todaySingapore();
  const dueDate = addDays(date, Number(dueDays) || 14);
  let invoiceNumber = retry?.xeroInvoiceNumber || '';
  if (!invoiceNumber || skipNumbers.includes(invoiceNumber) || !invoiceNumber.startsWith(invoicePrefix(date))) {
    const inXero = await listInvoiceNumbers(invoicePrefix(date));
    invoiceNumber = nextInvoiceNumber(date, [...usedNumbers, ...inXero], skipNumbers);
  }
  const claimNo = retry ? retry.claimNo : others.filter(c => c.xeroSyncStatus !== 'cancelled').reduce((m, c) => Math.max(m, c.claimNo || 0), 0) + 1;
  const contractSum = retry ? retry.contractSum : quote.contractSum;

  let invoice = null;
  if (!blockers.length) {
    invoice = buildClaimInvoice({
      contactId: client.contact.xeroContactId, invoiceNumber, date, dueDate, reference: project.address,
      accountCode: String(accountCode).trim(), trackingOption: String(trackingOption || '').trim(),
      claimNo, contractSum, figures, vos: chosen.map(v => ({ voNumber: v.voNumber, title: v.title, contractSum: v.contractSum })),
    });
  }

  return {
    ok: true, dryRun: isDryRun(), blockers, quote, project, retry, chosen, figures, claimNo, contractSum, contact: client.contact,
    knownClaimIds: claims.map(c => c.id),
    knownBilledStageIds: stages.filter(st => st.xeroInvoiceId).map(st => st.id),
    preview: {
      quoteId, claimId: retry?.id || '', claimNo, pct: figures.pct, quoteVersion: quote.currentVersion,
      invoiceNumber, date, dueDate, amount: figures.total,
      gross: figures.gross, billedBefore: figures.billedBefore, main: figures.main, voIds: chosen.map(v => v.id),
      client: client.xeroContact?.Name || client.contact?.name || project?.clientName || '',
      reference: project?.address || '',
      description: invoice?.LineItems[0].Description || '',
      lines: invoice?.LineItems || [],
      accountCode: String(accountCode || '').trim(),
    },
    invoice,
  };
}

export function billClaim(args) {
  return withQuoteLock(args.quoteId, () => billClaimOnce(args));
}

/**
 * Write the claim row as "sending" (a new row, or the retried one), pause, read back. If
 * anything else for this quote started meanwhile, give up before Xero. Returns { claim } or { error }.
 */
async function startAttempt(prep, number, user) {
  const token = newToken();
  const base = {
    quoteId: prep.quote.id, pctDone: prep.figures.pct, contractSum: prep.contractSum, grossToDate: prep.figures.gross,
    billedBefore: prep.figures.billedBefore, mainAmount: prep.figures.main, voIds: prep.chosen.map(v => v.id),
    voAmount: prep.figures.voAmount, total: prep.figures.total, xeroInvoiceNumber: number, xeroSyncStatus: token,
  };
  let claim;
  if (prep.retry) {
    claim = { ...prep.retry, ...base, claimNo: prep.retry.claimNo };
    await writeClaims([claim]);
  } else {
    claim = await appendClaim({ ...base, createdBy: user.name });
  }
  await pause(CLAIM_SETTLE_MS);
  const now = await readForBilling(prep.quote.id);
  const mine = now?.claims.find(c => c.id === claim.id);
  const rival = now?.claims.find(c => c.id !== claim.id && (attemptInFlight(c) || (c.xeroInvoiceId && !prep.knownClaimIds.includes(c.id))));
  const stageBusy = now?.stages.some(s => attemptInFlight(s) || (s.xeroInvoiceId && !prep.knownBilledStageIds.includes(s.id)));
  const voTaken = now?.vos.filter(v => claim.voIds.includes(v.id) && (v.xeroInvoiceId || attemptInFlight(v)));
  if (!mine || mine.xeroSyncStatus !== token || rival || stageBusy || voTaken?.length) {
    // Put it back as it was: a retried claim keeps its earlier number, a new one is cancelled
    if (mine && mine.xeroSyncStatus === token) {
      await writeClaims([prep.retry ? { ...mine, xeroInvoiceNumber: prep.retry.xeroInvoiceNumber, xeroSyncStatus: 'error' } : { ...mine, xeroInvoiceNumber: '', xeroSyncStatus: 'cancelled' }]);
    }
    return { error: 'Another claim or bill for this job started at the same moment, from another phone. Nothing was sent. Refresh and check before trying again.' };
  }
  return { claim: mine };
}

/** Mark the attempt "error" (number kept = outcome unknown) or "cancelled", only while it is still ours. */
async function endAttempt(claim, keepNumber) {
  const now = (await readClaims(claim.quoteId)).find(c => c.id === claim.id);
  if (!now || now.xeroSyncStatus !== claim.xeroSyncStatus) return;
  await writeClaims([{ ...now, xeroInvoiceNumber: keepNumber || '', xeroSyncStatus: keepNumber ? 'error' : 'cancelled' }]);
}

async function recordClaim(claim, chosen, invoice, user) {
  const now = nowIsoSingapore();
  const billed = { ...claim, xeroInvoiceId: invoice.InvoiceID, xeroInvoiceNumber: invoice.InvoiceNumber, xeroSyncStatus: 'billed', billedAt: now, billedBy: user.name };
  const vos = chosen.map(vo => ({
    ...vo, status: 'billed', settledOnStageId: claim.id,
    billedAmount: vo.contractSum, billedAt: now, billedBy: user.name,
    xeroInvoiceId: invoice.InvoiceID, xeroInvoiceNumber: invoice.InvoiceNumber,
  }));
  try {
    await writeClaimBilled(billed, vos);
  } catch (err) {
    return fail(500, `Invoice ${invoice.InvoiceNumber} WAS created in Xero, but the sheet could not be updated (${err.message}). Press Retry on the claim to record it; it will not create a second invoice.`);
  }
  return { ok: true, billed: true, claim: billed, invoiceNumber: invoice.InvoiceNumber, invoiceId: invoice.InvoiceID, settled: vos.map(v => v.id) };
}

/** `expected`: { amount, quoteVersion } as confirmed on screen. */
async function billClaimOnce({ quoteId, pct, voIds, claimId, pin, expected = {} }) {
  const user = await verifyPin(pin);
  if (!user) return fail(401, 'That PIN is not right.');
  if (!can(user.role, PERMISSIONS.QUOTES)) return fail(403, `${user.name} cannot bill to Xero.`);

  let prep = await prepareClaim({ quoteId, pct, voIds, claimId });
  if (!prep.ok) return prep;
  if (prep.alreadyBilled) return { ok: true, alreadyBilled: true, message: `Already billed as ${prep.claim.xeroInvoiceNumber}.` };
  if (prep.blockers.length) return fail(409, prep.blockers.join(' '), { blockers: prep.blockers });
  if (Math.round(expected.amount * 100) !== Math.round(prep.preview.amount * 100) || expected.quoteVersion !== prep.preview.quoteVersion) {
    return fail(409, 'The quote has changed since you opened this. Review the claim again before billing.', { changed: true });
  }
  if (prep.dryRun) return { ok: true, dryRun: true, invoice: prep.invoice, preview: prep.preview };

  // Adopted only if line for line this claim's invoice (claim number and % are in the text)
  const wantFor = p => ({ contactId: prep.contact.xeroContactId, amount: p.preview.amount, reference: p.project.address, lines: p.invoice.LineItems });

  if (prep.retry?.xeroInvoiceNumber) {
    const found = await findInvoiceByNumber(prep.retry.xeroInvoiceNumber);
    if (found && matchesStageInvoice(found, wantFor(prep))) return recordClaim(prep.retry, prep.chosen, found, user);
    if (found) {
      prep = await prepareClaim({ quoteId, claimId, skipNumbers: [prep.retry.xeroInvoiceNumber] });
      if (!prep.ok || prep.blockers.length) return prep.ok ? fail(409, prep.blockers.join(' '), { blockers: prep.blockers }) : prep;
    }
  }

  const skip = [];
  let claim = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = prep.preview.invoiceNumber;
    if (!claim) {
      const started = await startAttempt(prep, number, user);
      if (started.error) return fail(409, started.error, { changed: true });
      claim = started.claim;
    } else {
      claim = { ...claim, xeroInvoiceNumber: number };
      await writeClaims([claim]);
    }
    try {
      const { invoice } = await createInvoice(buildFor(prep, number), { idempotencyKey: `${claim.id}:${number}` });
      return recordClaim(claim, prep.chosen, invoice, user);
    } catch (err) {
      const messages = validationMessages(err);
      const duplicate = messages.some(m => /must be unique|already exists/i.test(m));
      if (duplicate && attempt === 0) {
        const found = await findInvoiceByNumber(number);
        if (found && matchesStageInvoice(found, wantFor(prep))) return recordClaim(claim, prep.chosen, found, user);
        skip.push(number);
        const again = await prepareClaim({ quoteId, claimId: claim.id, skipNumbers: skip });
        if (!again.ok || again.blockers.length) {
          await endAttempt(claim, '');
          return again.ok ? fail(409, again.blockers.join(' '), { blockers: again.blockers }) : again;
        }
        prep = { ...again, chosen: prep.chosen };
        continue;
      }
      await endAttempt(claim, messages.length ? '' : number);
      return fail(502, `Xero did not create the invoice: ${messages.join(' ') || err.message}. ${messages.length ? 'Nothing was billed; you can make the claim again.' : 'Press Retry on the claim: it checks Xero first and will not create a second invoice.'}`);
    }
  }
  if (claim) await endAttempt(claim, '');
  return fail(502, 'Xero rejected the invoice number twice. Nothing was billed; try again.');
}

/** The prepared invoice with this attempt's number. */
const buildFor = (prep, number) => ({ ...prep.invoice, InvoiceNumber: number });
