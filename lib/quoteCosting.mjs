// What each quote on a project earned: quoted, VOs, cost, margin, invoiced, paid,
// outstanding (billing-redesign-brief.md, phase 3). Pure, so it is tested with node --test
// and runs on the client from figures it already has: the per-quote billing summary, the
// cost lines and the project's matched Xero invoices.
//
// Which quote a cost belongs to:
//   1. the quote picked on the cost (Project costs quote_id), if it is one of this project's
//   2. else the first quote, still going ahead, whose trade is the cost's category
//   3. else none: the "Not on a quote" row, which is how a missing or wrong tag shows up
// Which quote an invoice belongs to: the one this app billed it for (doc.quoteId);
// invoices raised by hand in Xero have none and sit on "Not on a quote".

import { summariseInvoices, readSettings } from './projectFigures.mjs';
import { sumAmounts } from './quoteMaths.mjs';

/** The quote id one cost line counts towards, or '' for none. `quotes`: billingSummary().quotes. */
export function costQuoteId(line, quotes = []) {
  const picked = String(line?.quoteId || '').trim();
  if (picked && quotes.some(q => q.quoteId === picked)) return picked;
  const code = String(line?.categoryCode || '').trim();
  if (!code) return '';
  return quotes.find(q => !q.declined && q.trade && q.trade === code)?.quoteId || '';
}

/**
 * One row per quote, then "Not on a quote" when anything is left over, then the total.
 * `quotes`: billingSummary().quotes · `lines`: the project's cost lines · `docs`: the
 * project's matched Xero documents (credit notes and drafts handled as in summariseInvoices).
 */
export function quoteTable({ quotes = [], lines = [], docs = [], today, settings = readSettings() }) {
  const linesOf = new Map([...quotes.map(q => [q.quoteId, []]), ['', []]]);
  for (const line of lines) linesOf.get(costQuoteId(line, quotes)).push(line);
  const ids = new Set(quotes.map(q => q.quoteId));
  const docsOf = id => docs.filter(d => (ids.has(d.quoteId) ? d.quoteId : '') === id);

  const build = (id, base) => {
    const costLines = linesOf.get(id);
    const inv = summariseInvoices(docsOf(id), today, settings);
    const cost = sumAmounts(costLines.map(l => l.amount || 0));
    const value = base.quoted === null ? null : sumAmounts([base.quoted, base.vos]);
    return {
      ...base,
      cost,
      margin: value > 0 && !base.declined ? (value - cost) / value : null,
      invoiced: inv.invoiced,
      paid: inv.collected,
      outstanding: inv.outstanding,
      costLines,
      invoices: inv.items,
    };
  };

  const rows = quotes.map(q => build(q.quoteId, {
    quoteId: q.quoteId,
    title: q.title,
    trade: q.trade,
    declined: !!q.declined,
    quoted: q.contractSum ?? 0,
    vos: sumAmounts((q.items || []).filter(i => i.kind === 'vo').map(i => i.amount || 0)),
  }));
  const rest = build('', { quoteId: '', title: 'Not on a quote', trade: '', declined: false, quoted: null, vos: 0 });
  if (rest.costLines.length || rest.invoices.length) rows.push(rest);

  const counted = rows.filter(r => !r.declined);
  const total = (key, list = rows) => sumAmounts(list.map(r => r[key] ?? 0));
  const value = sumAmounts([total('quoted', counted), total('vos', counted)]);
  const cost = total('cost');
  return {
    rows,
    totals: {
      quoted: total('quoted', counted), vos: total('vos', counted), cost,
      margin: value > 0 ? (value - cost) / value : null,
      invoiced: total('invoiced'), paid: total('paid'), outstanding: total('outstanding'),
    },
  };
}
