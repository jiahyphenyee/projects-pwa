'use client';

// The Summary's view of quote and billing: every quote on the project (one group each when
// there are several), each with its payment stages and variation orders, their amounts and
// whether they have been billed, so what is still to invoice is visible
// without opening the quote. A VO waiting for the final invoice says so; its amount is
// already inside the final payment's. Rows go through LineRow like every other list.
// Billing itself happens on the quote screen, which the panel links to.

import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import Panel from '@/app/components/dashboard/Panel';
import { formatAmount } from '@/app/components/TotalsCard';
import { quoteLabel } from '@/lib/quoteGroups.mjs';
import { color, font } from '@/lib/theme';

/**
 * `summary`: billingSummary() from /api/quotes?summary=, or `{ error }`, or null while loading.
 * `projectInvoiced`: every Xero invoice matched to the project (the Xero invoices panel's
 * total); what it exceeds the quote's billed figure by was invoiced outside this quote —
 * hand-raised in Xero, or for work the quote does not cover — and is said so, since the
 * quote alone would understate what the client has been asked to pay.
 */
export default function QuoteBillingCard({ projectCode, summary, projectInvoiced = null }) {
  const base = `/projects/${encodeURIComponent(projectCode)}/quote`;
  const has = summary && !summary.error && summary.quoteId;
  const groups = has ? (summary.quotes?.length ? summary.quotes : [{ ...summary, title: '' }]) : [];
  const several = groups.length > 1;
  const outside = has && projectInvoiced !== null ? Math.round((projectInvoiced - summary.billed) * 100) / 100 : 0;

  return (
    <Panel
      title={several ? `Quotes and billing (${groups.length})` : 'Quote and billing'}
      subtitle={has
        ? `${several ? 'Quoted' : 'Contract sum'} $${formatAmount(summary.contractSum)} · billed $${formatAmount(summary.billed)} · to bill $${formatAmount(summary.unbilled)}`
        : 'Write the quote, then bill it in full to Xero, or by deposit and stages'}
      action={{ href: has ? `${base}/${encodeURIComponent(groups[0].quoteId)}` : `${base}/new`, label: has ? (several ? 'Open first quote' : 'Open quote') : 'Write the quote' }}
    >
      {summary?.error && (
        <p style={{ margin: 0, fontSize: font.size.xs, color: color.danger }}>{summary.error}</p>
      )}
      {!summary && <p style={{ margin: 0, fontSize: font.size.xs, color: color.muted }}>Loading…</p>}
      {has && summary.liveBilled === false && (
        <p style={{ margin: 0, fontSize: font.size.xs, color: color.accent }}>Billed amounts could not be refreshed from Xero just now; figures are from when each stage was billed.</p>
      )}
      {outside > 0.005 && (
        <p style={{ margin: 0, fontSize: font.size.xs, color: color.muted }}>Plus ${formatAmount(outside)} invoiced in Xero outside {several ? 'these quotes' : 'this quote'} (see Xero invoices).</p>
      )}

      {groups.map(g => (
        <div key={g.quoteId}>
          {several && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 12, marginBottom: 4 }}>
              <a href={`${base}/${encodeURIComponent(g.quoteId)}`} style={{ fontSize: font.size.sm, fontWeight: 600, color: color.text, textDecoration: 'none' }}>
                {quoteLabel({ id: g.quoteId, title: g.title })}{g.declined ? ' (declined)' : ''}
              </a>
              <span style={{ fontSize: font.size.xs, color: color.muted }}>
                ${formatAmount(g.contractSum)} · billed ${formatAmount(g.billed)} · to bill ${formatAmount(g.unbilled)}
              </span>
            </div>
          )}
          {(g.items || []).map((item, i) => (
            <LineRow
              key={`${item.kind}-${i}`}
              first={i === 0}
              label={item.label}
              amount={item.amount < 0 ? `−$${formatAmount(-item.amount)}` : `$${formatAmount(item.amount)}`}
              meta={item.billed ? item.number : item.onFinal ? 'Included in the final payment' : ''}
              tags={<Tag variant={item.billed ? 'invoiced' : item.onFinal ? 'neutral' : 'notInvoiced'}>{item.billed ? 'Billed' : item.onFinal ? 'On final invoice' : 'Not billed'}</Tag>}
            />
          ))}
        </div>
      ))}
      {has && (
        <a href={`${base}/new`} style={{ display: 'inline-block', marginTop: 12, fontSize: font.size.xs, color: color.accent }}>+ New quote for another piece of work</a>
      )}
    </Panel>
  );
}
