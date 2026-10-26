'use client';

// A project's Invoices screen (workflow): link Xero invoices that matching cannot place.
//
// Most invoices find their project on their own — this app's billing record, or the
// Reference (lib/projectFigures.mjs → assignDocuments). Two kinds never can: an address
// shared by two projects (one billed to the ID firm, one to the owner), and an old invoice
// whose Reference was typed differently. A link here is stored in the `Xero links` tab and
// wins over both. Nothing is written to Xero.
//
// Reached from the "Link invoices" action on the Xero invoices panel, so the Summary and
// Billing views stay read-only.

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import { money, INVOICE_STATE } from '@/app/components/project/format';
import { useProjects } from '@/lib/useProjects';
import { useViewer } from '@/lib/useViewer';
import { formatIsoDate } from '@/lib/dates';
import { describeAge } from '@/lib/localCache';
import { PERMISSIONS } from '@/lib/roles.mjs';
import { button, card, color, font, input, space } from '@/lib/theme';

const ACTION_WIDTH = 92;
const SEARCH_LIMIT = 30;

const section = { ...card, padding: space.lg, minWidth: 0 };
const h2 = { margin: 0, fontSize: font.size.md, fontWeight: 600, color: color.text };
const help = { margin: `${space.xs}px 0 ${space.sm}px`, fontSize: font.size.xs, color: color.muted, lineHeight: 1.5 };

function ActionButton({ children, onClick, busy, quiet }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        ...(quiet ? button.secondary : button.primary),
        width: ACTION_WIDTH, minHeight: 44, padding: '0 8px', flexShrink: 0,
        fontSize: font.size.sm, opacity: busy ? 0.6 : 1,
      }}
    >{busy ? 'Saving…' : children}</button>
  );
}

function InvoiceRow({ doc, first, action, extraMeta }) {
  const credit = doc.kind === 'credit';
  const state = doc.draft ? INVOICE_STATE.draft
    : credit ? INVOICE_STATE.credit
    : (Number(doc.due) > 0 ? INVOICE_STATE.unpaid : INVOICE_STATE.paid);
  const meta = [doc.contact, formatIsoDate(doc.date), doc.reference ? `Ref: ${doc.reference}` : null, extraMeta]
    .filter(Boolean).join(' · ');
  return (
    <LineRow
      first={first}
      dimmed={doc.draft}
      label={doc.number || '(no number)'}
      amount={money(credit ? -doc.total : doc.total)}
      meta={meta}
      tags={<Tag variant={state.variant}>{state.label}</Tag>}
      action={action}
    />
  );
}

export default function ProjectInvoicesPage({ params }) {
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);
  const router = useRouter();
  const base = `/projects/${encodeURIComponent(code)}`;

  const { projects } = useProjects();
  const { userName, can, ready } = useViewer();
  const allowed = ready && can(PERMISSIONS.INVOICES);

  useEffect(() => {
    if (ready && !allowed) router.replace(`${base}/costs`);
  }, [ready, allowed, base, router]);

  const project = useMemo(() => projects.find(p => p.code === code) || null, [projects, code]);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices?project=${encodeURIComponent(code)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load Xero invoices');
      setData(body);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [code]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  async function link(doc, projectCode) {
    setBusyId(doc.id);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xeroId: doc.id, xeroNumber: doc.number, projectCode, by: userName || '' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save the link');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  const clientOf = useMemo(
    () => Object.fromEntries((data?.projects || []).map(p => [p.code, p.clientName])),
    [data],
  );
  const candidateNames = codes => codes.map(c => `${c}${clientOf[c] ? ` (${clientOf[c]})` : ''}`).join(' or ');

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    return data.unassigned
      .filter(d => [d.number, d.contact, d.reference].some(v => String(v || '').toLowerCase().includes(q)))
      .slice(0, SEARCH_LIMIT);
  }, [query, data]);

  return (
    <AppShell
      title={project?.address || code}
      subtitle={project ? `${project.code} · Invoices` : 'Invoices'}
      onBack={() => router.push(base)}
    >
      {(!ready || (allowed && !data && !error)) && (
        <p style={{ fontSize: font.size.sm, color: color.muted }}>Loading invoices from Xero…</p>
      )}

      {error && (
        <p style={{ fontSize: font.size.sm, color: color.danger }}>{error}</p>
      )}

      {allowed && data && (
        <div style={{ display: 'grid', gap: space.lg }}>
          <section style={section}>
            <h2 style={h2}>Needs linking</h2>
            <p style={help}>
              These invoices&rsquo; Reference fits this project and another one, so they are not
              counted anywhere yet. Link each to the right project.
            </p>
            {data.ambiguous.length === 0 && <p style={{ ...help, marginBottom: 0 }}>Nothing to link.</p>}
            {data.ambiguous.map((doc, i) => (
              <InvoiceRow
                key={doc.id}
                doc={doc}
                first={i === 0}
                extraMeta={`fits ${candidateNames(doc.candidates)}`}
                action={<ActionButton busy={busyId === doc.id} onClick={() => link(doc, code)}>Link here</ActionButton>}
              />
            ))}
          </section>

          <section style={section}>
            <h2 style={h2}>On this project</h2>
            <p style={help}>Every Xero invoice counted on this project. Drafts are listed but never counted.</p>
            {data.matched.length === 0 && <p style={{ ...help, marginBottom: 0 }}>None yet.</p>}
            {data.matched.map((doc, i) => (
              <InvoiceRow
                key={doc.id}
                doc={doc}
                first={i === 0}
                extraMeta={doc.stage ? (doc.stageAuto ? `${doc.stage} (auto)` : doc.stage) : null}
                action={doc.unlinkable
                  ? <ActionButton quiet busy={busyId === doc.id} onClick={() => link(doc, '')}>Unlink</ActionButton>
                  : <span style={{ width: ACTION_WIDTH, flexShrink: 0 }} />}
              />
            ))}
          </section>

          <section style={section}>
            <h2 style={h2}>Find an invoice</h2>
            <p style={help}>
              Invoices no project has claimed, or placed on another project by Reference only.
              Search by invoice number, client or Reference, then link the one that belongs here.
            </p>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. INV-2604 or Katherine"
              aria-label="Search invoices to link"
              style={input}
            />
            {query.trim() && found.length === 0 && <p style={{ ...help, marginBottom: 0 }}>No invoice to link matches.</p>}
            <div style={{ marginTop: found.length ? space.sm : 0 }}>
              {found.map((doc, i) => (
                <InvoiceRow
                  key={doc.id}
                  doc={doc}
                  first={i === 0}
                  extraMeta={doc.currentProject ? `now counted on ${candidateNames([doc.currentProject])}` : null}
                  action={<ActionButton busy={busyId === doc.id} onClick={() => link(doc, code)}>{doc.currentProject ? 'Move here' : 'Link here'}</ActionButton>}
                />
              ))}
            </div>
          </section>

          {data.fetchedAt && (
            <p style={{ margin: 0, fontSize: font.size.xs, color: color.subtle }}>From Xero {describeAge(data.fetchedAt)}</p>
          )}
        </div>
      )}
    </AppShell>
  );
}
