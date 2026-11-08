'use client';

// The Summary's view of quote and billing: every payment stage and variation order with
// its amount and whether it has been billed, so what is still to invoice is visible
// without opening the quote. A VO waiting for the final invoice says so; its amount is
// already inside the final payment's. Rows go through LineRow like every other list.
// Billing itself happens on the quote screen, which the panel links to.

import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import Panel from '@/app/components/dashboard/Panel';
import { formatAmount } from '@/app/components/TotalsCard';
import { color, font } from '@/lib/theme';

/** `summary`: billingSummary() from /api/quotes?summary=, or `{ error }`, or null while loading. */
export default function QuoteBillingCard({ projectCode, summary }) {
  const href = `/projects/${encodeURIComponent(projectCode)}/quote`;
  const has = summary && !summary.error && summary.quoteId;

  return (
    <Panel
      title="Quote and billing"
      subtitle={has
        ? `Contract sum $${formatAmount(summary.contractSum)} · billed $${formatAmount(summary.billed)} · to bill $${formatAmount(summary.unbilled)}`
        : 'Write the quote, then bill it in full to Xero, or by deposit and stages'}
      action={{ href, label: has ? 'Open quote' : 'Write the quote' }}
    >
      {summary?.error && (
        <p style={{ margin: 0, fontSize: font.size.xs, color: color.danger }}>{summary.error}</p>
      )}
      {!summary && <p style={{ margin: 0, fontSize: font.size.xs, color: color.muted }}>Loading…</p>}

      {summary?.items?.map((item, i) => (
        <LineRow
          key={`${item.kind}-${i}`}
          first={i === 0}
          label={item.label}
          amount={item.amount < 0 ? `−$${formatAmount(-item.amount)}` : `$${formatAmount(item.amount)}`}
          meta={item.billed ? item.number : item.onFinal ? 'Included in the final payment' : ''}
          tags={<Tag variant={item.billed ? 'invoiced' : item.onFinal ? 'neutral' : 'notInvoiced'}>{item.billed ? 'Billed' : item.onFinal ? 'On final invoice' : 'Not billed'}</Tag>}
        />
      ))}
    </Panel>
  );
}
