// Cost aggregation. Kept in one place so every screen — and any future dashboard —
// totals the same way.

import { GENERAL_PROJECT_CODE } from '@/lib/constants';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Totals for a single project.
 *
 * Receipted expenses are reported separately and never carry an invoiced flag — this
 * app cannot mark them, since the Expenses tab belongs to the sibling app. So
 * "invoiced" percentages describe non-receipted costs only, and saying otherwise
 * would imply a claim about data we do not control.
 */
export function summariseProject(costs = [], receipted = []) {
  const ownTotal    = costs.reduce((sum, c) => sum + (c.amount || 0), 0);
  const invoiced    = costs.filter(c => c.invoiced).reduce((sum, c) => sum + (c.amount || 0), 0);
  const receiptedTotal = receipted.reduce((sum, e) => sum + (e.amount || 0), 0);

  return {
    ownTotal:       round2(ownTotal),
    invoiced:       round2(invoiced),
    notInvoiced:    round2(ownTotal - invoiced),
    receiptedTotal: round2(receiptedTotal),
    grandTotal:     round2(ownTotal + receiptedTotal),
    ownCount:       costs.length,
    receiptedCount: receipted.length,
  };
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
