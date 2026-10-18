// Every money calculation for quotes, stages and variation orders. Pure: no Sheets, no
// Xero, no imports. Everything that shows a figure or sends one to Xero goes through here,
// so the editor, the saved totals, the PDF and the invoice can never disagree.
//
// `.mjs` so `node --test` can import it directly; the app imports it the same way.
//
// Arithmetic is done in integer cents. 0.1 + 0.2 is not 0.3 in floating point, and a quote
// is exactly the kind of long sum where that shows up as a one-cent mismatch with Xero.

/** Round to 2 decimals, half away from zero, the way an invoice is expected to round. */
export function round2(n) {
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

function toCents(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((Math.abs(v) + Number.EPSILON) * 100) * (v < 0 ? -1 : 1);
}

function fromCents(c) {
  return c / 100;
}

/**
 * Quantity × unit price, rounded to 2 decimals half away from zero. Blank or invalid inputs
 * count as 0.
 *
 * Exact, not floating point: 91.5 × 6.55 is 599.325 and must round to 599.33, as Xero
 * rounds it, but in floating point it is 599.32499… and rounds to 599.32. Both inputs are
 * scaled to integers (4 decimals is more than either is ever given) and multiplied as
 * BigInt, so no product is too large to be exact.
 */
export function lineAmount(qty, unitPrice) {
  const q = Number(qty);
  const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  const product = BigInt(Math.round(q * 1e4)) * BigInt(Math.round(p * 1e4));   // units of 1e-8
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const cents = (abs + 500000n) / 1000000n;
  return (negative ? -1 : 1) * Number(cents) / 100;
}

/**
 * Subtotal of every item row's amount. Title rows contribute nothing.
 * `lines` is the editor's ordered rows: { kind: 'item' | 'title', qty, unitPrice }.
 */
export function subtotal(lines) {
  let cents = 0;
  for (const line of lines) {
    if (line.kind !== 'item') continue;
    cents += toCents(lineAmount(line.qty, line.unitPrice));
  }
  return fromCents(cents);
}

/**
 * Subtotal shown on each title row: the item rows under it, up to the next title.
 * Returns a Map of title key (its `id`, or its index when it has none) → amount.
 * Item rows above the first title belong to no section.
 */
export function sectionSubtotals(lines) {
  const out = new Map();
  let current = null;
  lines.forEach((line, i) => {
    if (line.kind === 'title') {
      current = line.id ?? i;
      out.set(current, 0);
      return;
    }
    if (current === null || line.kind !== 'item') return;
    out.set(current, fromCents(toCents(out.get(current)) + toCents(lineAmount(line.qty, line.unitPrice))));
  });
  return out;
}

/**
 * The discount in dollars for a whole-quote discount entered as `$` or `%`.
 *
 * Capped so a quote can never go negative: a $ discount cannot exceed the subtotal and a
 * % discount cannot exceed 100. Negative or invalid values count as no discount.
 */
export function discountAmount(subtotalValue, mode, value) {
  const sub = toCents(subtotalValue);
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0 || sub <= 0) return 0;

  if (mode === '%') {
    const pct = Math.min(v, 100);
    return fromCents(Math.round(sub * pct / 100));
  }
  if (mode === '$') {
    return fromCents(Math.min(toCents(v), sub));
  }
  return 0;
}

/**
 * Subtotal minus discount. Never below zero for a quote; a variation order (`signed`) keeps
 * its sign, because an omission VO is a negative sum that comes off the final invoice.
 */
export function contractSum(subtotalValue, discountValue, { signed = false } = {}) {
  const cents = toCents(subtotalValue) - toCents(discountValue);
  return fromCents(signed ? cents : Math.max(cents, 0));
}

/**
 * Convenience: subtotal, discount and contract sum for a set of lines in one call.
 * `signed` is for variation orders, whose lines may be negative (see contractSum).
 */
export function quoteTotals(lines, discountMode, discountValue, { signed = false } = {}) {
  const sub = subtotal(lines);
  const disc = discountAmount(sub, discountMode, discountValue);
  return { subtotal: sub, discount: disc, contractSum: contractSum(sub, disc, { signed }) };
}

// ── Variation orders ─────────────────────────────────────────────────────────────────
//
// A VO can add work (positive lines) or omit it (negative lines). Every VO settles on the
// final payment invoice as one signed line, unless it was billed early on its own, so the
// final payment due is the %-based balance plus the VOs still to settle.

