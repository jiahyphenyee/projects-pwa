'use client';

// Quoted against spent, per service (Categories code). The rows always add up to the
// totals row, which matches the tiles above: lines with no category have their own row
// rather than dropping out. With a quote, each service shows how much of its quoted
// amount it has used, as a bar and a percent, toned like the job's own flag.
//
// A table, not LineRows: it is a grid of figures read across and down. It scrolls inside
// its own box, so the page itself never scrolls sideways on a phone.

import Panel from '@/app/components/dashboard/Panel';
import { scrollBox, table, th, td, firstCol, lastCol, rowRule, totalRule } from '@/app/components/dashboard/table';
import { UNASSIGNED } from '@/lib/projectFigures.mjs';
import { color, radius, space, tag as palette } from '@/lib/theme';
import { money, percent } from './format';

/** Spent as a share of quoted: under the budget line is fine, near it amber, over it red. */
function toneOf(ratio, settings) {
  const budgetShare = 1 - settings.targetMarginPct / 100;
  if (ratio > 1) return palette.danger.fg;
  if (ratio > budgetShare) return palette.notInvoiced.fg;
  return color.primary;
}

function UsedBar({ ratio, settings }) {
  if (ratio === null || ratio === undefined) return <span style={{ color: color.subtle }}>–</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, justifyContent: 'flex-end' }}>
      <span aria-hidden style={{ width: 90, height: 8, background: color.bg, borderRadius: radius.sm, overflow: 'hidden' }}>
        <span style={{
          display: 'block', height: 8, width: `${Math.min(100, ratio * 100)}%`, background: toneOf(ratio, settings),
        }} />
      </span>
      <span style={{ minWidth: 40 }}>{percent(ratio)}</span>
    </span>
  );
}

/** `breakdown`: serviceBreakdown(). Own labour shows only once anything is booked to it. */
export default function ServiceBreakdownCard({ breakdown, settings }) {
  const { rows, totals } = breakdown;
  const hasQuote = totals.quoted !== null;
  const columns = [
    hasQuote && { key: 'quoted', label: 'Quoted' },
    { key: 'materials', label: 'Materials' },
    { key: 'subcon', label: 'Subcon' },
    totals.ownLabour !== 0 && { key: 'ownLabour', label: 'Own labour' },
    { key: 'transport', label: 'Transport' },
    { key: 'total', label: 'Total cost', strong: true },
    hasQuote && { key: 'pctOfQuote', label: 'Cost as % of quote', ratio: true },
  ].filter(Boolean);

  const render = (row, col) => {
    if (col.ratio) return <UsedBar ratio={row[col.key]} settings={settings} />;
    const v = row[col.key];
    return v === 0 ? <span style={{ color: color.subtle }}>–</span> : money(v);
  };

  return (
    <Panel
      title="Breakdown by service"
      subtitle={hasQuote ? 'Quoted amount against actual cost for each service' : 'No quote yet, so cost only'}
    >
      {!rows.length ? null : (
        <div style={scrollBox}>
          <table style={{ ...table, minWidth: hasQuote ? 760 : 520 }}>
            <thead>
              <tr>
                <th style={{ ...th, ...firstCol }}>Service</th>
                {columns.map((c, i) => (
                  <th key={c.key} style={{ ...th, ...(i === columns.length - 1 ? lastCol : null) }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.code || UNASSIGNED} style={rowRule}>
                  <td style={{ ...td, ...firstCol, fontWeight: 600, color: row.code ? color.text : color.muted }}>
                    {row.code || 'No service'}
                  </td>
                  {columns.map((c, i) => (
                    <td key={c.key} style={{
                      ...td, ...(i === columns.length - 1 ? lastCol : null), fontWeight: c.strong ? 600 : 400,
                    }}>{render(row, c)}</td>
                  ))}
                </tr>
              ))}
              <tr style={totalRule}>
                <td style={{ ...td, ...firstCol }}>Total</td>
                {columns.map((c, i) => (
                  <td key={c.key} style={{ ...td, ...(i === columns.length - 1 ? lastCol : null) }}>{render(totals, c)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
