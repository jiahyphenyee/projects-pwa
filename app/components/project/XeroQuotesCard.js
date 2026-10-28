'use client';

// The project dashboard's "Quotes in Xero" panel: quotes made in Xero before this app
// wrote quotes, matched to the project by Reference. Read-only, each with a PDF. It loads
// on its own, so a slow or refused Xero never holds up the rest of the dashboard.

import { useEffect, useState } from 'react';
import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import Panel from '@/app/components/dashboard/Panel';
import { money } from '@/app/components/project/format';
import { formatIsoDate } from '@/lib/dates';
import { describeAge } from '@/lib/localCache';
import { color, font, space } from '@/lib/theme';

const STATUS = { DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', DECLINED: 'Declined', INVOICED: 'Invoiced' };
const VARIANT = { ACCEPTED: 'invoiced', INVOICED: 'invoiced', DECLINED: 'danger', SENT: 'notInvoiced' };
const note = { margin: 0, fontSize: font.size.xs, color: color.muted, lineHeight: 1.5 };
const pdfLink = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, width: 52,
  fontSize: font.size.sm, fontWeight: 600, color: color.primary, textDecoration: 'none',
};

export default function XeroQuotesCard({ code }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    fetch(`/api/quotes/xero?project=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not load Xero quotes');
        return body;
      })
      .catch(err => ({ error: err instanceof TypeError ? 'Offline — Xero quotes cannot be loaded' : err.message }))
      .then(body => { if (live) setData(body); });
    return () => { live = false; };
  }, [code]);

  const quotes = data?.quotes || [];
  return (
    <Panel
      title="Quotes in Xero"
      subtitle={data?.fetchedAt ? `Read-only, matched by Reference · from Xero ${describeAge(data.fetchedAt)}` : 'Read-only, matched by Reference'}
    >
      {!data && <p style={note}>Loading from Xero…</p>}
      {data?.error && <p style={{ ...note, color: color.danger }}>{data.error}</p>}
      {data?.noPermission && (
        <p style={{ ...note, color: color.accent }}>
          This app&rsquo;s Xero connection cannot read quotes. Run <code>node scripts/xero-auth.mjs</code> once to reconnect.
        </p>
      )}
      {data && !data.error && !data.noPermission && quotes.length === 0 && (
        <p style={note}>No Xero quote has this project&rsquo;s address as its Reference.</p>
      )}
      {quotes.map((q, i) => (
        <LineRow
          key={q.id}
          first={i === 0}
          label={q.number || '(no number)'}
          amount={money(q.total)}
          meta={[q.contact, formatIsoDate(q.date), q.title].filter(Boolean).join(' · ')}
          tags={<Tag variant={VARIANT[q.status] || 'neutral'}>{STATUS[q.status] || q.status}</Tag>}
          action={<a href={`/api/quotes/xero?pdf=${encodeURIComponent(q.id)}`} style={pdfLink} aria-label={`PDF of ${q.number || 'quote'}`}>PDF</a>}
        />
      ))}
      {data?.ambiguous?.length > 0 && (
        <p style={{ ...note, marginTop: space.sm, color: color.accent }}>
          Also fits another project, so not listed: {data.ambiguous.map(q => `${q.number} (${q.candidates.join(', ')})`).join('; ')}.
        </p>
      )}
    </Panel>
  );
}
