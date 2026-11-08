'use client';

// The quote screen and the variation order screen: one component, so a VO is edited with
// exactly the same editor as the quote (the plan's "reuse the editor; do not copy it").
//
//   <QuoteScreen code="PRJ-042" />                 the project's quote and its payment schedule
//   <QuoteScreen code="PRJ-042" voId="Q-0007" />   a saved variation order
//   <QuoteScreen code="PRJ-042" voId="new" />      a blank variation order, numbered on first save
//
// Editing is local; Sheets is touched only on Save.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import LineEditor, { qtyOf, priceOf } from '@/app/components/quote/LineEditor';
import TotalsPanel from '@/app/components/quote/TotalsPanel';
import PaymentSchedule, { fromServerStages, defaultStages } from '@/app/components/quote/PaymentSchedule';
import BillConfirm from '@/app/components/quote/BillConfirm';
import ClientAnswer from '@/app/components/quote/ClientAnswer';
import ProgressClaims from '@/app/components/quote/ProgressClaims';
import { claimCounts } from '@/lib/progressClaims.mjs';
import { VariationOrderList, VoBillCard } from '@/app/components/quote/VariationOrders';
import { getUser } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/roles.mjs';
import { quoteTotals } from '@/lib/quoteMaths.mjs';
import { attemptInFlight } from '@/lib/clientAcceptance.mjs';
import { blankItem, fromServerLines, toSavePayload, snapshot } from '@/lib/quoteEditor.mjs';
import { buildMemory } from '@/lib/priceMemory.mjs';
import { button, card, color, font, radius, space } from '@/lib/theme';

const NO_DISCOUNT = { on: false, mode: '$', value: '' };

