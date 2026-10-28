'use client';

// A project's Costs view — the workflow screen. Phone-first and one column: the lock
// code people on site open it for, then every cost with add, edit, and the invoiced tick.
// Everyone who can sign in uses it; those without the Summary, and GEN-000, land here
// from /projects/<code>.
//
// The figures about the job (profit, budget, invoices) are on the Summary view, which
// admins switch to from here; the office role switches to Billing instead. This screen
// only says what the job has cost.

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import CostForm from '@/app/components/CostForm';
import { formatAmount } from '@/app/components/TotalsCard';
import FilterChip, { FilterGroup } from '@/app/components/FilterChip';
import CostRow, { ACTION_WIDTH } from '@/app/components/project/CostRow';
import CostDetail from '@/app/components/project/CostDetail';
import LockCodeCard from '@/app/components/project/LockCodeCard';
import ViewSwitch from '@/app/components/project/ViewSwitch';
import { useProjects } from '@/lib/useProjects';
import { useProjectCosts } from '@/lib/useProjectCosts';
import { useViewer } from '@/lib/useViewer';
import { recordRecent } from '@/lib/recents';
import { GENERAL_PROJECT_CODE } from '@/lib/constants';
import { describeAge } from '@/lib/localCache';
import { possibleDuplicates } from '@/lib/projectFigures.mjs';
import { button, card, color, font, radius, space } from '@/lib/theme';

/**
 * The filter bucket for rows with no category.
 *
 * Roughly a third of the imported costs have a blank `category_code`, so without a bucket
 * of their own a filter would make them unreachable. Lowercase and parenthesised so it can
 * never collide with a real code, which the workbook validates as 3–6 capitals.
 */
const UNCATEGORISED = '(none)';

// "All" is first and is the default: the list's job is to show everything until asked
// otherwise, and a screen that opens already filtered hides money without saying so.
const STATUS_FILTERS = [
  { value: 'all',      label: 'All'           },
  { value: 'invoiced', label: 'Invoiced'      },
  { value: 'not',      label: 'Not invoiced'  },
];

