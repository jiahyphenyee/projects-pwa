'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import CostForm from '@/app/components/CostForm';
import TotalsCard, { formatAmount } from '@/app/components/TotalsCard';
import Tag from '@/app/components/Tag';
import LineRow from '@/app/components/LineRow';
import { useProjects } from '@/lib/useProjects';
import { recordRecent } from '@/lib/recents';
import { getUser } from '@/lib/session';
import { GENERAL_PROJECT_CODE, COST_TYPES } from '@/lib/constants';
import { formatIsoDate } from '@/lib/dates';
import { button, card, color, font, radius, space } from '@/lib/theme';

const TYPE_LABEL = Object.fromEntries(COST_TYPES.map(t => [t.value, t.label]));

export default function ProjectDetailPage({ params }) {
  // Next 16: params is a Promise, unwrapped with use() in client components
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);

  const { projects, loading: projectsLoading } = useProjects();
  const [userName, setUserName]   = useState('');
  const [costs, setCosts]         = useState([]);
  const [receipted, setReceipted] = useState([]);
  const [totals, setTotals]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [adding, setAdding]       = useState(false);
  const [pendingId, setPending]   = useState(null);
  const [showReceipted, setShowR] = useState(false);
  const [bulkBusy, setBulkBusy]   = useState(false);
  const [editingId, setEditingId] = useState(null);
  const router = useRouter();

  const project = useMemo(
    () => projects.find(p => p.code === code) || null,
    [projects, code]
  );

  useEffect(() => { setUserName(getUser()?.name || ''); }, []);

  useEffect(() => {
    if (userName && project) recordRecent(userName, project.code);
  }, [userName, project]);

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/costs?project=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load costs');
      setCosts(data.costs);
      setReceipted(data.receipted);
      setTotals(data.totals);
      setError('');
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Offline — costs unavailable' : err.message);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  // Optimistic toggle: the row flips immediately, and reverts if the write fails
  async function toggleInvoiced(cost) {
    const next = !cost.invoiced;
    setPending(cost.id);
    setCosts(prev => prev.map(c => c.id === cost.id ? { ...c, invoiced: next } : c));

    try {
      const res  = await fetch('/api/costs', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: cost.id, invoiced: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update');
      setCosts(prev => prev.map(c => c.id === cost.id ? data.cost : c));
      await load();
    } catch (err) {
      setCosts(prev => prev.map(c => c.id === cost.id ? { ...c, invoiced: cost.invoiced } : c));
      setError(err.message === 'Failed to fetch' ? 'Offline — change not saved' : err.message);
    } finally {
      setPending(null);
    }
  }

  const unbilledCount = costs.filter(c => !c.invoiced).length;

  // Bulk marking is hard to undo one row at a time, so it asks first
  async function markAllInvoiced() {
    if (!confirm(`Mark all ${unbilledCount} outstanding ${unbilledCount === 1 ? 'cost' : 'costs'} on this project as invoiced?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/costs', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ all: true, projectCode: code, invoiced: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update');
      await load();
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Offline — nothing was changed' : err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const isGeneral = code === GENERAL_PROJECT_CODE;

  return (
    <AppShell
      title={project?.address || code}
      subtitle={project ? project.code : undefined}
      onBack={() => router.push('/home')}
    >
      {projectsLoading && !project && (
        <p style={{ fontSize: font.size.sm, color: color.muted }}>Loading…</p>
      )}

      {!projectsLoading && !project && (
        <div style={{ ...card, padding: space.xl }}>
          <p style={{ margin: 0, fontSize: font.size.md, fontWeight: 500 }}>Project not found</p>
          <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.sm, color: color.muted }}>
            No project with code {code}.
          </p>
        </div>
      )}

      {project && (
        <>
          {isGeneral && (
            <div style={{
              background: color.accentLight, color: color.accent,
              padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
              fontSize: font.size.xs, marginBottom: space.lg,
            }}>
              General company costs. Excluded from cross-project totals.
            </div>
          )}

          {error && (
            <p style={{
              padding: `${space.sm}px ${space.md}px`, marginBottom: space.lg,
              background: color.accentLight, color: color.accent,
              borderRadius: radius.md, fontSize: font.size.sm,
            }}>{error}</p>
          )}

          {!loading && <TotalsCard totals={totals} />}

          <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
            <header style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: adding || costs.length ? space.md : 0,
            }}>
              <h2 style={{ margin: 0, fontSize: font.size.md, fontWeight: 600 }}>
                Costs{costs.length ? ` (${costs.length})` : ''}
              </h2>
              {!adding && (
                <button
                  onClick={() => { setEditingId(null); setAdding(true); }}
                  style={{ ...button.primary, padding: '9px 14px', fontSize: font.size.sm }}
                >+ Add</button>
              )}
            </header>

            {adding && (
              <div style={{
                border: `1px solid ${color.border}`, borderRadius: radius.md,
                padding: space.lg, marginBottom: space.lg, background: color.bg,
              }}>
                <CostForm
                  project={project}
                  userName={userName}
                  onCancel={() => setAdding(false)}
                  onSaved={() => { setAdding(false); load(); }}
                />
              </div>
            )}

            {loading && (
              <p style={{ fontSize: font.size.sm, color: color.muted, margin: 0 }}>Loading…</p>
            )}

            {!loading && costs.length === 0 && !adding && (
              <p style={{ fontSize: font.size.sm, color: color.muted, margin: `${space.md}px 0 0` }}>
                No costs recorded yet.
              </p>
            )}

            {costs.map((cost, i) => editingId === cost.id ? (
              <div key={cost.id} style={{
                border: `1px solid ${color.border}`, borderRadius: radius.md,
                padding: space.lg, margin: `${space.md}px 0`, background: color.bg,
              }}>
                <CostForm
                  project={project}
                  userName={userName}
                  cost={cost}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); load(); }}
                  onDeleted={() => { setEditingId(null); load(); }}
                />
              </div>
            ) : (
              <CostRow
                key={cost.id}
                cost={cost}
                first={i === 0}
                busy={pendingId === cost.id}
                onToggle={() => toggleInvoiced(cost)}
                onEdit={() => { setAdding(false); setEditingId(cost.id); }}
              />
            ))}

            {unbilledCount > 0 && (
              <button
                onClick={markAllInvoiced}
                disabled={bulkBusy}
                style={{
                  ...button.secondary,
                  width: '100%', marginTop: space.md,
                  fontSize: font.size.sm,
                  opacity: bulkBusy ? 0.5 : 1,
                }}
              >
                {bulkBusy
                  ? 'Marking…'
                  : `Mark ${unbilledCount} as invoiced`}
              </button>
            )}
          </section>

          {receipted.length > 0 && (
            <section style={{ ...card, padding: space.lg }}>
              <button
                onClick={() => setShowR(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', background: 'transparent', border: 'none',
                  padding: 0, cursor: 'pointer', fontFamily: font.stack, color: color.text,
                }}
              >
                <span style={{ fontSize: font.size.md, fontWeight: 600 }}>
                  Receipted ({receipted.length})
                </span>
                <span style={{ fontSize: font.size.sm, color: color.muted }}>
                  {formatAmount(totals?.receiptedTotal)} {showReceipted ? '▴' : '▾'}
                </span>
              </button>

              <p style={{
                margin: `${space.sm}px 0 0`, fontSize: font.size.xs, color: color.muted,
              }}>
                From the Expenses tab, submitted through the expense app. Read-only here —
                rejected claims are excluded.
              </p>

              {showReceipted && (
                <div style={{ marginTop: space.md }}>
                  {receipted.map((exp, i) => (
                    <LineRow
                      key={exp.id}
                      label={exp.description || exp.category || exp.id}
                      amount={formatAmount(exp.amount)}
                      meta={`${formatIsoDate(exp.date)}${exp.payeeName ? ` · ${exp.payeeName}` : ''}`}
                      tags={
                        <>
                          <Tag variant="receipted">Receipted</Tag>
                          {exp.category && <Tag variant="neutral">{exp.category}</Tag>}
                          {exp.status === 'pending' && <Tag variant="notInvoiced">Pending review</Tag>}
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

function CostRow({ cost, first, busy, onToggle, onEdit }) {
  // Description is what identifies the cost to a human; category is metadata, so it
  // sits in a tag alongside the type, mirroring how receipted rows read.
  const label = cost.description || cost.categoryName || cost.categoryCode;

  return (
    <LineRow
      first={first}
      dimmed={busy}
      onLabelClick={onEdit}
      label={label}
      amount={formatAmount(cost.amount)}
      meta={formatIsoDate(cost.date)}
      tags={
        <>
          <Tag variant={cost.costType}>{TYPE_LABEL[cost.costType] || cost.costType}</Tag>
          <Tag variant="neutral">{cost.categoryName || cost.categoryCode}</Tag>
        </>
      }
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, flexShrink: 0 }}>
          {/* Explicit button because tapping the label is undiscoverable with a mouse —
              there is no hover state on touch to hint at it, and none on desktop until
              you happen to point at it. */}
          <button
            onClick={onEdit}
            disabled={busy}
            className="ghost-button"
            aria-label={`Edit ${label}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              minHeight: 44, padding: `0 ${space.sm}px`,
              background: 'transparent', border: 'none', borderRadius: radius.sm,
              cursor: busy ? 'wait' : 'pointer',
              fontSize: font.size.xs, fontFamily: font.stack, color: color.muted,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span aria-hidden>✎</span> Edit
          </button>

          {/* Plain by design: this is a state you glance at, not a call to action. The
              tick carries the meaning; colour would compete with the type tags. */}
          <button
            onClick={onToggle}
            disabled={busy}
            role="switch"
            aria-checked={cost.invoiced}
            aria-label={`${label}, ${formatAmount(cost.amount)} — ${cost.invoiced ? 'invoiced' : 'not invoiced'}`}
            className="ghost-button"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              minHeight: 44, padding: `0 ${space.sm}px`,
              background: 'transparent', border: 'none', borderRadius: radius.sm,
              cursor: busy ? 'wait' : 'pointer',
              fontSize: font.size.xs, fontFamily: font.stack,
              color: cost.invoiced ? color.text : color.muted,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span aria-hidden style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              border: `1.5px solid ${cost.invoiced ? color.text : color.subtle}`,
              background: cost.invoiced ? color.text : 'transparent',
              color: color.surface, fontSize: 12, lineHeight: '16px', textAlign: 'center',
            }}>{cost.invoiced ? '✓' : ''}</span>
            {cost.invoiced ? 'Invoiced' : 'Not invoiced'}
          </button>
        </div>
      }
    />
  );
}