/** A VO's signed total: its lines less any discount, negative for an omission. */
export function voTotal(lines, discountMode, discountValue) {
  return quoteTotals(lines, discountMode, discountValue, { signed: true }).contractSum;
}

/** Early-billed and already-settled VOs carry an invoice ID; every other VO settles on the final. */
export function vosToSettle(vos = []) {
  return vos.filter(vo => !vo.xeroInvoiceId);
}

/** The quote's contract sum plus every VO's signed total: what the job is now worth. */
export function adjustedContractSum(quoteContractSum, vos = []) {
  return fromCents(vos.reduce((acc, vo) => acc + toCents(vo.contractSum), toCents(quoteContractSum)));
}

/**
 * What the final payment invoice is for: the %-based balance (scheduleAmounts' finalAmount)
 * plus one signed line per VO not billed early. `vos` are { contractSum, xeroInvoiceId }.
 *
 * Returns { balance, adjustment, due, negative, vos }. `negative` means the balance has
 * gone below zero or the omissions outweigh what is left to bill; either way the invoice
 * cannot be sent (Xero refuses a negative total) and the quote or a VO must be fixed first.
 */
export function finalPaymentDue(balanceValue, vos = []) {
  const balance = toCents(balanceValue);
  const settle = vosToSettle(vos);
  const adjustment = settle.reduce((acc, vo) => acc + toCents(vo.contractSum), 0);
  const due = balance + adjustment;
  return {
    balance:    fromCents(balance),
    adjustment: fromCents(adjustment),
    due:        fromCents(due),
    negative:   balance < 0 || due < 0,
    vos:        settle,
  };
}

/** Contract sum × share %, rounded to 2 decimals. */
export function stageAmount(contractSumValue, sharePct) {
  const pct = Number(sharePct);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return fromCents(Math.round(toCents(contractSumValue) * pct / 100));
}

/**
 * Amounts for a whole payment schedule.
 *
 * `stages` are the non-final stages in order: { sharePct, billedAmount }. A stage with a
 * numeric `billedAmount` is billed and keeps that figure whatever the contract sum is now;
 * every other stage is recalculated from the current contract sum.
 *
 * The final payment is contract sum minus everything else — billed amounts as invoiced,
 * unbilled amounts as recalculated — so the stages always add up to the contract sum to
 * the cent. That is the invariant the acceptance checks demand; computing the final from a
 * percentage would leave rounding crumbs.
 *
 * Returns { amounts, finalAmount, finalPct, sharesTotal, overAllocated, finalNegative }.
 * `overAllocated` means the unbilled shares plus the billed ones exceed 100%; `finalNegative`
 * means the contract sum has dropped below what has already been billed. Both are for the
 * UI to warn about and block billing; neither throws, because the figures are still what
 * the arithmetic says.
 */
export function scheduleAmounts(contractSumValue, stages, finalBilledAmount = null) {
  const total = toCents(contractSumValue);
  let used = 0;
  let sharesTotal = 0;

  const amounts = stages.map(stage => {
    const pct = Number(stage.sharePct);
    if (Number.isFinite(pct) && pct > 0) sharesTotal += pct;

    const cents = isBilled(stage)
      ? toCents(stage.billedAmount)
      : toCents(stageAmount(contractSumValue, stage.sharePct));
    used += cents;
    return fromCents(cents);
  });

  const finalCents = finalBilledAmount !== null && finalBilledAmount !== undefined && finalBilledAmount !== ''
    ? toCents(finalBilledAmount)
    : total - used;

  return {
    amounts,
    finalAmount:   fromCents(finalCents),
    finalPct:      round2(Math.max(100 - sharesTotal, 0)),
    sharesTotal:   round2(sharesTotal),
    overAllocated: sharesTotal > 100,
    finalNegative: finalCents < 0,
  };
}

function isBilled(stage) {
  return stage.billedAmount !== null && stage.billedAmount !== undefined && stage.billedAmount !== ''
    && Number.isFinite(Number(stage.billedAmount));
}

/** Sum of a list of amounts, exact to the cent. */
export function sumAmounts(values) {
  return fromCents(values.reduce((acc, v) => acc + toCents(v), 0));
}
