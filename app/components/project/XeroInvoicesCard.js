'use client';

// The project's sales invoices in Xero: what was invoiced, collected and still owed, and
// each invoice's age. Matched to the project by Reference (lib/projectFigures.mjs);
// anything that could belong to more than one project is listed, never guessed.
//
// "Xero invoices", not "Invoiced": the cost list's tick column already uses that word
// for a cost recharged to the client, and the two mean different things.
//
// Each row carries its stage (from this app's billing, or "Payment n (auto)" by date for
// older invoices) and a PDF link. Drafts are listed greyed and never counted. Linking an
// invoice to the project is an edit, so it lives on the Invoices screen, not here.

import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import Panel from '@/app/components/dashboard/Panel';
import { formatIsoDate } from '@/lib/dates';
import { describeAge } from '@/lib/localCache';
import { color, font, space } from '@/lib/theme';
import { money, INVOICE_STATE } from './format';

const note = { margin: `${space.sm}px 0 0`, fontSize: font.size.xs, color: color.muted, lineHeight: 1.5 };

// The PDF link sits in the row's action column: a link, so it never edits from a dashboard.
const PDF_WIDTH = 52;
const pdfLink = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: PDF_WIDTH, minHeight: 44, flexShrink: 0,
  fontSize: font.size.sm, fontWeight: 600, color: color.primary, textDecoration: 'none',
};

/** `summary`: summariseInvoices(). `invoices`: the route's invoices part. `code`: the project. */
export default function XeroInvoicesCard({ code, address, summary, invoices }) {
  const error = invoices?.error;

  const subtitle = summary
    ? `${money(summary.invoiced)} invoiced · ${money(summary.collected)} collected · ${money(summary.outstanding)} outstanding`
    : null;

  return (
    <Panel
      title="Xero invoices"
      subtitle={subtitle}
      action={code ? { href: `/projects/${encodeURIComponent(code)}/invoices`, label: 'Link invoices' } : undefined}
    >
      {error && <p style={{ ...note, marginTop: 0, color: color.danger }}>{error}. The cost figures are unaffected.</p>}
      {!invoices && !error && <p style={{ ...note, marginTop: 0 }}>Loading…</p>}

      {summary?.items.length === 0 && (
        <p style={{ ...note, marginTop: 0 }}>
          No Xero invoice found for this project. Invoices are matched on Reference
          = &ldquo;{address}&rdquo;; link any other on the Invoices screen.
        </p>
      )}

      {summary?.items.map((doc, i) => {
        const state = INVOICE_STATE[doc.state] || INVOICE_STATE.unpaid;
        const draft = doc.state === 'draft';
        const meta = [
          doc.stage ? (doc.stageAuto ? `${doc.stage} (auto)` : doc.stage) : null,
          formatIsoDate(doc.date),
          doc.ageDays !== null ? `${doc.ageDays} days` : null,
          !draft && doc.paid > 0 && doc.due > 0 ? `${money(doc.paid)} paid` : null,
          doc.matchedBy === 'unit' ? 'matched on unit number' : null,
          doc.matchedBy === 'linked' ? 'linked by hand' : null,
        ].filter(Boolean).join(' · ');
        return (
          <LineRow
            key={doc.id}
            first={i === 0}
            dimmed={draft}
            label={doc.number || '(no number)'}
            amount={money(doc.kind === 'credit' ? -doc.total : doc.total)}
            meta={meta}
            tags={<Tag variant={state.variant}>{state.label}</Tag>}
            action={doc.kind === 'invoice'
              ? <a href={`/api/invoices/pdf?id=${encodeURIComponent(doc.id)}`} style={pdfLink} aria-label={`Download ${doc.number} as PDF`}>PDF</a>
              : <span style={{ width: PDF_WIDTH, flexShrink: 0 }} />}
          />
        );
      })}

      {invoices?.ambiguous?.length > 0 && (
        <p style={{ ...note, color: color.accent }}>
          Not counted, because the Reference fits more than one project:{' '}
          {invoices.ambiguous.map(d => `${d.number} (${d.candidates.join(', ')})`).join('; ')}.
          Link it on the Invoices screen to count it here.
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