export default function QuoteScreen({ code, voId }) {
  const router = useRouter();
  const isVo = !!voId;
  const projectHref = `/projects/${encodeURIComponent(code)}`;
  const quoteHref = `${projectHref}/quote`;

  const [user, setUser]         = useState(null);
  const [data, setData]         = useState(null);    // the screen payload from the server
  const [rows, setRows]         = useState([]);
  const [showUnit, setShowUnit] = useState(false);
  const [discount, setDiscount] = useState(NO_DISCOUNT);
  const [propertyType, setType] = useState('');
  const [stages, setStages]     = useState([]);
  const [voTitle, setVoTitle]   = useState('');      // VO only: its line on the final invoice
  const [voReason, setVoReason] = useState('');      // VO only: extra work / omitted / changed / goodwill
  const [billing, setBilling]   = useState(null);    // { stages } | { claim } | { vo: true }: the confirm step open
  const [saved, setSaved]       = useState('');      // snapshot of the last loaded/saved state
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [bumping, setBumping]   = useState(false);   // starting the next client-facing version
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');

  useEffect(() => { setUser(getUser()); }, []);
  const canQuote = !!user && can(user.role, PERMISSIONS.QUOTES);
  // Back to the view that links here: the Summary for admins, Billing for the office role
  const backHref = user && !can(user.role, PERMISSIONS.SUMMARY) ? `${projectHref}/billing` : projectHref;

  const defaultService = useMemo(() => {
    const cats = data?.categories || [];
    return cats.find(c => c.code === 'GENL' && c.active)?.code || cats.find(c => c.active)?.code || '';
  }, [data]);

  // Built once per load. The quote's own saved lines are left out, so it never suggests or
  // price-checks against itself.
  const memory = useMemo(
    () => (data ? buildMemory(data.priceHistory || [], { excludeQuoteId: data.quote?.id }) : null),
    [data]
  );

  const current = useCallback(
    () => snapshot(rows, { u: showUnit, d: discount.on ? [discount.mode, discount.value] : null, t: propertyType, s: stageShape(stages), v: [voTitle, voReason] }),
    [rows, showUnit, discount, propertyType, stages, voTitle, voReason]
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
    const nextStages = payload.schedule?.stages?.length ? fromServerStages(payload.schedule.stages) : defaultStages();
    const nextVo = [q?.voTitle || '', q?.voReason || ''];
    setData(payload);
    setStages(nextStages);
    setRows(nextRows);
    setShowUnit(nextUnit);
    setDiscount(nextDiscount);
    setType(nextType);
    setVoTitle(nextVo[0]);
    setVoReason(nextVo[1]);
    setSaved(snapshot(nextRows, { u: nextUnit, d: nextDiscount.on ? [nextDiscount.mode, nextDiscount.value] : null, t: nextType, s: stageShape(nextStages), v: nextVo }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // cache: 'no-store' so the service worker's cached copy is never mistaken for live
      const qs = new URLSearchParams({ screen: code, ...(voId ? { vo: voId } : {}) });
      const res = await fetch(`/api/quotes?${qs}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Could not load the quote');
      // A VO is only for a project that has a quote: its type and client come from there
      if (voId && !payload.project) throw new Error('No such project');
      adopt(payload);
    } catch (err) {
      setError(err instanceof TypeError ? 'Offline — the quote cannot be loaded' : err.message);
    } finally {
      setLoading(false);
    }
  }, [code, voId, adopt]);

  useEffect(() => { if (canQuote) load(); }, [canQuote, load]);

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

  // A VO's total keeps its sign: negative lines are an omission that comes off the final invoice
  const totals = useMemo(
    () => quoteTotals(
      rows.map(r => ({ kind: r.kind, qty: qtyOf(r), unitPrice: priceOf(r) })),
      discount.on ? discount.mode : '',
      discount.on ? discount.value : null,
      { signed: isVo }
    ),
    [rows, discount, isVo]
  );

  async function save() {
    setError('');
    setNotice('');
    if (!propertyType) { setError('Choose the property type before saving.'); return; }
    const payload = toSavePayload(rows);
    if (payload.error) { setError(payload.error); return; }
    if (!isVo && stages.some(st => !st.isFinal && !st.name.trim())) { setError('Every payment stage needs a name.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:            data.quote?.id,
          projectCode:   code,
          kind:          isVo ? 'vo' : 'quote',
          propertyType,
          lines:         payload.lines,
          showUnit,
          discountMode:  discount.on ? discount.mode : '',
          discountValue: discount.on && discount.value !== '' ? Number(discount.value) : null,
          voTitle:       isVo ? voTitle.trim() : undefined,
          voReason:      isVo ? voReason : undefined,
          stages:        isVo ? undefined : stages.map(st => ({
            id: st.id || undefined, name: st.name.trim(), isFinal: st.isFinal,
            sharePct: st.isFinal || st.sharePct === '' ? null : Number(st.sharePct),
          })),
          user:          user?.name || '',
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not save the quote');
      adopt({ ...data, ...result, project: result.project || data.project });
      const items = result.lines.filter(l => l.kind === 'item').length;
      // A new VO has its number now; move to its own address so a refresh reopens it
      if (isVo && voId === 'new') router.replace(`${quoteHref}/vo/${encodeURIComponent(result.quote.id)}`);
      setNotice(
        `Saved ${isVo ? `VO${result.quote.voNumber}` : result.quote.id}: ${items} line${items === 1 ? '' : 's'}, added to price history as ${propertyType} quotes.` +
        (payload.dropped ? ` ${payload.dropped} empty row${payload.dropped === 1 ? ' was' : 's were'} left out.` : '') +
        (result.warnings?.length ? ` Warning: ${result.warnings.join(' ')}` : '')
      );
    } catch (err) {
      setError(err instanceof TypeError ? 'Offline — the quote was not saved. Your edits are still here.' : err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Move the quote to its next client-facing version (v1 → v2). Only the version number
   * changes; edits on screen are kept as they are.
   */
  async function startVersion() {
    const from = data.quote.issueVersion;
    if (!window.confirm(`Start v${from + 1}? Every PDF downloaded from now on is labelled v${from + 1}. Do this when the client is getting a revised quote.`)) return;
    setBumping(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/quotes/version', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: data.quote.id, from }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not start a new version');
      setData(d => ({ ...d, quote: { ...d.quote, issueVersion: result.issueVersion } }));
      setNotice(`Now on v${result.issueVersion}. The next PDF you download is v${result.issueVersion}.`);
    } catch (err) {
      setError(err instanceof TypeError ? 'Offline — the version was not changed.' : err.message);
    } finally {
      setBumping(false);
    }
  }

  const project = data?.project;
  const locked = !!data?.quote?.xeroInvoiceId;   // a billed VO cannot change
  // Invoiced, or an invoice attempt that may already be in Xero: the answer can only be "accepted"
  const answerLocked = isVo
    ? locked || attemptInFlight(data?.quote)
    : !!data?.schedule?.stages?.some(st => st.xeroInvoiceId || attemptInFlight(st));
  const title = !isVo ? 'Quote and billing'
    : data?.quote ? `Variation order VO${data.quote.voNumber}` : 'New variation order';
  const subtitle = project ? `${project.address} · ${project.code}` : code;

  if (user && !canQuote) {
    return (
      <AppShell title={title} subtitle={code} onBack={() => router.push(projectHref)}>
        <div style={{ ...card, padding: space.xl, fontSize: font.size.sm }}>Your role cannot open quotes and billing.</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      layout="editor"
      title={title}
      subtitle={subtitle}
      onBack={() => leaveIfSafe(() => router.push(isVo ? quoteHref : backHref))}
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
              <Fact label={isVo ? 'Variation order' : 'Quote'} value={data.quote ? `${isVo ? `VO${data.quote.voNumber} · ` : ''}${data.quote.id} · saved ${formatWhen(data.quote.updatedAt)}` : 'Not saved yet'} />
              {data.quote && !isVo && (
                <VersionField value={data.quote.issueVersion} onIncrement={startVersion} busy={bumping} disabled={saving || bumping} />
              )}
            </div>
            {isVo && project.propertyType ? (
              <Fact label="Property type (from the project)" value={project.propertyType} />
            ) : (
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
            )}
          </div>

          {data.quote && (
            <ClientAnswer
              key={data.quote.id} quote={data.quote} billed={answerLocked} isVo={isVo}
              onChange={fields => setData(d => ({ ...d, quote: { ...d.quote, ...fields } }))}
            />
          )}

          {locked && (
            <div style={{ padding: `${space.sm}px ${space.md}px`, background: color.successLight, color: color.success, borderRadius: radius.md, fontSize: font.size.sm, fontWeight: 600 }}>
              {String(data.quote.settledOnStageId).startsWith('CLM-') ? 'Billed on progress claim invoice' : data.quote.settledOnStageId ? 'Settled on the final payment invoice' : 'Billed as'} {data.quote.xeroInvoiceNumber} on {formatWhen(data.quote.billedAt)}{data.quote.billedBy ? ` by ${data.quote.billedBy}` : ''}. It can no longer be changed; void it in Xero first if it is wrong.
            </div>
          )}

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
                type="checkbox" checked={showUnit} disabled={saving || locked}
                onChange={e => setShowUnit(e.target.checked)} style={{ width: 18, height: 18 }}
              />
              Show unit
            </label>
          </div>

          <LineEditor
            rows={rows} onChange={setRows} showUnit={showUnit} onShowUnit={setShowUnit}
            categories={data.categories} units={data.units}
            defaultService={defaultService} disabled={saving || locked}
            memory={memory} propertyType={propertyType} allowNegative={isVo}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xl, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.lg }}>
              {isVo ? (
                <VoBillCard
                  vo={data.quote} contractSum={totals.contractSum} dirty={dirty} disabled={saving} locked={locked}
                  title={voTitle} reason={voReason} onTitle={setVoTitle} onReason={setVoReason}
                  finalBilled={!!data.finalBilled}
                  onBill={() => setBilling({ vo: true })}
                />
              ) : (
                <>
                  <PaymentSchedule
                    rows={stages} onChange={setStages} contractSum={totals.contractSum}
                    vos={data.variationOrders || []}
                    dirty={dirty} saved={!!data.quote} disabled={saving}
                    onBill={list => setBilling({ stages: list })}
                    quoteId={data.quote?.id} onAttached={() => load()}
                    byClaims={(data.claims || []).some(claimCounts)}
                    liveBilled={data.liveBilled !== false}
                  />
                  {data.quote && (
                    <ProgressClaims
                      key={(data.claims || []).length}
                      quote={data.quote} stages={data.schedule?.stages || []} claims={data.claims || []}
                      vos={data.variationOrders || []}
                      block={dirty ? 'Save your changes first.' : ''}
                      onClaim={c => setBilling({ claim: c })}
                    />
                  )}
                  <VariationOrderList
                    vos={data.variationOrders || []}
                    onOpen={id => leaveIfSafe(() => router.push(`${quoteHref}/vo/${encodeURIComponent(id)}`))}
                    onNew={() => leaveIfSafe(() => router.push(`${quoteHref}/vo/new`))}
                    canAdd={!!data.quote} finalBilled={!!data.finalBilled} byClaims={!!data.byClaims}
                  />
                </>
              )}
            </div>

            <div style={{ flex: '0 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.md }}>
              <TotalsPanel totals={totals} discount={discount} onDiscount={setDiscount} disabled={saving || locked} />
              {!locked && (
                <button
                  type="button" onClick={save} disabled={saving || !dirty}
                  style={{ ...button.primary, opacity: saving || !dirty ? 0.6 : 1, cursor: saving || !dirty ? 'default' : 'pointer' }}
                >{saving ? 'Saving…' : dirty ? (isVo ? 'Save variation order' : 'Save quote') : 'Saved'}</button>
              )}
              {dirty && !saving && (
                <span style={{ fontSize: font.size.xs, color: color.accent, textAlign: 'center' }}>Unsaved changes</span>
              )}
              {data.quote && (
                <a
                  href={`/api/quotes/pdf?quote=${encodeURIComponent(data.quote.id)}`}
                  download
                  onClick={e => { if (dirty) { e.preventDefault(); setError('Save first: the PDF is made from the saved quote.'); } }}
                  style={{ ...button.secondary, textAlign: 'center', textDecoration: 'none', opacity: dirty ? 0.6 : 1 }}
                  title={dirty ? 'Save first: the PDF is made from the saved quote' : ''}
                >Download {isVo ? 'variation order PDF' : `quote PDF v${data.quote.issueVersion}`}</a>
              )}
              {data.quote && data.pdfGaps?.length > 0 && (
                <span style={{ fontSize: font.size.xs, color: color.accent }}>
                  The PDF has no {data.pdfGaps.join(', ')} yet. Fill them in System config; the logo is a file in the app.
                </span>
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
      {billing && data?.quote && (
        <BillConfirm
          quoteId={data.quote.id} stages={billing.stages} claim={billing.claim}
          title={billing.claim ? (billing.claim.claimId ? 'Retry progress claim' : `Progress claim: ${billing.claim.pct}% done`)
            : billing.stages ? `Bill ${billing.stages.map(st => st.name).join(' + ')}` : `Bill variation order VO${data.quote.voNumber}`}
          onClose={() => setBilling(null)}
          onBilled={() => load()}
        />
      )}
    </AppShell>
  );
}

/** The parts of the schedule a save sends, for the unsaved-changes check. */
function stageShape(stages) {
  return stages.map(st => [st.id, st.name, st.sharePct, st.isFinal]);
}

function Fact({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: font.size.xs, color: color.muted }}>{label}</div>
      <div style={{ fontSize: font.size.md, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/**
 * The quote's client-facing version, as a field that only counts up: there is no way to
 * type a number or step back, because a version a client has seen must never be reused.
 */
function VersionField({ value, onIncrement, busy, disabled }) {
  return (
    <div>
      <div style={{ fontSize: font.size.xs, color: color.muted }}>Version</div>
      <div style={{
        display: 'inline-flex', height: 40, marginTop: 2, overflow: 'hidden',
        border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.surface,
      }}>
        <span style={{ minWidth: 48, padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: font.size.md, fontWeight: 600 }}>
          v{value}
        </span>
        <button
          type="button" onClick={onIncrement} disabled={disabled}
          aria-label={`Start v${value + 1}`}
          title={`Start v${value + 1}, for a revised quote going to the client. Saving never changes the version.`}
          style={{
            width: 44, border: 'none', borderLeft: `1px solid ${color.border}`, background: color.surface,
            color: color.text, fontSize: font.size.lg, fontFamily: font.stack,
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
          }}
        >{busy ? '…' : '+'}</button>
      </div>
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
