// Progress claims: bill by % of the work done, instead of fixed payment stages. Pure, so
// every figure and the exact Xero invoice are unit-tested. Agreed with JY (Proposal 03):
//
//   claim = % done × the main quote's contract sum − everything already billed on it
//           (stage invoices and earlier claims alike), then
//           + each accepted VO the person ticks, as its own line at its FULL amount.
//
// The % applies to the main quote only; VOs never take a %. Each VO is billed once. The
// 100% claim adds every remaining accepted VO. After the first claim the payment stages
// are switched off, so a stage can never be billed on top of a claim.

import { round2, sumAmounts } from './quoteMaths.mjs';
import { voSettlementDescription } from './stageInvoice.mjs';
import { attemptInFlight } from './clientAcceptance.mjs';

const money = n => '$' + Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctText = n => `${Number(Number(n).toFixed(2))}%`;

/** A claim that counts: billed, or an attempt that may be in Xero. Cancelled ones never do. */
export const claimCounts = c => !!c && (!!c.xeroInvoiceId || attemptInFlight(c));

/**
 * What the main quote has already been billed: non-final stages billed (their own amounts)
 * plus every claim that counts (its main part only; its VO lines are the VOs' own).
 */
export function mainBilledBefore(stages = [], claims = []) {
  return sumAmounts([
    ...stages.filter(s => !s.isFinal && s.xeroInvoiceId).map(s => s.billedAmount ?? 0),
    ...claims.filter(claimCounts).map(c => c.mainAmount ?? 0),
  ]);
}

/** The highest % already claimed, 0 if none. */
export function lastPct(claims = []) {
  return claims.filter(claimCounts).reduce((m, c) => Math.max(m, Number(c.pctDone) || 0), 0);
}

/**
 * The figures for a claim at `pct` % done, and every reason it cannot be made, in words.
 *   contractSum   the main quote's contract sum now
 *   billedBefore  mainBilledBefore(...)
 *   previousPct   lastPct(...)
 *   vos           the VOs going on it: [{ voNumber, title, contractSum }]
 */
export function claimFigures({ contractSum, pct, billedBefore = 0, previousPct = 0, vos = [] }) {
  const problems = [];
  const p = Number(pct);
  if (pct === '' || pct === null || pct === undefined || !Number.isFinite(p)) problems.push('Enter the % of the work done.');
  else if (p <= 0 || p > 100) problems.push('The % done must be more than 0 and at most 100.');
  else if (p <= previousPct) problems.push(`The last claim was at ${pctText(previousPct)}. A new claim must be for more than that.`);

  const ok = Number.isFinite(p) && p > 0 && p <= 100;
  const gross = ok ? round2(Number(contractSum) * p / 100) : 0;
  const main = ok ? sumAmounts([gross, -billedBefore]) : 0;
  const voAmount = sumAmounts(vos.map(v => v.contractSum));
  const total = sumAmounts([main, voAmount]);
  if (ok && main < 0) {
    problems.push(`At ${pctText(p)} the job is worth ${money(gross)}, but ${money(billedBefore)} is already billed. Enter a higher %.`);
  }
  if (ok && main >= 0 && !(total > 0)) problems.push('This claim comes to $0.00 or less, so it cannot be invoiced.');
  return { pct: ok ? p : null, gross, billedBefore, main, voAmount, total, problems };
}

/** "Progress claim 2: 70% of contract sum $50,000.00 = $35,000.00, less $20,000.00 already billed" */
export function claimLineDescription({ claimNo, pct, contractSum, gross, billedBefore }) {
  const head = `Progress claim ${claimNo}: ${pctText(pct)} of contract sum ${money(contractSum)}`;
  return billedBefore > 0 ? `${head} = ${money(gross)}, less ${money(billedBefore)} already billed` : head;
}

/**
 * The Xero invoice for a claim: its line, then one line per VO at its full signed amount.
 * Approved straight away, no GST, Reference = the project's address, like stage invoices.
 */
export function buildClaimInvoice({
  contactId, invoiceNumber, date, dueDate, reference, accountCode, trackingOption,
  claimNo, contractSum, figures, vos = [],
}) {
  if (!contactId) throw new Error('A Xero ContactID is required');
  if (figures.problems?.length) throw new Error(figures.problems.join(' '));
  const line = {
    Description: claimLineDescription({ claimNo, pct: figures.pct, contractSum, gross: figures.gross, billedBefore: figures.billedBefore }),
    Quantity:    1,
    UnitAmount:  figures.main,
    AccountCode: accountCode,
  };
  if (trackingOption) line.Tracking = [{ Name: 'Service', Option: trackingOption }];
  const items = [line, ...vos.map(vo => ({
    Description: voSettlementDescription(vo),
    Quantity:    1,
    UnitAmount:  Number(vo.contractSum),
    AccountCode: accountCode,
  }))];
  const cents = n => Math.round(Number(n) * 100);
  if (items.reduce((a, l) => a + cents(l.UnitAmount), 0) !== cents(figures.total)) {
    throw new Error(`The claim lines do not add up to ${money(figures.total)}. Nothing was sent.`);
  }
  return {
    Type:            'ACCREC',
    Status:          'AUTHORISED',
    Contact:         { ContactID: contactId },
    Date:            date,
    DueDate:         dueDate,
    InvoiceNumber:   invoiceNumber,
    Reference:       reference,
    LineAmountTypes: 'NoTax',
    LineItems:       items,
  };
}
