'use client';

// A project's costs, for both of its views: the Costs screen that edits them and the
// Summary that reports on them. One hook, so the two views read the same cache, recover
// from the same failures, and can never total the same project two different ways.
//
// Moved out of the project page unchanged in behaviour: load with a cache fallback that
// says how old it is, an optimistic invoiced tick, and the bulk mark.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readCache, writeCache, costsCacheKey } from '@/lib/localCache';
import { summariseProject, mergeLines } from '@/lib/rollups';

/**
 * True only for a request that never reached the server. `fetch` rejects with a
 * TypeError when the network is the problem; anything the route hands back — including
 * a 500 — arrives as a plain Error and must not be reported as being offline.
 */
export function isOffline(err) {
  return err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

export function useProjectCosts(code) {
  const [costs, setCosts]         = useState([]);
  const [receipted, setReceipted] = useState([]);
  const [totals, setTotals]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [stale, setStale]         = useState(null);   // { at, offline }
  const [pendingId, setPending]   = useState(null);
  const [bulkBusy, setBulkBusy]   = useState(false);

  // Both cost sources as one list. They are separate tabs with separate rules, but one
  // thing to the person reading the screen — money spent on this job.
  const lines = useMemo(() => mergeLines(costs, receipted), [costs, receipted]);

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

  const unbilled          = lines.filter(l => !l.invoiced);
  const unbilledCount     = unbilled.length;
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

  return {
    costs, receipted, totals, lines, loading, error, stale, pendingId, bulkBusy, unbilledCount,
    load, toggleInvoiced, markAllInvoiced,
  };
}
