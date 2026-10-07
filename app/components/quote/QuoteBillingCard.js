'use client';

// The project screen's view of quote and billing: every payment stage and variation order
// with its amount and whether it has been billed, so what is still to invoice is visible
// without opening the quote. Rows go through LineRow like every other list on this screen.

import { useEffect, useState } from 'react';
import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import { formatAmount } from '@/app/components/TotalsCard';
import { card, color, font, space } from '@/lib/theme';

export default function QuoteBillingCard({ projectCode, onOpen }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/quotes?summary=${encodeURIComponent(projectCode)}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load billing'); return d; })
      .then(d => { if (live) setSummary(d); })
      .catch(err => { if (live) setError(err instanceof TypeError ? 'Offline' : err.message); });
    return () => { live = false; };
  }, [projectCode]);

  return (
    <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
      <button type="button" className="row-label" onClick={onOpen} style={{
        display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: space.md,
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        fontFamily: font.stack, color: color.text,
      }}>
        <span>
          <span className="row-label-text" style={{ display: 'block', fontSize: font.size.md, fontWeight: 600 }}>Quote and billing</span>
          <span style={{ display: 'block', fontSize: font.size.xs, color: color.muted, marginTop: 2 }}>
            {summary?.quoteId
              ? `Contract sum $${formatAmount(summary.contractSum)} · billed $${formatAmount(summary.billed)} · to bill $${formatAmount(summary.unbilled)}`
              : 'Write the quote, set the payment schedule, bill stages to Xero'}
          </span>
        </span>
        <span aria-hidden="true" style={{ fontSize: font.size.lg, color: color.muted }}>→</span>
      </button>

      {error && <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.xs, color: color.danger }}>{error}</p>}

      {summary?.items?.length > 0 && (
        <div style={{ marginTop: space.sm }}>
          {summary.items.map((item, i) => (
            <LineRow
              key={`${item.kind}-${i}`}
              first={i === 0}
              label={item.label}
              amount={`$${formatAmount(item.amount)}`}
              meta={item.billed ? item.number : ''}
              tags={<Tag variant={item.billed ? 'invoiced' : 'notInvoiced'}>{item.billed ? 'Billed' : 'Not billed'}</Tag>}
            />
          ))}
        </div>
      )}
    </section>
  );
}
