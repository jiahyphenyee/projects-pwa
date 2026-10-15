'use client';

// "Where the cost went": the four buckets as one bar, each named with its amount and
// share underneath, and which ledger the money was recorded in. Colour never carries the
// meaning alone — every segment is named in the legend.

import Panel from '@/app/components/dashboard/Panel';
import { color, font, radius, space, tag as palette } from '@/lib/theme';
import { money, percent } from './format';

const BUCKET_COLOR = {
  materials: palette.material.fg,
  subcon:    palette.externalLabour.fg,
  ownLabour: palette.internalLabour.fg,
  transport: palette.transport.fg,
};

export default function CostSplitPanel({ split }) {
  return (
    <Panel
      title="Where the cost went"
      subtitle={`Receipted (in Xero) ${money(split.receipted)} · Non-receipted ${money(split.nonReceipted)}`}
    >
      {!split.total ? (
        <p style={{ margin: 0, fontSize: font.size.sm, color: color.muted }}>No costs recorded yet.</p>
      ) : (
        <>
          <div aria-hidden style={{
            display: 'flex', gap: 2, height: 16, borderRadius: radius.sm, overflow: 'hidden', background: color.bg,
          }}>
            {split.buckets.filter(b => b.share > 0).map(b => (
              <span key={b.key} style={{ flex: `0 0 ${b.share * 100}%`, background: BUCKET_COLOR[b.key] }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${space.xs}px ${space.xl}px`, marginTop: space.md }}>
            {split.buckets.map(b => (
              <div key={b.key} style={{
                display: 'flex', alignItems: 'center', gap: space.sm,
                fontSize: font.size.sm, color: b.amount ? color.text : color.subtle,
                fontVariantNumeric: 'tabular-nums',
              }}>
                <span aria-hidden style={{
                  width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                  background: BUCKET_COLOR[b.key], opacity: b.amount ? 1 : 0.3,
                }} />
                <span>
                  {b.label} {money(b.amount)} · {percent(b.share)}
                  {b.key === 'ownLabour' && <span style={{ color: color.subtle }}> (labour log not live)</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
