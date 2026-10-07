'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import CostForm from '@/app/components/CostForm';
import TotalsCard, { formatAmount, formatRowAmount } from '@/app/components/TotalsCard';
import Tag from '@/app/components/Tag';
import LineRow from '@/app/components/LineRow';
import FilterChip, { FilterGroup } from '@/app/components/FilterChip';
import LockCodeInput from '@/app/components/LockCodeInput';
import QuoteBillingCard from '@/app/components/quote/QuoteBillingCard';
import { useProjects } from '@/lib/useProjects';
import { recordRecent } from '@/lib/recents';
import { getUser } from '@/lib/session';
import { GENERAL_PROJECT_CODE, ADMIN_ROLES } from '@/lib/constants';
import { formatIsoDate } from '@/lib/dates';
import { readCache, writeCache, costsCacheKey, describeAge } from '@/lib/localCache';
import { summariseProject, mergeLines } from '@/lib/rollups';
import { button, card, color, font, radius, space } from '@/lib/theme';

/**
 * True only for a request that never reached the server. `fetch` rejects with a
 * TypeError when the network is the problem; anything the route hands back — including
 * a 500 — arrives as a plain Error and must not be reported as being offline.
 */
function isOffline(err) {
  return err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

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
// Identical on every row, so every amount's right edge lands in the same place. Wider than
// the 44px tap target inside it only so the word "Invoiced" fits in the column header —
// without that header the tick box has nothing to say what it means.
const ACTION_WIDTH = 58;

const STATUS_FILTERS = [
  { value: 'all',      label: 'All'           },
  { value: 'invoiced', label: 'Invoiced'      },
  { value: 'not',      label: 'Not invoiced'  },
];

export default function ProjectDetailPage({ params }) {
  // Next 16: params is a Promise, unwrapped with use() in client components
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);

  const { projects, loading: projectsLoading, refresh: refreshProjects } = useProjects();
  const [userName, setUserName]   = useState('');
  const [costs, setCosts]         = useState([]);
  const [receipted, setReceipted] = useState([]);
  const [totals, setTotals]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [adding, setAdding]       = useState(false);
  const [pendingId, setPending]   = useState(null);
  const [bulkBusy, setBulkBusy]   = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected]   = useState([]);     // category codes being filtered to
  const [status, setStatus]       = useState('all');  // all | invoiced | not
  const [stale, setStale]         = useState(null);   // { at, offline }
  const router = useRouter();

  const project = useMemo(
    () => projects.find(p => p.code === code) || null,
    [projects, code]
  );

  // Both cost sources as one list. They are separate tabs with separate rules, but one
  // thing to the person reading the screen — money spent on this job.
  const lines = useMemo(() => mergeLines(costs, receipted), [costs, receipted]);

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

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    const u = getUser();
    setUserName(u?.name || '');
    setIsAdmin(!!u && ADMIN_ROLES.includes(u.role));
  }, []);

  useEffect(() => {
    if (userName && project) recordRecent(userName, project.code);
  }, [userName, project]);

  const apply = useCallback(data => {
    setCosts(data.costs);
    setReceipted(data.receipted);
    setTotals(data.totals);
  }, []);

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/costs?project=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load costs');
      apply(data);
      writeCache(costsCacheKey(code), data);
      setStale(null);
      setError('');
    } catch (err) {
      // Fall back to the last copy rather than an empty screen, but say plainly that
      // it is old — silently showing stale money figures would be worse than an error
      const offline = isOffline(err);
      const cached  = readCache(costsCacheKey(code));
      if (cached) {
        apply(cached.data);
        setStale({ at: cached.cachedAt, offline });
        // A server fault is not a network fault. Showing the cache is still right, but
        // "you are offline" would send someone to check their signal over a broken read.
        setError(offline ? '' : err.message);
      } else {
        setError(offline ? 'Offline, and nothing saved for this project yet' : err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [code, apply]);

  useEffect(() => { load(); }, [load]);

  /**
   * Optimistic toggle: the row flips immediately, and reverts if the write fails.
   *
   * The line's own `receipted` flag says which list holds it — a project cost keeps its
   * invoiced state in `Project costs`, a receipted expense in the invoicing tab — but
   * both come back through the same endpoint in the same shape, so only the local list
   * being patched differs.
   */
  async function toggleInvoiced(line) {
    const next   = !line.invoiced;
    const setter = line.receipted ? setReceipted : setCosts;
    setPending(line.id);
    setter(prev => prev.map(r => r.id === line.id ? { ...r, invoiced: next } : r));

    try {
      const res  = await fetch('/api/costs', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: line.id, invoiced: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update');

      // Recompute rather than refetch: the state that came back is authoritative and
      // summariseProject is the same function the route totals with, so the figures
      // cannot drift — and one tap stays one request.
      const saved = data.line;
      const patch = rows => rows.map(r => r.id === line.id
        ? { ...r, invoiced: saved.invoiced, invoicedDate: saved.invoicedDate }
        : r);

      const nextCosts     = line.receipted ? costs     : patch(costs);
      const nextReceipted = line.receipted ? patch(receipted) : receipted;
      const nextTotals    = summariseProject(nextCosts, nextReceipted);

      setCosts(nextCosts);
      setReceipted(nextReceipted);
      setTotals(nextTotals);
      writeCache(costsCacheKey(code), { costs: nextCosts, receipted: nextReceipted, totals: nextTotals });
    } catch (err) {
      setter(prev => prev.map(r => r.id === line.id ? { ...r, invoiced: line.invoiced } : r));
      setError(isOffline(err) ? 'Offline — change not saved' : err.message);
    } finally {
      setPending(null);
    }
  }

  const unbilled       = lines.filter(l => !l.invoiced);
  const unbilledCount  = unbilled.length;
  const unbilledReceipted = unbilled.filter(l => l.receipted).length;

  // Bulk marking is hard to undo one row at a time, so it asks first. Receipted expenses
  // are called out by name: they are the ones someone might not expect to be included,
  // since every other action on them is blocked.
  async function markAllInvoiced() {
    const receiptedNote = unbilledReceipted
      ? ` This includes ${unbilledReceipted} from the expense app.`
      : '';
    if (!confirm(
      `Mark all ${unbilledCount} outstanding ${unbilledCount === 1 ? 'cost' : 'costs'} ` +
      `on this project as invoiced?${receiptedNote}`
    )) return;
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
      setError(isOffline(err) ? 'Offline — nothing was changed' : err.message);
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

          {!isGeneral && isAdmin && (
            <QuoteBillingCard
              projectCode={project.code}
              onOpen={() => router.push(`/projects/${encodeURIComponent(project.code)}/quote`)}
            />
          )}

          {!isGeneral && (
            <LockCodeCard project={project} onSaved={refreshProjects} />
          )}

          {!loading && <TotalsCard totals={totals} />}

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

            {/* Filtering is a viewing operation — it never changes the totals card above,
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
                onToggle={() => toggleInvoiced(line)}
                onEdit={line.editable
                  ? () => { setAdding(false); setEditingId(line.id); }
                  : undefined}
              />
            ))}

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

/**
 * One cost line, of either kind.
 *
 * Deliberately one component rather than two: the lists are merged, so any difference in
 * how they render reads as a difference in what they mean. Only three things actually
 * differ — the word "Receipted", the payee, and whether the label opens the editor.
 *
 * Exactly one tag, the category code. Everything else that merely describes the row —
 * where it came from, when, who was paid — is quiet grey text next to the date, because a
 * pill is a claim on the eye and only the trade earns one. The code, not the name, so a
 * trade reads identically whichever tab the row came from: `Project costs` joins a display
 * name from `Categories` and the Expenses tab has only the code, and "Electrical" sitting
 * above "ELEC" looks like two different things.
 *
 * The cost type (material / labour / transport) is recorded on every non-receipted cost
 * and is still written to the sheet, but is not shown here.
 */
function CostRow({ line, first, busy, onToggle, onEdit }) {
  // Description is what identifies the cost to a human. Falling back to the category, use
  // the readable name rather than the code — a bare "ELEC" as a whole row label is worse
  // than "Electrical", even though the tag itself is the code.
  const label = line.description || line.categoryName || line.id;

  // Reads as one quiet clause: what it is, when, and who was paid.
  const meta = [
    line.receipted ? 'Receipted' : null,
    formatIsoDate(line.date),
    line.payeeName || null,
  ].filter(Boolean).join(' · ');

  return (
    <LineRow
      first={first}
      dimmed={busy}
      onLabelClick={onEdit}
      label={label}
      amount={formatRowAmount(line.amount)}
      meta={meta}
      tags={
        <>
          {line.categoryCode && <Tag variant="neutral">{line.categoryCode}</Tag>}
          {line.status === 'pending' && <Tag variant="notInvoiced">Pending review</Tag>}
        </>
      }
      action={
        // The box alone, with no word beside it. The words were a second block of text on
        // the row competing with the label for the eye, and 118px wide — on a phone that
        // is a third of the row spent restating what a tick already says. The state is
        // still named, in the accessible name and by the Show filter above the list.
        //
        // The button is a full 44px tap target with a 26px box drawn inside it, so the
        // target never shrinks below what a thumb needs. Fixed width, like every other
        // row's, which is what keeps the amounts aligned down the page.
        <button
          onClick={onToggle}
          disabled={busy}
          role="switch"
          aria-checked={line.invoiced}
          aria-label={`${label}, ${formatRowAmount(line.amount)} — ${line.invoiced ? 'invoiced' : 'not invoiced'}`}
          className="ghost-button"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: ACTION_WIDTH, height: 44, flexShrink: 0,
            background: 'transparent', border: 'none', borderRadius: radius.md,
            cursor: busy ? 'wait' : 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span aria-hidden style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            border: `1.5px solid ${line.invoiced ? color.primary : color.subtle}`,
            background: line.invoiced ? color.primary : 'transparent',
            color: '#fff', fontSize: 15, lineHeight: 1, fontWeight: 700,
          }}>{line.invoiced ? '✓' : ''}</span>
        </button>
      }
    />
  );
}

/**
 * The site's door or gate code — the one thing on a project row worth editing from a
 * phone, and usually needed while standing at the door. Shown plainly rather than
 * masked: anyone who can open the project already has the job.
 */
function LockCodeCard({ project, onSaved }) {
  const saved = project.lockCode || '';
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(saved);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // The project list revalidates in the background, so the field follows what the
  // sheet says — except while it is being typed in.
  useEffect(() => { if (!editing) setValue(saved); }, [saved, editing]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res  = await fetch('/api/projects', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: project.code, lockCode: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the lock code');
      setValue(data.lockCode);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Offline — the lock code was not saved' : err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
      {editing ? (
        <>
          <LockCodeInput value={value} onChange={setValue} autoFocus />
          <div style={{ display: 'flex', gap: space.md, marginTop: space.md }}>
            <button
              onClick={() => { setEditing(false); setValue(saved); setError(''); }}
              disabled={saving}
              style={{ ...button.secondary, flex: 1, fontSize: font.size.sm, padding: '11px 14px' }}
            >Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              style={{ ...button.primary, flex: 1, fontSize: font.size.sm, padding: '11px 14px', opacity: saving ? 0.5 : 1 }}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
          <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.xs, color: color.muted }}>
            Leave it empty to clear the code.
          </p>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: font.size.xs, color: color.muted }}>Lock code</div>
            <div style={{
              fontSize: saved ? font.size.md : font.size.sm,
              fontWeight: saved ? 600 : 400,
              color: saved ? color.text : color.muted,
              marginTop: 2,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',     // a sentence may carry its own line breaks
              overflowWrap: 'anywhere',   // …and an unbroken code must not widen the card
            }}>{saved || 'Not set'}</div>
          </div>
          <button
            onClick={() => { setEditing(true); setError(''); }}
            style={{ ...button.secondary, flexShrink: 0, fontSize: font.size.sm, padding: '9px 14px' }}
          >{saved ? 'Edit' : 'Add'}</button>
        </div>
      )}

      {error && (
        <p style={{
          margin: `${space.md}px 0 0`, padding: `${space.sm}px ${space.md}px`,
          background: color.dangerLight, color: color.danger,
          borderRadius: radius.md, fontSize: font.size.sm,
        }}>{error}</p>
      )}
    </section>
  );
}
