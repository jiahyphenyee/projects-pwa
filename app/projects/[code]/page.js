'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import CostForm from '@/app/components/CostForm';
import TotalsCard, { formatAmount } from '@/app/components/TotalsCard';
import Tag from '@/app/components/Tag';
import { useProjects } from '@/lib/useProjects';
import { recordRecent } from '@/lib/recents';
import { getUser } from '@/lib/session';
import { GENERAL_PROJECT_CODE, COST_TYPES } from '@/lib/constants';
import { formatIsoDate } from '@/lib/dates';
import { button, card, color, font, radius, space, tag as tagPalette } from '@/lib/theme';

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
                  onClick={() => setAdding(true)}
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

            {costs.map((cost, i) => (
              <CostRow
                key={cost.id}
                cost={cost}
                first={i === 0}
                busy={pendingId === cost.id}
                onToggle={() => toggleInvoiced(cost)}
              />
            ))}
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

              {showReceipted && receipted.map((exp, i) => (
                <div key={exp.id} style={{
                  padding: `${space.md}px 0`,
                  borderTop: `1px solid ${color.border}`,
                  marginTop: i === 0 ? space.md : 0,
                }}>
                  <div style={{ display: 'flex', gap: space.md, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: font.size.sm, fontWeight: 500 }}>
                        {exp.description || exp.category || exp.id}
                      </div>
                      <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: 2 }}>
                        {formatIsoDate(exp.date)}{exp.payeeName ? ` · ${exp.payeeName}` : ''}
                      </div>
                    </div>
                    <div style={{
                      fontSize: font.size.md, fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                    }}>{formatAmount(exp.amount)}</div>
                  </div>

                  <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}>
                    <Tag variant="receipted">Receipted</Tag>
                    {exp.category && <Tag variant="neutral">{exp.category}</Tag>}
                    {exp.status === 'pending' && <Tag variant="notInvoiced">Pending review</Tag>}
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

function CostRow({ cost, first, busy, onToggle }) {
  return (
    <div style={{
      padding: `${space.md}px 0`,
      borderTop: first ? 'none' : `1px solid ${color.border}`,
      opacity: busy ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', gap: space.md, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: font.size.sm, fontWeight: 500 }}>
            {cost.categoryName || cost.categoryCode}
          </div>
          <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: 2 }}>
            {formatIsoDate(cost.date)}{cost.description ? ` · ${cost.description}` : ''}
          </div>
        </div>
        <div style={{
          fontSize: font.size.md, fontWeight: 500,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>{formatAmount(cost.amount)}</div>
      </div>

      {/* Type tag is decorative; the invoiced control is a real checkbox with a 44px
          tap target, kept visually separate so it reads as the interactive thing. */}
      <div style={{
        display: 'flex', gap: space.sm, marginTop: space.xs,
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Tag variant={cost.costType}>{TYPE_LABEL[cost.costType] || cost.costType}</Tag>

        <button
          onClick={onToggle}
          disabled={busy}
          role="switch"
          aria-checked={cost.invoiced}
          aria-label={`${cost.categoryName || cost.categoryCode}, ${formatAmount(cost.amount)} — ${cost.invoiced ? 'invoiced' : 'not invoiced'}`}
          style={{
            display: 'flex', alignItems: 'center', gap: space.sm,
            minHeight: 44, padding: `0 ${space.md}px`,
            borderRadius: radius.md, cursor: busy ? 'wait' : 'pointer',
            fontSize: font.size.sm, fontWeight: 600, fontFamily: font.stack,
            border: `1.5px solid ${cost.invoiced ? tagPalette.invoiced.border : color.border}`,
            background: cost.invoiced ? tagPalette.invoiced.bg : color.surface,
            color: cost.invoiced ? tagPalette.invoiced.fg : color.muted,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span aria-hidden style={{
            width: 20, height: 20, borderRadius: 5, flexShrink: 0,
            border: `2px solid ${cost.invoiced ? tagPalette.invoiced.fg : color.subtle}`,
            background: cost.invoiced ? tagPalette.invoiced.fg : 'transparent',
            color: '#fff', fontSize: 13, lineHeight: '17px', textAlign: 'center',
          }}>{cost.invoiced ? '✓' : ''}</span>
          {cost.invoiced ? 'Invoiced' : 'Not invoiced'}
        </button>
      </div>
    </div>
  );
}
