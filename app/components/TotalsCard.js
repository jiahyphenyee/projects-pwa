'use client';

import { card, color, font, space } from '@/lib/theme';

export function formatAmount(n) {
  return (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TotalsCard({ totals }) {
  if (!totals) return null;
  const hasReceipted = totals.receiptedCount > 0;

  return (
    <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
      <Line
        label="Non-receipted costs"
        sub={`${totals.ownCount} ${totals.ownCount === 1 ? 'entry' : 'entries'}`}
        value={totals.ownTotal}
      />
      <Line label="of which invoiced" value={totals.invoiced} indent tone={color.success} />
      <Line label="not invoiced"      value={totals.notInvoiced} indent tone={color.accent} />

      {hasReceipted && (
        <Line
          label="Receipted (in Xero)"
          sub={`${totals.receiptedCount} ${totals.receiptedCount === 1 ? 'expense' : 'expenses'}`}
          value={totals.receiptedTotal}
        />
      )}

      <div style={{ borderTop: `1px solid ${color.border}`, marginTop: space.md, paddingTop: space.md }}>
        <Line label="Total project cost" value={totals.grandTotal} strong />
      </div>
    </section>
  );
}

function Line({ label, sub, value, indent, strong, tone }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: space.md, padding: '5px 0', paddingLeft: indent ? space.lg : 0,
    }}>
      <span style={{
        fontSize: strong ? font.size.md : font.size.sm,
        fontWeight: strong ? 600 : 400,
        color: tone || (indent ? color.muted : color.text),
      }}>
        {label}
        {sub && <span style={{ color: color.subtle, fontSize: font.size.xs }}> · {sub}</span>}
      </span>
      <span style={{
        fontSize: strong ? font.size.lg : font.size.sm,
        fontWeight: strong ? 600 : 500,
        fontVariantNumeric: 'tabular-nums',
        color: tone || color.text,
        flexShrink: 0,
      }}>{formatAmount(value)}</span>
    </div>
  );
}
