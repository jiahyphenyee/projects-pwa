'use client';

// The Summary view's reads beyond the costs: quote figures, the project's Xero invoices
// and the thresholds (/api/dashboard), and the quote's billing schedule
// (/api/quotes?summary). Separate from the costs so Xero being slow or down never holds
// them up. The last good dashboard copy shows at once, labelled with its age, until the
// fresh one lands.

import { useEffect, useMemo, useState } from 'react';
import { readCache, writeCache, dashboardCacheKey, describeAge } from '@/lib/localCache';
import { todaySingapore } from '@/lib/dates';
import { readSettings, summariseInvoices } from '@/lib/projectFigures.mjs';
import { isOffline } from '@/lib/useProjectCosts';

export function useProjectDashboard(code, enabled) {
  const [dash, setDash]       = useState(null);   // { data, staleAt } | { error }
  const [billing, setBilling] = useState(null);   // billingSummary() | { error }

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const key = dashboardCacheKey(code);
    const cached = readCache(key);
    if (cached) setDash({ data: cached.data, staleAt: describeAge(cached.cachedAt) });

    fetch(`/api/dashboard?project=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load the quote and Xero figures');
        return d;
      })
      .then(d => {
        if (!live) return;
        // A part that failed is not cached over a good copy of it
        if (!d.quote?.error && !d.invoices?.error) writeCache(key, d);
        setDash({ data: d, staleAt: null });
      })
      .catch(err => {
        if (!live) return;
        setDash(prev => prev?.data ? prev : { error: isOffline(err) ? 'Offline' : err.message });
      });

    fetch(`/api/quotes?summary=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load billing'); return d; })
      .then(d => { if (live) setBilling(d); })
      .catch(err => { if (live) setBilling({ error: isOffline(err) ? 'Offline' : err.message }); });

    return () => { live = false; };
  }, [code, enabled]);

  const data     = dash?.data || null;
  const settings = useMemo(() => data?.settings || readSettings(), [data]);
  const quote    = data?.quote && !data.quote.error ? data.quote : null;
  const invoices = useMemo(
    () => data?.invoices || (dash?.error ? { error: dash.error } : null),
    [data, dash]
  );
  const invoiceSummary = useMemo(
    () => (invoices && !invoices.error ? summariseInvoices(invoices.docs, todaySingapore(), settings) : null),
    [invoices, settings]
  );

  return {
    loaded:     !!(data || dash?.error),
    staleAt:    dash?.staleAt || null,
    quoteError: data?.quote?.error || null,
    settings, quote, invoices, invoiceSummary, billing,
  };
}
