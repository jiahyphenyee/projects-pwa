'use client';

// The six headline figures of the build spec's Project page, as tiles. Each figure that
// cannot exist yet says why in its note, rather than showing $0.00 or a broken percent.

import StatTile from '@/app/components/dashboard/StatTile';
import { TileGrid } from '@/app/components/dashboard/Grid';
import { money, percent } from './format';

export default function SummaryTiles({ cost, figures, quoteError, invoicesError }) {
  const f = figures;
  const hasQuote = f && f.quoted !== null;
  const loading = !f;

  return (
    <TileGrid>
      <StatTile
        label="Quoted"
        value={loading ? '…' : hasQuote ? money(f.quoted) : 'No quote'}
        muted={!hasQuote}
        note={quoteError ? 'Could not load the quote' : hasQuote ? 'Quote plus variation orders' : 'Write one to track budget'}
      />
      <StatTile label="Cost to date" value={money(cost)} note="Materials, subcon, own labour, transport" />
      <StatTile
        label={f?.completed ? 'Profit' : 'Profit so far'}
        value={loading ? '…' : money(f.profit)}
        muted={!loading && f.profit === null}
        note={loading ? null
          : f.profit !== null ? `${percent(f.margin)} margin`
          : f.completed ? (invoicesError ? 'Needs Xero' : 'Nothing invoiced yet')
          : 'Needs a quote'}
      />
      <StatTile
        label="Budget used"
        value={loading ? '…' : percent(f.budgetUsed)}
        muted={!loading && f.budgetUsed === null}
        note={f?.budget !== null && f?.budget !== undefined ? `of ${money(f.budget)} budget` : 'Budget comes from the quote'}
      />
      <StatTile
        label="Invoiced"
        value={loading ? '…' : money(f.invoiced)}
        muted={!loading && f.invoiced === null}
        note={invoicesError ? 'Xero unavailable' : f?.collected !== null && f?.collected !== undefined ? `${money(f.collected)} collected` : null}
      />
      <StatTile
        label="Outstanding"
        value={loading ? '…' : money(f.outstanding)}
        muted={!loading && f.outstanding === null}
        note={f?.notYetInvoiced > 0 ? `${money(f.notYetInvoiced)} not yet invoiced` : 'Invoiced, not yet paid'}
      />
    </TileGrid>
  );
}
