'use client';

// Quote and billing, Phase 3: the line editor, property type, units, discount and totals,
// saved to Sheets. The payment schedule (Phase 5) goes in the empty column beside the
// totals. Editing is local; Sheets is touched only on Save.

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import LineEditor, { qtyOf, priceOf } from '@/app/components/quote/LineEditor';
import TotalsPanel from '@/app/components/quote/TotalsPanel';
import { getUser } from '@/lib/session';
import { ADMIN_ROLES } from '@/lib/constants';
import { quoteTotals } from '@/lib/quoteMaths.mjs';
import { blankItem, fromServerLines, toSavePayload, snapshot } from '@/lib/quoteEditor.mjs';
import { button, card, color, font, radius, space } from '@/lib/theme';

const NO_DISCOUNT = { on: false, mode: '$', value: '' };

export default function QuotePage({ params }) {
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);
  const router = useRouter();

  const [user, setUser]         = useState(null);
  const [data, setData]         = useState(null);    // the screen payload from the server
  const [rows, setRows]         = useState([]);
  const [showUnit, setShowUnit] = useState(false);
  const [discount, setDiscount] = useState(NO_DISCOUNT);
  const [propertyType, setType] = useState('');
  const [saved, setSaved]       = useState('');      // snapshot of the last loaded/saved state
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');

  useEffect(() => { setUser(getUser()); }, []);
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);

  const defaultService = useMemo(() => {
    const cats = data?.categories || [];
    return cats.find(c => c.code === 'GENL' && c.active)?.code || cats.find(c => c.active)?.code || '';
  }, [data]);

  const current = useCallback(
    (r = rows, u = showUnit, d = discount, t = propertyType) =>
      snapshot(r, { u, d: d.on ? [d.mode, d.value] : null, t }),
    [rows, showUnit, discount, propertyType]
  );
  const dirty = !!data && current() !== saved;

  /** Put a server payload into the editor and mark it as the saved state. */
  const adopt = useCallback((payload) => {
    const q = payload.quote;
    const cats = payload.categories || [];
    const fallback = cats.find(c => c.code === 'GENL' && c.active)?.code || '';
    const nextRows = payload.lines?.length ? fromServerLines(payload.lines) : [blankItem(fallback)];
    const nextUnit = q ? q.showUnit : false;
    const nextDiscount = q?.discountMode
      ? { on: true, mode: q.discountMode, value: q.discountValue === null ? '' : String(q.discountValue) }
      : NO_DISCOUNT;
    const nextType = payload.project?.propertyType || '';
    setData(payload);
    setRows(nextRows);
    setShowUnit(nextUnit);
    setDiscount(nextDiscount);
    setType(nextType);
    setSaved(snapshot(nextRows, { u: nextUnit, d: nextDiscount.on ? [nextDiscount.mode, nextDiscount.value] : null, t: nextType }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // cache: 'no-store' so the service worker's cached copy is never mistaken for live
      const res = await fetch(`/api/quotes?screen=${encodeURIComponent(code)}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Could not load the quote');
      adopt(payload);
    } catch (err) {
      setError(err instanceof TypeError ? 'Offline — the quote cannot be loaded' : err.message);
    } finally {
      setLoading(false);
    }
  }, [code, adopt]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // Closing the tab or reloading with unsaved edits asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function leaveIfSafe(go) {
    if (dirty && !window.confirm('You have unsaved changes to this quote. Leave without saving?')) return;
    go();
  }

  const totals = useMemo(
    () => quoteTotals(
      rows.map(r => ({ kind: r.kind, qty: qtyOf(r), unitPrice: priceOf(r) })),
      discount.on ? discount.mode : '',
      discount.on ? discount.value : null
    ),
    [rows, discount]
  );

  async function save() {
    setError('');
    setNotice('');
    if (!propertyType) { setError('Choose the property type before saving.'); return; }
    const payload = toSavePayload(rows);
    if (payload.error) { setError(payload.error); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:            data.quote?.id,
          projectCode:   code,
          kind:          'quote',
          propertyType,
          lines:         payload.lines,
          showUnit,
          discountMode:  discount.on ? discount.mode : '',
          discountValue: discount.on && discount.value !== '' ? Number(discount.value) : null,
          user:          user?.name || '',
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not save the quote');
      adopt({ ...data, ...result, project: result.project || data.project });
      const items = result.lines.filter(l => l.kind === 'item').length;
      setNotice(
        `Saved ${result.quote.id}: ${items} line${items === 1 ? '' : 's'}, added to price history as ${propertyType} quotes.` +
        (payload.dropped ? ` ${payload.dropped} empty row${payload.dropped === 1 ? ' was' : 's were'} left out.` : '') +
        (result.warnings?.length ? ` Warning: ${result.warnings.join(' ')}` : '')
      );
    } catch (err) {
      setError(err instanceof TypeError ? 'Offline — the quote was not saved. Your edits are still here.' : err.message);
    } finally {
      setSaving(false);
    }
  }

  const project = data?.project;
  const title = 'Quote and billing';
  const subtitle = project ? `${project.address} · ${project.code}` : code;

  if (user && !isAdmin) {
    return (
      <AppShell title={title} subtitle={code} onBack={() => router.push(`/projects/${encodeURIComponent(code)}`)}>
        <div style={{ ...card, padding: space.xl, fontSize: font.size.sm }}>Quote and billing is for admin users only.</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      wide
      title={title}
      subtitle={subtitle}
      onBack={() => leaveIfSafe(() => router.push(`/projects/${encodeURIComponent(code)}`))}
      actions={
        <button
          type="button" onClick={() => leaveIfSafe(load)} disabled={loading || saving}
          aria-label="Refresh" title="Reload the quote from the sheet"
          style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', height: 32,
            padding: '0 12px', borderRadius: 8, fontSize: font.size.xs, cursor: 'pointer', fontFamily: font.stack,
          }}
        >{loading ? 'Loading…' : 'Refresh'}</button>
      }
    >
      {loading && !data && <p style={{ fontSize: font.size.sm, color: color.muted }}>Loading…</p>}

      {error && (
        <p role="alert" style={{
          padding: `${space.sm}px ${space.md}px`, marginBottom: space.lg, background: color.dangerLight,
          color: color.danger, borderRadius: radius.md, fontSize: font.size.sm,
        }}>{error}</p>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${space.md}px ${space.xxl}px`, alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.lg }}>
              <Fact label="Client" value={project.clientName || 'No client (direct job)'} />
              <Fact label="Quote" value={data.quote ? `${data.quote.id} · saved ${formatWhen(data.quote.updatedAt)}` : 'Not saved yet'} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
              <span style={{ fontSize: font.size.xs, color: color.muted }}>Property type</span>
              <div role="group" aria-label="Property type" style={{ display: 'flex', gap: space.sm }}>
                {data.propertyTypes.map(t => (
                  <button
                    key={t} type="button" aria-pressed={propertyType === t} disabled={saving}
                    onClick={() => setType(t)}
                    style={{
                      height: 40, padding: '0 16px', borderRadius: radius.sm, fontWeight: 600,
                      fontSize: font.size.sm, fontFamily: font.stack, cursor: 'pointer',
                      border: `1px solid ${propertyType === t ? color.primary : color.border}`,
                      background: propertyType === t ? color.primary : color.surface,
                      color: propertyType === t ? '#fff' : color.text,
                    }}
                  >{t}</button>
                ))}
              </div>
            </div>
          </div>

          {project.propertyType && propertyType !== project.propertyType && (
            <div style={{ padding: `${space.sm}px ${space.md}px`, background: color.accentLight, color: color.accent, borderRadius: radius.md, fontSize: font.size.xs }}>
              Saving will change this project&apos;s property type from {project.propertyType} to {propertyType}. Variation orders on this project use it too.
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.md, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: font.size.xs, color: color.muted }}>
              {propertyType
                ? `Prices are remembered as ${propertyType} quotes.`
                : 'Choose a property type: prices are remembered per type and never converted between them.'}
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, fontSize: font.size.sm, fontWeight: 600, cursor: 'pointer', minHeight: 40 }}>
              <input
                type="checkbox" checked={showUnit} disabled={saving}
                onChange={e => setShowUnit(e.target.checked)} style={{ width: 18, height: 18 }}
              />
              Show unit
            </label>
          </div>

          <LineEditor
            rows={rows} onChange={setRows} showUnit={showUnit}
            categories={data.categories} units={data.units}
            defaultService={defaultService} disabled={saving}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xl, alignItems: 'flex-start' }}>
            {/* Payment schedule card arrives here in Phase 5 */}
            <div style={{ flex: '1 1 520px', minWidth: 0 }} />

            <div style={{ flex: '0 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.md }}>
              <TotalsPanel totals={totals} discount={discount} onDiscount={setDiscount} disabled={saving} />
              <button
                type="button" onClick={save} disabled={saving || !dirty}
                style={{ ...button.primary, opacity: saving || !dirty ? 0.6 : 1, cursor: saving || !dirty ? 'default' : 'pointer' }}
              >{saving ? 'Saving…' : dirty ? 'Save quote' : 'Saved'}</button>
              {dirty && !saving && (
                <span style={{ fontSize: font.size.xs, color: color.accent, textAlign: 'center' }}>Unsaved changes</span>
              )}
              {notice && (
                <p role="status" style={{
                  padding: `${space.sm}px ${space.md}px`, background: color.successLight,
                  color: color.success, borderRadius: radius.md, fontSize: font.size.xs, margin: 0,
                }}>{notice}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: font.size.xs, color: color.muted }}>{label}</div>
      <div style={{ fontSize: font.size.md, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
