'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import CostForm from '@/app/components/CostForm';
import { useProjects } from '@/lib/useProjects';
import { recordRecent } from '@/lib/recents';
import { getUser } from '@/lib/session';
import { GENERAL_PROJECT_CODE, COST_TYPES } from '@/lib/constants';
import { formatIsoDate } from '@/lib/dates';
import { button, card, color, font, radius, space } from '@/lib/theme';

const TYPE_LABEL = Object.fromEntries(COST_TYPES.map(t => [t.value, t.label]));

function formatAmount(n) {
  return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ProjectDetailPage({ params }) {
  // Next 16: params is a Promise, unwrapped with use() in client components
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);

  const { projects, loading: projectsLoading } = useProjects();
  const [userName, setUserName] = useState('');
  const [costs, setCosts]       = useState([]);
  const [costsLoading, setCL]   = useState(true);
  const [costsError, setCE]     = useState('');
  const [adding, setAdding]     = useState(false);
  const router = useRouter();

  const project = useMemo(
    () => projects.find(p => p.code === code) || null,
    [projects, code]
  );

  useEffect(() => { setUserName(getUser()?.name || ''); }, []);

  useEffect(() => {
    if (userName && project) recordRecent(userName, project.code);
  }, [userName, project]);

  const loadCosts = useCallback(async () => {
    try {
      const res  = await fetch(`/api/costs?project=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load costs');
      setCosts(data.costs);
      setCE('');
    } catch (err) {
      setCE(err.message === 'Failed to fetch' ? 'Offline — costs unavailable' : err.message);
    } finally {
      setCL(false);
    }
  }, [code]);

  useEffect(() => { loadCosts(); }, [loadCosts]);

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
          <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
            {isGeneral && (
              <div style={{
                background: color.accentLight, color: color.accent,
                padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
                fontSize: font.size.xs, marginBottom: space.md,
              }}>
                General company costs. Excluded from cross-project totals.
              </div>
            )}
            <Detail label="Client"  value={project.clientName || 'Direct company job'} />
            <Detail label="Status"  value={project.status || '—'} />
            <Detail label="Started" value={project.startDate || '—'} />
          </section>

          <section style={{ ...card, padding: space.lg }}>
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
                  style={{
                    ...button.primary,
                    padding: '9px 14px', fontSize: font.size.sm,
                  }}
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
                  onSaved={cost => {
                    setCosts(prev => [cost, ...prev]);
                    setAdding(false);
                  }}
                />
              </div>
            )}

            {costsError && (
              <p style={{ fontSize: font.size.sm, color: color.accent, margin: `${space.sm}px 0` }}>
                {costsError}
              </p>
            )}

            {costsLoading && (
              <p style={{ fontSize: font.size.sm, color: color.muted, margin: 0 }}>Loading costs…</p>
            )}

            {!costsLoading && costs.length === 0 && !adding && (
              <p style={{ fontSize: font.size.sm, color: color.muted, margin: `${space.md}px 0 0` }}>
                No costs recorded yet.
              </p>
            )}

            {costs.map((cost, i) => (
              <CostRow key={cost.id} cost={cost} first={i === 0} />
            ))}
          </section>
        </>
      )}
    </AppShell>
  );
}

function CostRow({ cost, first }) {
  return (
    <div style={{
      display: 'flex', gap: space.md, alignItems: 'flex-start',
      padding: `${space.md}px 0`,
      borderTop: first ? 'none' : `1px solid ${color.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
          <span style={{ fontSize: font.size.sm, fontWeight: 500 }}>
            {cost.categoryName || cost.categoryCode}
          </span>
          <span style={{
            fontSize: 11, color: color.muted, background: color.bg,
            padding: '1px 7px', borderRadius: radius.pill,
          }}>{TYPE_LABEL[cost.costType] || cost.costType}</span>
        </div>
        <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: 3 }}>
          {formatIsoDate(cost.date)}{cost.description ? ` · ${cost.description}` : ''}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: font.size.md, fontVariantNumeric: 'tabular-nums' }}>
          {formatAmount(cost.amount)}
        </div>
        <div style={{
          fontSize: 11, marginTop: 3,
          color: cost.invoiced ? color.success : color.accent,
        }}>
          {cost.invoiced ? 'Invoiced' : 'Not invoiced'}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: space.md, padding: `${space.sm}px 0` }}>
      <span style={{ fontSize: font.size.sm, color: color.muted, width: 90, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: font.size.sm, flex: 1, minWidth: 0 }}>{value}</span>
    </div>
  );
}
