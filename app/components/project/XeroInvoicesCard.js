'use client';

// The project's sales invoices in Xero: what was invoiced, collected and still owed, and
// each invoice's age. Matched to the project by Reference (lib/projectFigures.mjs);
// anything that could belong to more than one project is listed, never guessed.
//
// "Xero invoices", not "Invoiced": the cost list's tick column already uses that word
// for a cost recharged to the client, and the two mean different things.

import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import Panel from '@/app/components/dashboard/Panel';
import { formatIsoDate } from '@/lib/dates';
import { describeAge } from '@/lib/localCache';
import { color, font, space } from '@/lib/theme';
import { money, INVOICE_STATE } from './format';

const note = { margin: `${space.sm}px 0 0`, fontSize: font.size.xs, color: color.muted, lineHeight: 1.5 };

/** `summary`: summariseInvoices(). `invoices`: the route's invoices part. */
export default function XeroInvoicesCard({ address, summary, invoices }) {
  const error = invoices?.error;

  const subtitle = summary
    ? `${money(summary.invoiced)} invoiced · ${money(summary.collected)} collected · ${money(summary.outstanding)} outstanding`
    : null;

  return (
    <Panel title="Xero invoices" subtitle={subtitle}>
      {error && <p style={{ ...note, marginTop: 0, color: color.danger }}>{error}. The cost figures are unaffected.</p>}
      {!invoices && !error && <p style={{ ...note, marginTop: 0 }}>Loading…</p>}

      {summary?.items.length === 0 && (
        <p style={{ ...note, marginTop: 0 }}>
          No Xero invoice has this address as its Reference. Invoices are matched on
          Reference = &ldquo;{address}&rdquo;.
        </p>
      )}

      {summary?.items.map((doc, i) => {
        const state = INVOICE_STATE[doc.state] || INVOICE_STATE.unpaid;
        const meta = [
          formatIsoDate(doc.date),
          doc.ageDays !== null ? `${doc.ageDays} days` : null,
          doc.matchedBy === 'unit' ? 'matched on unit number' : null,
        ].filter(Boolean).join(' · ');
        return (
          <LineRow
            key={doc.id}
            first={i === 0}
            label={doc.number || '(no number)'}
            amount={money(doc.kind === 'credit' ? -doc.total : doc.total)}
            meta={meta}
            tags={<Tag variant={state.variant}>{state.label}</Tag>}
          />
        );
      })}

      {invoices?.ambiguous?.length > 0 && (
        <p style={{ ...note, color: color.accent }}>
          Not counted, because the Reference fits more than one project:{' '}
          {invoices.ambiguous.map(d => `${d.number} (${d.candidates.join(', ')})`).join('; ')}.
          Correct the Reference in Xero to count it here.
        </p>
      )}

      {invoices && !error && invoices.creditNotesRead === false && (
        <p style={note}>Credit notes could not be read from Xero, so none are deducted.</p>
      )}

      {invoices?.xeroFetchedAt && (
        <p style={{ ...note, color: color.subtle }}>From Xero {describeAge(invoices.xeroFetchedAt)}</p>
      )}
    </Panel>
  );
}