export default function ProjectCostsPage({ params }) {
  // Next 16: params is a Promise, unwrapped with use() in client components
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);
  const router = useRouter();

  const { projects, loading: projectsLoading, refresh: refreshProjects } = useProjects();
  const { userName } = useViewer();
  const {
    costs, receipted, totals, lines, loading, error, stale, pendingId, bulkBusy, unbilledCount,
    load, toggleInvoiced, markAllInvoiced, setBilling,
  } = useProjectCosts(code);

  const [adding, setAdding]       = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId]       = useState(null);     // the cost shown in the detail sheet
  const [selected, setSelected]   = useState([]);     // category codes being filtered to
  const [status, setStatus]       = useState('all');  // all | invoiced | not

  const project = useMemo(
    () => projects.find(p => p.code === code) || null,
    [projects, code]
  );
  const isGeneral = code === GENERAL_PROJECT_CODE;

  useEffect(() => {
    if (userName && project) recordRecent(userName, project.code);
  }, [userName, project]);

  const duplicates = useMemo(() => possibleDuplicates(lines), [lines]);

  // Only the categories this project actually uses, so the filter never offers a chip
  // that would empty the list. Real codes alphabetically, the uncategorised bucket last —
  // it is a gap in the data, not a trade, and should not head the row.
  const categories = useMemo(() => {
    const present = new Set(lines.map(l => l.categoryCode || UNCATEGORISED));
    return [...present].sort((a, b) =>
      a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b)
    );
  }, [lines]);

  // A category can disappear while it is selected — the last cost using it gets edited or
  // deleted. Dropping the stale selection keeps the list from filtering to nothing with no
  // visible chip to switch off.
  useEffect(() => {
    setSelected(prev => {
      const next = prev.filter(c => categories.includes(c));
      return next.length === prev.length ? prev : next;
    });
  }, [categories]);

  // The two filters intersect: a category AND a billing state, never a union of the two.
  const visible = useMemo(() => lines.filter(l => {
    if (status === 'invoiced' && !l.invoiced) return false;
    if (status === 'not'      &&  l.invoiced) return false;
    if (selected.length && !selected.includes(l.categoryCode || UNCATEGORISED)) return false;
    return true;
  }), [lines, selected, status]);

  const filtering = status !== 'all' || selected.length > 0;

  const filtered = useMemo(() => ({
    total:    visible.reduce((sum, l) => sum + (l.amount || 0), 0),
    invoiced: visible.filter(l => l.invoiced).reduce((sum, l) => sum + (l.amount || 0), 0),
  }), [visible]);

  function clearFilters() {
    setStatus('all');
    setSelected([]);
  }

  const count = totals ? totals.ownCount + totals.receiptedCount : 0;

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
          {!isGeneral && <ViewSwitch code={project.code} current="costs" style={{ marginBottom: space.lg }} />}

          {isGeneral && (
            <div style={{
              background: color.accentLight, color: color.accent,
              padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
              fontSize: font.size.xs, marginBottom: space.lg,
            }}>
              General company costs. Excluded from cross-project totals.
            </div>
          )}

          {project.status && project.status !== 'active' && (
            <div style={{
              background: color.accentLight, color: color.accent,
              padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
              fontSize: font.size.xs, marginBottom: space.lg,
            }}>
              This project is {project.status}. Costs can still be added — a late invoice
              on a finished job is normal — but check it belongs here first.
            </div>
          )}

          {error && (
            <p style={{
              padding: `${space.sm}px ${space.md}px`, marginBottom: space.lg,
              background: color.dangerLight, color: color.danger,
              borderRadius: radius.md, fontSize: font.size.sm,
            }}>{error}</p>
          )}

          {stale && (
            <div style={{
              padding: `${space.sm}px ${space.md}px`, marginBottom: space.lg,
              background: color.accentLight, color: color.accent,
              borderRadius: radius.md, fontSize: font.size.xs,
            }}>
              {stale.offline ? 'Offline — showing' : 'Showing'} data saved {describeAge(stale.at)}.
              {stale.offline
                ? ' Changes cannot be saved until you reconnect.'
                : ' The figures above may have moved on.'}
            </div>
          )}

          {/* The lock code stays first: it is what people on site open this screen for. */}
          {!isGeneral && (
            <LockCodeCard project={project} onSaved={refreshProjects} />
          )}

          {/* What the job has cost — the whole project, whatever the filters below show */}
          {!loading && totals && (
            <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }}>
                <span style={{ fontSize: font.size.md, fontWeight: 600, color: color.text }}>
                  Cost to date
                  <span style={{ color: color.subtle, fontSize: font.size.xs, fontWeight: 400 }}>
                    {' · '}{count} {count === 1 ? 'expense' : 'expenses'}
                  </span>
                </span>
                <span style={{
                  fontSize: font.size.xl, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                }}>{formatAmount(totals.grandTotal)}</span>
              </div>
              {/* How it was billed. In cents, so the three always add up to the total */}
              {lines.length > 0 && (() => {
                const c = list => list.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0) / 100;
                const direct = c(lines.filter(l => l.invoiced && l.invoiceRef));
                const inProject = c(lines.filter(l => l.invoiced && !l.invoiceRef));
                const notBilled = c(lines.filter(l => !l.invoiced));
                return (
                  <div style={{ marginTop: space.xs, fontSize: font.size.xs, color: color.muted, lineHeight: 1.6 }}>
                    Billed in project {formatAmount(inProject)} · billed direct {formatAmount(direct)} · not billed {formatAmount(notBilled)}
                  </div>
                );
              })()}
            </section>
          )}

          <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
            <header style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: space.sm,
            }}>
              <h2 style={{ margin: 0, fontSize: font.size.md, fontWeight: 600 }}>
                Costs{lines.length ? ` (${lines.length})` : ''}
              </h2>
              {!adding && (
                <button
                  onClick={() => { setEditingId(null); setAdding(true); }}
                  style={{ ...button.primary, padding: '9px 14px', fontSize: font.size.sm }}
                >+ Add</button>
              )}
            </header>

            {/* The two sources used to be two sections, which made the read-only-ness of
                receipted rows obvious from the layout. Merged, it has to be said. */}
            {receipted.length > 0 && (
              <p style={{
                margin: `0 0 ${space.md}px`, fontSize: font.size.xs,
                color: color.muted, lineHeight: 1.5,
              }}>
                Rows marked <strong style={{ fontWeight: 600 }}>Receipted</strong> come from the
                expense app and are already in Xero — they can be marked invoiced here, but not
                edited. Rejected claims are excluded.
              </p>
            )}

            {/* Filtering is a viewing operation — it never changes the cost card above,
                which always describes the whole project. The figure for what is on screen
                lives down here, beside the controls that produced it. */}
            {lines.length > 1 && (
              <div style={{ marginBottom: space.md }}>
                <FilterGroup label="Show">
                  {STATUS_FILTERS.map(f => (
                    <FilterChip
                      key={f.value}
                      selected={status === f.value}
                      onClick={() => setStatus(f.value)}
                      ariaLabel={`Show ${f.label.toLowerCase()}`}
                    >{f.label}</FilterChip>
                  ))}
                </FilterGroup>

                {/* Only categories this project actually uses, so a chip can never empty
                    the list on its own. */}
                {categories.length > 1 && (
                  <FilterGroup label="Category">
                    {categories.map(c => {
                      const on   = selected.includes(c);
                      const name = c === UNCATEGORISED ? 'Uncategorised' : c;
                      return (
                        <FilterChip
                          key={c}
                          selected={on}
                          ariaLabel={`${name} — ${on ? 'filtering to this' : 'tap to filter'}`}
                          onClick={() => setSelected(prev =>
                            on ? prev.filter(x => x !== c) : [...prev, c]
                          )}
                        >{name}</FilterChip>
                      );
                    })}
                  </FilterGroup>
                )}

                {filtering && (
                  <div
                    aria-live="polite"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: space.md, marginTop: space.md,
                      padding: `${space.sm}px ${space.md}px`,
                      background: color.bg, borderRadius: radius.md,
                    }}
                  >
                    <span style={{ fontSize: font.size.xs, color: color.muted, minWidth: 0 }}>
                      {visible.length} of {lines.length}
                      {/* Only meaningful while both states are on screen; under an
                          Invoiced or Not-invoiced filter it would just restate the filter. */}
                      {status === 'all' && filtered.invoiced > 0 && (
                        <> · {formatAmount(filtered.invoiced)} invoiced</>
                      )}
                      {' · '}
                      <button
                        onClick={clearFilters}
                        className="ghost-button"
                        style={{
                          padding: `2px ${space.xs}px`, margin: `0 -${space.xs}px`,
                          background: 'transparent', border: 'none', borderRadius: radius.sm,
                          cursor: 'pointer', fontFamily: font.stack,
                          fontSize: font.size.xs, fontWeight: 600, color: color.muted,
                          textDecoration: 'underline', textUnderlineOffset: 2,
                          WebkitTapHighlightColor: 'transparent',
                        }}
                      >Clear</button>
                    </span>
                    <span style={{
                      fontSize: font.size.md, fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                    }}>{formatAmount(filtered.total)}</span>
                  </div>
                )}
              </div>
            )}

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

            {!loading && lines.length === 0 && !adding && (
              <p style={{ fontSize: font.size.sm, color: color.muted, margin: `${space.md}px 0 0` }}>
                No costs recorded yet.
              </p>
            )}

            {!loading && lines.length > 0 && visible.length === 0 && (
              <p style={{ fontSize: font.size.sm, color: color.muted, margin: `${space.md}px 0 0` }}>
                Nothing matches these filters.
              </p>
            )}

            {/* Column headers. The tick box is otherwise unlabelled — it lost its words to
                give the row's own label room — so this is what says what it does. Same flex
                shape as a row, so the headings land over the columns they name. */}
            {!loading && visible.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: space.sm,
                paddingBottom: space.sm, borderBottom: `1px solid ${color.border}`,
                fontSize: 11, fontWeight: 600, color: color.subtle,
                letterSpacing: 0.3,
              }}>
                <span style={{ flex: 1, minWidth: 0 }} />
                <span style={{ flexShrink: 0 }}>Amount</span>
                <span style={{ width: ACTION_WIDTH, flexShrink: 0, textAlign: 'center' }}>
                  Invoiced
                </span>
              </div>
            )}

            {visible.map((line, i) => editingId === line.id ? (
              <div key={line.id} style={{
                border: `1px solid ${color.border}`, borderRadius: radius.md,
                padding: space.lg, margin: `${space.md}px 0`, background: color.bg,
              }}>
                <CostForm
                  project={project}
                  userName={userName}
                  cost={costs.find(c => c.id === line.id)}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); load(); }}
                  onDeleted={() => { setEditingId(null); load(); }}
                />
              </div>
            ) : (
              <CostRow
                key={line.id}
                line={line}
                first={i === 0}
                busy={pendingId === line.id}
                duplicateOf={duplicates[line.id]}
                onToggle={() => toggleInvoiced(line)}
                onOpen={() => setOpenId(line.id)}
              />
            ))}

            {openId && lines.find(l => l.id === openId) && (() => {
              const line = lines.find(l => l.id === openId);
              return (
                <CostDetail
                  line={line}
                  projectCode={code}
                  busy={pendingId === line.id}
                  onClose={() => setOpenId(null)}
                  onBilling={(invoiced, ref) => setBilling(line, invoiced, ref)}
                  onEdit={line.editable ? () => { setOpenId(null); setAdding(false); setEditingId(line.id); } : undefined}
                />
              );
            })()}

            {/* Bulk marking always covers the whole project, so it is withheld while a
                filter is on. A button reading "Mark 27" under a list showing 6 is how
                someone bills a client for the wrong thing. */}
            {unbilledCount > 0 && !filtering && (
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

            {unbilledCount > 0 && filtering && (
              <p style={{
                margin: `${space.md}px 0 0`, fontSize: font.size.xs,
                color: color.muted, textAlign: 'center',
              }}>
                Clear the filters to mark everything on this project invoiced.
              </p>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
