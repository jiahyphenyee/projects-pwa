'use client';

// What each quote on the project earned, one row per quote: quoted, VOs, cost, margin,
// invoiced, paid, outstanding (lib/quoteCosting.mjs). Tapping a quote lists the costs
// counted on it, so a cost on the wrong quote is easy to spot; the fix is the Quote field
// on the cost. "Not on a quote" collects costs whose trade no quote has, and invoices
// raised by hand in Xero. Invoices themselves, with PDFs, stay on the Xero invoices panel.

import { Fragment, useState } from 'react';
import Link from 'next/link';
import Panel from '@/app/components/dashboard/Panel';
import { scrollBox, table, th, td, firstCol, lastCol, rowRule, totalRule } from '@/app/components/dashboard/table';
import { quoteLabel } from '@/lib/quoteGroups.mjs';
import { color, font, space } from '@/lib/theme';
import { money, percent } from './format';

const COLUMNS = [
  { key: 'quoted', label: 'Quoted' },
  { key: 'vos', label: 'VOs' },
  { key: 'cost', label: 'Cost' },
  { key: 'margin', label: 'Margin', ratio: true },
  { key: 'invoiced', label: 'Invoiced' },
  { key: 'paid', label: 'Paid' },
  { key: 'outstanding', label: 'Outstanding' },
];
const SHOWN_COSTS = 8;

const dash = <span style={{ color: color.subtle }}>–</span>;
const cellValue = (row, col) => {
  const v = row[col.key];
  if (v === null || v === undefined) return dash;
  if (col.ratio) return <span style={{ color: v < 0 ? color.danger : color.text }}>{percent(v)}</span>;
  return v === 0 ? dash : money(v);
};
const edge = i => (i === COLUMNS.length - 1 ? lastCol : null);

/** `table`: quoteTable(). `code`: the project, for the links to each quote and to Costs. */
export default function QuoteCostingCard({ table: data, code }) {
  const [open, setOpen] = useState(null);
  if (!data?.rows.length) return null;
  const base = `/projects/${encodeURIComponent(code)}`;

  return (
    <Panel title="Quotes" subtitle="What each quote earned. Tap one to see the costs counted on it.">
      <div style={scrollBox}>
        <table style={{ ...table, minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ ...th, ...firstCol }}>Quote</th>
              {COLUMNS.map((c, i) => (
                <th key={c.key} style={{ ...th, ...edge(i) }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map(row => {
              const id = row.quoteId || 'none';
              const isOpen = open === id;
              return (
                <Fragment key={id}>
                  <tr style={rowRule}>
                    <td style={{ ...td, ...firstCol }}>
                      <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}
                        style={{
                          minHeight: 40, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left',
                          fontFamily: font.stack, fontSize: font.size.sm, fontWeight: 600,
                          color: row.quoteId ? color.text : color.muted,
                        }}>
                        {isOpen ? '▾ ' : '▸ '}{row.quoteId ? quoteLabel({ id: row.quoteId, title: row.title }) : row.title}
                        {row.declined && <span style={{ fontWeight: 400, color: color.muted }}> (declined)</span>}
                      </button>
                    </td>
                    {COLUMNS.map((c, i) => (
                      <td key={c.key} style={{ ...td, ...edge(i) }}>{cellValue(row, c)}</td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} style={{ ...td, ...firstCol, ...lastCol, textAlign: 'left', whiteSpace: 'normal', paddingBottom: space.md }}>
                        <CostList row={row} base={base} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr style={totalRule}>
              <td style={{ ...td, ...firstCol }}>Total</td>
              {COLUMNS.map((c, i) => (
                <td key={c.key} style={{ ...td, ...edge(i) }}>{cellValue(data.totals, c)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CostList({ row, base }) {
  const lines = [...row.costLines].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: font.size.xs }}>
      {!lines.length && <span style={{ color: color.muted }}>No costs counted on this quote yet.</span>}
      {lines.slice(0, SHOWN_COSTS).map(l => (
        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: space.md }}>
          <span>{l.description || l.categoryName || l.categoryCode}<span style={{ color: color.muted }}> · {l.categoryCode || 'no service'}{l.date ? ` · ${l.date}` : ''}</span></span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(l.amount)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: space.md, marginTop: 4, flexWrap: 'wrap' }}>
        {lines.length > SHOWN_COSTS && <Link href={`${base}/costs`}>and {lines.length - SHOWN_COSTS} more on Costs →</Link>}
        {row.quoteId && <Link href={`${base}/quote/${encodeURIComponent(row.quoteId)}`}>Open the quote →</Link>}
        {!row.quoteId && lines.length > 0 && <span style={{ color: color.muted }}>Set the Quote on a cost to move it onto a quote.</span>}
      </div>
    </div>
  );
}
