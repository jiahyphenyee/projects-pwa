// Cost aggregation. Kept in one place so every screen — and any future dashboard —
// totals the same way.

import { GENERAL_PROJECT_CODE } from '@/lib/constants';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Totals for a single project.
 *
 * The invoiced split spans BOTH sources. Receipted expenses used to carry no invoiced
 * flag — this app cannot write the `Receipted expenses` tab, which belongs to the sibling
 * app — but that state now lives in the `Receipted expense invoicing` tab this app owns
 * (lib/receiptedInvoicing.js) and is joined on read. Whether spend has been billed on to
 * a client is a fact about our invoicing, not about the expense claim.
 *
 * `invoiced` / `notInvoiced` are no longer rendered on the project screen, which shows
 * the total alone. They stay here because this is the one place cost aggregation is
 * defined, and the figures are what a cross-project dashboard will bill from.
 */
export function summariseProject(costs = [], receipted = []) {
  const ownTotal       = costs.reduce((sum, c) => sum + (c.amount || 0), 0);
  const receiptedTotal = receipted.reduce((sum, e) => sum + (e.amount || 0), 0);

  const invoiced = [...costs, ...receipted]
    .filter(row => row.invoiced)
    .reduce((sum, row) => sum + (row.amount || 0), 0);

  return {
    ownTotal:       round2(ownTotal),
    invoiced:       round2(invoiced),
    notInvoiced:    round2(ownTotal + receiptedTotal - invoiced),
    receiptedTotal: round2(receiptedTotal),
    grandTotal:     round2(ownTotal + receiptedTotal),
    ownCount:       costs.length,
    receiptedCount: receipted.length,
  };
}

/**
 * The two cost sources as one list, newest first.
 *
 * A project's costs arrive from two tabs with different shapes and different rules, but
 * they are one thing to the person reading the screen — money spent on this job. This is
 * the single place they become uniform, so no screen has to branch on where a row came
 * from beyond the two facts that genuinely differ: receipted rows cannot be edited here,
 * and only they carry a payee and a review status.
 *
 * `costType` earns no room on the row, but it is what splits the project's cost into
 * materials, subcon, own labour and transport (costSplit in lib/projectFigures.mjs), for
 * both kinds of line.
 *
 * Runs on the client, not in the route, so a payload cached before this existed still
 * renders. Those receipted rows simply show as not invoiced until the next fetch.
 */
export function mergeLines(costs = [], receipted = []) {
  const lines = [
    ...costs.map(c => ({
      id:           c.id,
      date:         c.date,
      amount:       c.amount,
      description:  c.description,
      // Both: the code is what the row is tagged with, so a trade reads identically
      // whichever tab it came from; the name is only a fallback label for a cost with no
      // description, where "Electrical" beats "ELEC".
      categoryCode: c.categoryCode || '',
      categoryName: c.categoryName || c.categoryCode || '',
      invoiced:     c.invoiced === true,
      invoicedDate: c.invoicedDate || '',
      invoiceRef:   c.invoiceRef || '',       // set = billed direct on that Xero invoice
      costType:     c.costType || '',
      receipted:    false,
      editable:     true,
      payeeName:    '',
      status:       '',
    })),
    ...receipted.map(e => ({
      id:           e.id,
      date:         e.date,
      amount:       e.amount,
      description:  e.description,
      // The Expenses tab stores the code itself and has no name to join, which is the
      // shape both sources are matched to above.
      categoryCode: e.category || '',
      categoryName: e.category || '',
      invoiced:     e.invoiced === true,
      invoicedDate: e.invoicedDate || '',
      invoiceRef:   e.invoiceRef || '',
      xeroBillId:   e.xeroBillId || '',       // its receipt is on this Xero bill
      // Column T, chosen on the expense app's form; blank on rows that predate it, which
      // costBucket() then places by category.
      costType:     e.costType || '',
      receipted:    true,
      // Receipted rows belong to the expense app and are read-only here. The UI hides the
      // edit affordance off this flag; the route enforces it independently.
      editable:     false,
      payeeName:    e.payeeName || '',
      status:       e.status || '',
    })),
  ];

  // Dates are ISO, so string comparison is chronological. The id tiebreak exists only to
  // make the order deterministic — a PC- and an EXP- id on the same day come from two
  // different numbering schemes and cannot be meaningfully ranked against each other.
  return lines.sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || '')
  );
}

/**
 * Drop the general-expenses bucket before any CROSS-project aggregate.
 *
 * GEN-000 holds company overheads, not job costs. Including it would inflate
 * project figures with spend that belongs to no job. Its own detail page still
 * shows its own totals — that is a within-project view, not a rollup.
 */
export function excludeGeneral(rows, getCode = row => row.projectCode) {
  return rows.filter(row => getCode(row) !== GENERAL_PROJECT_CODE);
}
