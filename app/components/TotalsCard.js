'use client';

import { card, color, font, space } from '@/lib/theme';

export function formatAmount(n) {
  return (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A single row's amount. An unreadable cell shows as an em dash, never as 0.00 — a
 * total may legitimately be zero, but a line item that renders zero because its cell
 * could not be parsed is a broken read wearing the costume of a real figure.
 */
export function formatRowAmount(n) {
  return n === null || n === undefined ? '—' : formatAmount(n);
}

/**
 * What a project has cost. One figure.
 *
 * It used to break the total down by which system tracked the spend — "not from expense
 * app" against "from expense app". That is a fact about our plumbing, not about the job,
 * and it sat at the top of the screen competing with the number people actually open this
 * page for. The split is still available where it is asked for: the filters over the cost
 * list total whatever subset you select.
 */
export default function TotalsCard({ totals }) {
  if (!totals) return null;

  const count = totals.ownCount + totals.receiptedCount;

  return (
    <section style={{
      ...card, padding: space.lg, marginBottom: space.lg,
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md,
    }}>
      <span style={{ fontSize: font.size.md, fontWeight: 600, color: color.text }}>
        Total project cost
        <span style={{ color: color.subtle, fontSize: font.size.xs, fontWeight: 400 }}>
          {' · '}{count} {count === 1 ? 'expense' : 'expenses'}
        </span>
      </span>
      <span style={{
        fontSize: font.size.xl, fontWeight: 600,
        fontVariantNumeric: 'tabular-nums', flexShrink: 0,
      }}>{formatAmount(totals.grandTotal)}</span>
    </section>
  );
}
