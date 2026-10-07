'use client';

// The confirm step before an invoice is created: invoice number, client, amount and the
// exact line Xero will receive, then the PIN. Nothing is sent until Confirm is pressed.

import { useEffect, useState } from 'react';
import { formatAmount } from '@/app/components/TotalsCard';
import { formatIsoDate } from '@/lib/dates';
import { button, card, color, font, radius, space } from '@/lib/theme';

// `stage` set: bill that payment stage. `stage` absent: bill the variation order `quoteId`.
export default function BillConfirm({ quoteId, stage, title, onClose, onBilled }) {
  const [prep, setPrep]       = useState(null);
  const [error, setError]     = useState('');
  const [pin, setPin]         = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState(null);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams({ quote: quoteId, ...(stage ? { stage: stage.id } : {}) });
    fetch(`/api/quotes/bill?${qs}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not prepare the invoice'); return d; })
      .then(d => { if (live) setPrep(d); })
      .catch(err => { if (live) setError(err instanceof TypeError ? 'Offline — cannot reach Xero' : err.message); });
    return () => { live = false; };
  }, [quoteId, stage?.id]);

  async function confirm() {
    if (sending || pin.length !== 4) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/quotes/bill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId, stageId: stage?.id, pin,
          expected: { amount: prep.preview.amount, quoteVersion: prep.preview.quoteVersion },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Billing failed');
      setResult(d);
      if (!d.dryRun) onBilled(d);
    } catch (err) {
      setError(err instanceof TypeError
        ? 'The connection dropped. The invoice may or may not have been created; press Bill now again — it checks Xero first and will not create a second one.'
        : err.message);
      setPin('');
    } finally {
      setSending(false);
    }
  }

  const p = prep?.preview;
  const blocked = prep?.blockers?.length > 0;

  return (
    <div role="dialog" aria-modal="true" aria-label="Confirm invoice" style={{
      position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(16,24,40,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space.lg,
    }}>
      <div style={{ ...card, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', padding: space.xl, display: 'flex', flexDirection: 'column', gap: space.md }}>
        <h2 style={{ margin: 0, fontSize: font.size.xl, fontWeight: 700 }}>{title}</h2>

        {!prep && !error && <p style={{ margin: 0, fontSize: font.size.sm, color: color.muted }}>Checking Xero…</p>}

        {prep?.dryRun && (
          <div style={{ padding: `${space.sm}px ${space.md}px`, background: color.accentLight, color: color.accent, borderRadius: radius.md, fontSize: font.size.xs, fontWeight: 600 }}>
            DRY RUN — nothing will be sent to Xero and the stage will stay unbilled. You will see exactly what would have been sent.
          </div>
        )}

        {p && (
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 6, columnGap: space.md, fontSize: font.size.sm }}>
            <dt style={{ color: color.muted }}>Invoice number</dt><dd style={{ margin: 0, fontWeight: 700 }}>{p.invoiceNumber}</dd>
            <dt style={{ color: color.muted }}>Client (Xero)</dt><dd style={{ margin: 0, fontWeight: 600 }}>{p.client || '—'}</dd>
            <dt style={{ color: color.muted }}>Amount</dt><dd style={{ margin: 0, fontWeight: 700, fontSize: font.size.lg }}>${formatAmount(p.amount)} <span style={{ fontSize: font.size.xs, color: color.muted, fontWeight: 400 }}>No GST</span></dd>
            {!p.lines && <><dt style={{ color: color.muted }}>Line</dt><dd style={{ margin: 0 }}>{p.description || '—'}</dd></>}
            <dt style={{ color: color.muted }}>Reference</dt><dd style={{ margin: 0 }}>{p.reference}</dd>
            <dt style={{ color: color.muted }}>Date / due</dt><dd style={{ margin: 0 }}>{formatIsoDate(p.date)} / {formatIsoDate(p.dueDate)}</dd>
            <dt style={{ color: color.muted }}>Status in Xero</dt><dd style={{ margin: 0 }}>Approved (on the client&apos;s statement straight away)</dd>
          </dl>
        )}

        {p?.lines?.length > 0 && (
          <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.sm, overflow: 'hidden' }}>
            <div style={{ padding: `${space.xs}px ${space.md}px`, background: '#EEF1F3', fontSize: font.size.xs, fontWeight: 600, color: color.muted }}>
              Lines Xero will receive ({p.lines.length})
            </div>
            {p.lines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 70px 90px', gap: space.sm, padding: `6px ${space.md}px`, borderTop: `1px solid ${color.border}`, fontSize: font.size.xs }}>
                <span style={{ fontWeight: l.Quantity === undefined ? 700 : 400, whiteSpace: 'pre-wrap' }}>{l.Description}</span>
                <span style={{ textAlign: 'right', color: color.muted }}>{l.Quantity === undefined ? '' : `${l.Quantity} ×`}</span>
                <span style={{ textAlign: 'right' }}>{l.UnitAmount === undefined ? '' : `$${formatAmount(l.UnitAmount)}`}{l.Tracking ? <span style={{ display: 'block', color: color.muted }}>{l.Tracking[0].Option}</span> : null}</span>
              </div>
            ))}
          </div>
        )}

        {blocked && (
          <div role="alert" style={{ padding: `${space.sm}px ${space.md}px`, background: color.dangerLight, color: color.danger, borderRadius: radius.md, fontSize: font.size.sm }}>
            {prep.blockers.map(b => <div key={b}>{b}</div>)}
          </div>
        )}

        {result?.dryRun && (
          <div>
            <div style={{ fontSize: font.size.sm, fontWeight: 600, marginBottom: space.xs }}>Dry run: this is what would have been sent. Nothing was sent.</div>
            <pre style={{ margin: 0, padding: space.md, background: '#F3F5F6', borderRadius: radius.sm, fontSize: 11, overflowX: 'auto', whiteSpace: 'pre' }}>
              {JSON.stringify(result.invoice, null, 2)}
            </pre>
          </div>
        )}
        {result?.billed && (
          <div role="status" style={{ padding: `${space.sm}px ${space.md}px`, background: color.successLight, color: color.success, borderRadius: radius.md, fontSize: font.size.sm, fontWeight: 600 }}>
            Invoice {result.invoiceNumber} created in Xero and approved.
          </div>
        )}
        {result?.alreadyBilled && (
          <div role="status" style={{ padding: `${space.sm}px ${space.md}px`, background: color.successLight, color: color.success, borderRadius: radius.md, fontSize: font.size.sm }}>{result.message}</div>
        )}

        {error && (
          <div role="alert" style={{ padding: `${space.sm}px ${space.md}px`, background: color.dangerLight, color: color.danger, borderRadius: radius.md, fontSize: font.size.sm }}>{error}</div>
        )}

        {p && !blocked && !result && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: space.xs, fontSize: font.size.sm }}>
            Your PIN, to confirm
            <input
              type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} autoFocus
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter') confirm(); }}
              style={{ height: 44, padding: '0 12px', fontSize: font.size.lg, letterSpacing: '0.3em', border: `1px solid ${color.border}`, borderRadius: radius.md, width: 140, fontFamily: font.stack }}
            />
          </label>
        )}

        <div style={{ display: 'flex', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} disabled={sending} style={button.secondary}>{result ? 'Close' : 'Cancel'}</button>
          {p && !blocked && !result && (
            <button type="button" onClick={confirm} disabled={sending || pin.length !== 4}
              style={{ ...button.primary, opacity: sending || pin.length !== 4 ? 0.6 : 1 }}>
              {sending ? 'Sending…' : prep.dryRun ? 'Run dry run' : `Create invoice for $${formatAmount(p.amount)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
