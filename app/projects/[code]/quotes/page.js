'use client';

// A project's Quotes page (workflow): every quote and variation order with the client's
// answer, and the quotes made in Xero before this app wrote quotes.
//
// The client's answer is recorded here: Sent, Accepted, Declined, each with its date. No
// invoice can be created until the client has accepted (lib/clientAcceptance.mjs, checked
// again by lib/billing.js). Invoices themselves are still created on the quote screen,
// which each row opens. Xero quotes are read-only, with a PDF.

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import { money } from '@/app/components/project/format';
import { useProjects } from '@/lib/useProjects';
import { useViewer } from '@/lib/useViewer';
import { formatIsoDate, todaySingapore } from '@/lib/dates';
import { describeAge } from '@/lib/localCache';
import { PERMISSIONS } from '@/lib/roles.mjs';
import { CLIENT_STATUS_LABELS, clientAccepted } from '@/lib/clientAcceptance.mjs';
import { button, card, color, dateInput, font, space } from '@/lib/theme';

const section = { ...card, padding: space.lg, minWidth: 0 };
const h2 = { margin: 0, fontSize: font.size.md, fontWeight: 600, color: color.text };
const help = { margin: `${space.xs}px 0 ${space.sm}px`, fontSize: font.size.xs, color: color.muted, lineHeight: 1.5 };
const link = { fontSize: font.size.sm, fontWeight: 600, color: color.primary, textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' };

const STATUS_VARIANT = { '': 'neutral', sent: 'notInvoiced', accepted: 'invoiced', declined: 'danger' };
const XERO_STATUS = {
  DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', DECLINED: 'Declined', INVOICED: 'Invoiced',
};

function QuoteCard({ q, code, anyBilled, onSave, busy }) {
  const [date, setDate] = useState(todaySingapore());
  const status = q.clientStatus || '';
  const implicit = !status && anyBilled;
  const billed = anyBilled || !!q.xeroInvoiceId;
  const isVo = q.kind === 'vo';
  const label = isVo ? `VO${q.voNumber ?? ''}` : `Quote ${q.id}${q.issueVersion ? ` · v${q.issueVersion}` : ''}`;
  const href = isVo
    ? `/projects/${encodeURIComponent(code)}/quote/vo/${encodeURIComponent(q.id)}`
    : `/projects/${encodeURIComponent(code)}/quote`;
  const meta = [
    q.clientSentAt ? `Sent ${formatIsoDate(q.clientSentAt)}` : null,
    q.clientAcceptedAt ? `${status === 'declined' ? 'Declined' : 'Accepted'} ${formatIsoDate(q.clientAcceptedAt)}` : null,
    implicit ? 'billed before this step existed, so treated as accepted' : null,
  ].filter(Boolean).join(' · ');

  const choices = [
    ['sent', 'Sent'],
    ['accepted', 'Accepted'],
    ...(billed ? [] : [['declined', 'Declined']]),
  ].filter(([s]) => s !== status && !(billed && s === 'sent') && !(status === 'accepted' && s === 'sent'));

  return (
    <div style={{ borderTop: `1px solid ${color.border}`, paddingTop: space.sm, marginTop: space.sm }}>
      <LineRow
        first
        label={label}
        amount={money(q.contractSum)}
        meta={meta}
        tags={<Tag variant={STATUS_VARIANT[implicit ? 'accepted' : status] || 'neutral'}>
          {implicit ? CLIENT_STATUS_LABELS.accepted : CLIENT_STATUS_LABELS[status] || CLIENT_STATUS_LABELS['']}
        </Tag>}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        <Link href={href} style={link}>Open{billed || clientAccepted(q, { anyBilled }) ? ' to bill' : ''} →</Link>
        <a href={`/api/quotes/pdf?quote=${encodeURIComponent(q.id)}`} style={link}>PDF</a>
      </div>
      {choices.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, alignItems: 'center', marginTop: space.xs }}>
          <label style={{ fontSize: font.size.xs, color: color.muted }} htmlFor={`date-${q.id}`}>Client answered on</label>
          <input
            id={`date-${q.id}`}
            type="date"
            value={date}
            max={todaySingapore()}
            onChange={e => setDate(e.target.value)}
            style={{ ...dateInput, width: 'auto', minWidth: 0, flex: '0 1 170px' }}
          />
          {choices.map(([s, text]) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => onSave(q, s, date)}
              style={{
                ...(s === 'accepted' ? button.primary : button.secondary),
                minHeight: 44, padding: '0 14px', fontSize: font.size.sm, opacity: busy ? 0.6 : 1,
              }}
            >Mark {text.toLowerCase()}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectQuotesPage({ params }) {
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);
  const router = useRouter();
  const base = `/projects/${encodeURIComponent(code)}`;

  const { projects } = useProjects();
  const { can, ready } = useViewer();
  const allowed = ready && can(PERMISSIONS.QUOTES);

  useEffect(() => {
    if (ready && !allowed) router.replace(`${base}/costs`);
  }, [ready, allowed, base, router]);

  const project = useMemo(() => projects.find(p => p.code === code) || null, [projects, code]);

  const [quotes, setQuotes] = useState(null);
  const [summary, setSummary] = useState(null);
  const [xero, setXero] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    const get = async url => {
      const res = await fetch(url, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load');
      return body;
    };
    try {
      const [list, sum] = await Promise.all([
        get(`/api/quotes?project=${encodeURIComponent(code)}`),
        get(`/api/quotes?summary=${encodeURIComponent(code)}`),
      ]);
      setQuotes(list.quotes || []);
      setSummary(sum);
      setError('');
    } catch (err) {
      setError(err.message);
    }
    // Xero settles on its own: slow or refused, the app's own quotes still show
    get(`/api/quotes/xero?project=${encodeURIComponent(code)}`)
      .then(setXero)
      .catch(err => setXero({ error: err.message }));
  }, [code]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  async function save(q, status, date) {
    setBusyId(q.id);
    try {
      const res = await fetch('/api/quotes/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: q.id, status, date }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save');
      setQuotes(list => list.map(x => (x.id === q.id ? { ...x, ...body.quote } : x)));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  // The main quote counts as billed once any of its stages is; a VO by its own invoice
  const stagesBilled = !!summary?.items?.some(i => i.kind === 'stage' && i.billed);

  return (
    <AppShell
      title={project?.address || code}
      subtitle={project ? `${project.code} · Quotes` : 'Quotes'}
      onBack={() => router.push(base)}
    >
      {(!ready || (allowed && !quotes && !error)) && (
        <p style={{ fontSize: font.size.sm, color: color.muted }}>Loading quotes…</p>
      )}
      {error && <p style={{ fontSize: font.size.sm, color: color.danger }}>{error}</p>}

      {allowed && quotes && (
        <div style={{ display: 'grid', gap: space.lg }}>
          <section style={section}>
            <h2 style={h2}>Quotes and variation orders</h2>
            <p style={help}>
              Record the client&rsquo;s answer here. No invoice can be created until the client has accepted.
              Invoices are created on the quote itself: open it to bill a stage.
            </p>
            {quotes.length === 0 && (
              <p style={{ ...help, marginBottom: 0 }}>
                No quote yet. <Link href={`${base}/quote`} style={{ color: color.primary }}>Write the quote →</Link>
              </p>
            )}
            {quotes.map(q => (
              <QuoteCard
                key={q.id}
                q={q}
                code={code}
                anyBilled={q.kind === 'quote' ? stagesBilled : !!q.xeroInvoiceId}
                busy={busyId === q.id}
                onSave={save}
              />
            ))}
          </section>

          <section style={section}>
            <h2 style={h2}>Earlier quotes in Xero</h2>
            <p style={help}>Quotes made in Xero before this app. Read-only; matched to this project by Reference.</p>
            {!xero && <p style={{ ...help, marginBottom: 0 }}>Loading from Xero…</p>}
            {xero?.error && <p style={{ ...help, marginBottom: 0, color: color.danger }}>{xero.error}</p>}
            {xero?.noPermission && (
              <p style={{ ...help, marginBottom: 0, color: color.accent }}>
                This app&rsquo;s Xero connection has no permission to read quotes. Reconnect Xero with quotes
                allowed to see them here.
              </p>
            )}
            {xero && !xero.error && !xero.noPermission && xero.quotes.length === 0 && (
              <p style={{ ...help, marginBottom: 0 }}>No Xero quote has this address as its Reference.</p>
            )}
            {xero?.quotes?.map((q, i) => (
              <LineRow
                key={q.id}
                first={i === 0}
                label={q.number || '(no number)'}
                amount={money(q.total)}
                meta={[q.contact, formatIsoDate(q.date), q.title].filter(Boolean).join(' · ')}
                tags={<Tag variant="neutral">{XERO_STATUS[q.status] || q.status}</Tag>}
                action={<a href={`/api/quotes/xero?pdf=${encodeURIComponent(q.id)}`} style={{ ...link, width: 52, justifyContent: 'center' }}>PDF</a>}
              />
            ))}
            {xero?.ambiguous?.length > 0 && (
              <p style={{ ...help, color: color.accent }}>
                Also fits another project, so not listed: {xero.ambiguous.map(q => `${q.number} (${q.candidates.join(', ')})`).join('; ')}.
              </p>
            )}
            {xero?.fetchedAt && (
              <p style={{ ...help, marginBottom: 0, color: color.subtle }}>From Xero {describeAge(xero.fetchedAt)}</p>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
