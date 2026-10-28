'use client';

// The payment schedule card. Shares are edited here and saved with the quote; each stage is
// billed with "Bill now", or several on one invoice with "Bill stages together". Amounts come from lib/quoteMaths.mjs scheduleAmounts
// and finalPaymentDue, the same functions the server bills with, so what is shown is what
// is invoiced. The final row shows its balance of the contract sum, then one line per
// variation order it settles (additions and omissions), then the total due.

import { useState } from 'react';
import { scheduleAmounts, finalPaymentDue } from '@/lib/quoteMaths.mjs';
import { voSettlementDescription } from '@/lib/stageInvoice.mjs';
import { acceptDecimal } from '@/lib/quoteEditor.mjs';
import { retryGroup } from '@/lib/stageSelection.mjs';
import { attemptInFlight } from '@/lib/clientAcceptance.mjs';
import { formatAmount } from '@/app/components/TotalsCard';
import { card, color, font, radius, space } from '@/lib/theme';

const field = {
  height: 38, padding: '0 10px', fontSize: font.size.sm, fontFamily: font.stack, color: color.text,
  border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.surface,
  boxSizing: 'border-box', outline: 'none', width: '100%', minWidth: 0,
};
const COLS = 'minmax(0, 1fr) 92px 120px 132px 38px';
const head = { fontSize: font.size.xs, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: color.muted };

let n = 0;
export const stageKey = () => `s${Date.now().toString(36)}${++n}`;

/** Server stages → editable rows. */
export function fromServerStages(stages) {
  return stages.map(s => ({
    key: stageKey(), id: s.id, name: s.name, isFinal: s.isFinal,
    sharePct: s.isFinal || s.sharePct === null || s.sharePct === undefined ? '' : String(s.sharePct),
    billed: !!s.xeroInvoiceId, billedAmount: s.billedAmount, xeroInvoiceNumber: s.xeroInvoiceNumber || '',
    xeroSyncStatus: s.xeroSyncStatus || '', billedAt: s.billedAt || '', pdfAttachedAt: s.pdfAttachedAt || '',
    // A billed final payment keeps the VO lines it carried; an unbilled one computes them live
    balance: s.balance, settling: s.settling || [],
  }));
}

export function defaultStages() {
  return ['Deposit', 'Progress payment 1', 'Progress payment 2', 'Progress payment 3']
    .map(name => ({ key: stageKey(), id: '', name, sharePct: '', isFinal: false, billed: false }))
    .concat([{ key: stageKey(), id: '', name: 'Final payment (balance)', sharePct: '', isFinal: true, billed: false }]);
}

/**
 * Amounts and flags for the rows as they stand, unsaved edits included. `vos` are the
 * project's saved variation orders: those without an invoice go onto the final payment.
 * Returns the final's { balance, settling, due } as `final`.
 */
export function computeSchedule(rows, contractSum, vos = []) {
  const others = rows.filter(r => !r.isFinal);
  const final = rows.find(r => r.isFinal);
  const s = scheduleAmounts(
    contractSum,
    others.map(r => ({ sharePct: r.sharePct === '' ? null : Number(r.sharePct), billedAmount: r.billed ? r.billedAmount : null })),
    final?.billed ? final.billedAmount : null,
  );
  const amounts = new Map(others.map((r, i) => [r.key, s.amounts[i]]));
  let finalNegative = s.finalNegative;
  let detail = null;
  if (final) {
    if (final.billed) {
      detail = { balance: final.balance ?? s.finalAmount, settling: final.settling || [], due: s.finalAmount };
    } else {
      const due = finalPaymentDue(s.finalAmount, vos);
      detail = { balance: due.balance, settling: due.vos, due: due.due };
      finalNegative = due.negative;
    }
    amounts.set(final.key, detail.due);
  }
  return { ...s, finalNegative, amounts, final: detail };
}

export default function PaymentSchedule({ rows, onChange, contractSum, vos = [], dirty, saved, onBill, disabled, quoteId, onAttached, byClaims = false }) {
  const s = computeSchedule(rows, contractSum, vos);
  const nextKey = rows.find(r => !r.billed && (s.amounts.get(r.key) || 0) > 0)?.key;
  const set = (key, change) => onChange(rows.map(r => (r.key === key ? { ...r, ...change } : r)));

  function addStage() {
    const highest = rows.reduce((m, r) => Math.max(m, Number(/^Progress payment (\d+)$/.exec(r.name)?.[1] || 0)), 0);
    const row = { key: stageKey(), id: '', name: `Progress payment ${highest + 1}`, sharePct: '', isFinal: false, billed: false };
    const i = rows.findIndex(r => r.isFinal);
    const next = rows.slice();
    next.splice(i === -1 ? next.length : i, 0, row);
    onChange(next);
  }

  // Why "Bill now" is off for every stage, if it is. Per-stage reasons are in the button title.
  const globalBlock = byClaims ? 'This job is billed by progress claims now, so the stages are switched off.'
    : !saved ? 'Save the quote before billing.'
    : dirty ? 'Save your changes before billing.'
    : s.overAllocated ? 'The stages add up to more than 100%.'
    : s.finalNegative ? (s.final?.balance >= 0 ? 'The omissions come to more than what is left to bill.' : 'The contract sum is less than what has already been billed.')
    : '';

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: `${space.md}px ${space.lg}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm }}>
        <h2 style={{ margin: 0, fontSize: font.size.lg, fontWeight: 700 }}>Payment schedule</h2>
        <span style={{ fontSize: font.size.xs, color: color.muted }}>Shares of the contract sum. Saved with the quote.</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: space.sm, padding: `${space.sm}px ${space.lg}px`, background: '#EEF1F3' }}>
            <div style={head}>Stage</div><div style={head}>Share</div>
            <div style={{ ...head, textAlign: 'right' }}>Amount</div><div style={head}>Status</div><div />
          </div>
          {rows.map(r => {
            const amount = s.amounts.get(r.key) || 0;
            const stageBlock = globalBlock || (amount <= 0 ? 'Give this stage a share first.' : '');
            return (
              <div key={r.key} style={{
                display: 'grid', gridTemplateColumns: COLS, gap: space.sm, alignItems: 'center',
                padding: `${space.sm}px ${space.lg}px`, borderTop: `1px solid ${color.border}`,
                background: r.isFinal ? '#F7F8F9' : color.surface,
              }}>
                {r.isFinal ? (
                  <div style={{ paddingLeft: 10, minWidth: 0 }}>
                    <div style={{ fontSize: font.size.sm, fontWeight: 600 }}>{r.name}</div>
                    {s.final?.settling.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, fontSize: font.size.xs, color: color.muted }}>
                        <FinalLine label="Balance of contract sum" amount={s.final.balance} />
                        {s.final.settling.map(vo => (
                          <FinalLine key={vo.id} label={voSettlementDescription(vo)} amount={vo.contractSum} />
                        ))}
                        <FinalLine label="Total due" amount={s.final.due} strong />
                      </div>
                    )}
                  </div>
                ) : r.billed ? (
                  <div style={{ fontSize: font.size.sm, fontWeight: 600, paddingLeft: 10 }}>{r.name}</div>
                ) : (
                  <input value={r.name} disabled={disabled} aria-label="Stage name" style={field}
                    onChange={e => set(r.key, { name: e.target.value })} />
                )}
                {r.isFinal ? (
                  <div style={{ fontSize: font.size.sm, color: color.muted, paddingLeft: 10 }}>{formatPct(s.finalPct)}</div>
                ) : r.billed ? (
                  <div style={{ fontSize: font.size.sm, color: color.muted, paddingLeft: 10 }}>{formatPct(r.sharePct)}</div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input value={r.sharePct} disabled={disabled} inputMode="decimal" aria-label="Share in percent" placeholder="0"
                      style={{ ...field, textAlign: 'right' }}
                      onChange={e => set(r.key, { sharePct: acceptDecimal(e.target.value, r.sharePct) })} />
                    <span style={{ fontSize: font.size.sm, color: color.muted }}>%</span>
                  </div>
                )}
                <div style={{ textAlign: 'right', fontSize: font.size.sm, fontWeight: 600, color: amount < 0 ? color.danger : color.text, alignSelf: 'start', lineHeight: '38px' }}>
                  {formatAmount(amount)}
                </div>
                <div>
                  {r.billed ? (
                    <span title={r.billedAt ? `Billed ${r.billedAt}` : ''} style={{
                      display: 'inline-block', padding: '5px 9px', borderRadius: radius.sm, fontSize: font.size.xs,
                      fontWeight: 600, background: color.successLight, color: color.success,
                    }}>Billed · {r.xeroInvoiceNumber}</span>
                  ) : (
                    <button type="button" disabled={disabled || !!stageBlock || !r.id} title={stageBlock || (!r.id ? 'Save the quote first.' : '')}
                      onClick={() => onBill(retryGroup(rows, r))} className="qe-btn"
                      style={{
                        height: 36, padding: '0 14px', borderRadius: radius.sm, fontWeight: 600, fontSize: font.size.sm,
                        fontFamily: font.stack, cursor: 'pointer',
                        border: `1px solid ${r.key === nextKey ? color.primary : color.border}`,
                        background: r.key === nextKey ? color.primary : color.surface,
                        color: r.key === nextKey ? '#fff' : color.text,
                      }}
                    >{attemptInFlight(r) ? 'Retry bill' : 'Bill now'}</button>
                  )}
                </div>
                {r.isFinal ? <div /> : (
                  <button type="button" className="qe-btn" disabled={disabled || r.billed}
                    aria-label="Remove stage"
                    title={r.billed ? 'This stage has been invoiced. Void the invoice in Xero before removing it.' : 'Remove stage'}
                    onClick={() => onChange(rows.filter(x => x.key !== r.key))}
                    style={{ ...field, width: 38, padding: 0, cursor: 'pointer', color: color.danger, fontSize: 18, lineHeight: 1 }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ padding: `${space.md}px ${space.lg}px`, borderTop: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', gap: space.sm }}>
        <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="qe-btn" disabled={disabled} onClick={addStage}
            style={{ height: 40, padding: '0 14px', borderRadius: radius.sm, border: `1px dashed ${color.subtle}`, background: color.surface, fontWeight: 600, fontSize: font.size.sm, fontFamily: font.stack, cursor: 'pointer', color: color.text }}
          >+ Add stage</button>
          <span style={{ fontSize: font.size.xs, color: color.muted }}>Shares total {formatPct(s.sharesTotal)}; the final payment takes the rest, plus any variation orders not billed early.</span>
        </div>
        {!globalBlock && (
          <BillTogether
            key={rows.filter(r => r.billed).length}
            rows={rows.filter(r => !r.billed && r.id && !r.xeroInvoiceNumber && (s.amounts.get(r.key) || 0) > 0)}
            amounts={s.amounts} disabled={disabled} onBill={onBill}
          />
        )}
        {s.overAllocated && (
          <div role="alert" style={{ padding: `${space.sm}px ${space.md}px`, background: color.dangerLight, color: color.danger, borderRadius: radius.md, fontSize: font.size.xs }}>
            The stages add up to more than 100%. Reduce a share so there is a balance for the final payment. Billing is off until then.
          </div>
        )}
        {!s.overAllocated && s.finalNegative && (
          <div role="alert" style={{ padding: `${space.sm}px ${space.md}px`, background: color.dangerLight, color: color.danger, borderRadius: radius.md, fontSize: font.size.xs }}>
            {s.final?.balance >= 0
              ? 'The omissions come to more than what is left to bill, so the final invoice would be negative. Xero refuses that. Billing is off until the quote or a variation order is fixed.'
              : 'The contract sum is now less than what has already been billed, so the final payment is negative. Billing is off until the quote is fixed.'}
          </div>
        )}
        {rows.some(r => r.billed) && !rows.some(r => r.pdfAttachedAt) && (
          <AttachPdf quoteId={quoteId} onAttached={onAttached} />
        )}
        {rows.some(r => r.pdfAttachedAt) && (
          <span style={{ fontSize: font.size.xs, color: color.muted }}>
            Quote PDF attached to {rows.find(r => r.pdfAttachedAt).xeroInvoiceNumber} in Xero.
          </span>
        )}
        {(dirty || !saved || byClaims) && !s.overAllocated && (
          <span style={{ fontSize: font.size.xs, color: color.accent }}>{globalBlock}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Several unbilled stages on one invoice, e.g. progress payments 2 and 3 when the work went
 * faster. Each stage keeps its own amount and records the same invoice. Stages with an
 * unfinished attempt are left out: their Retry bill handles them.
 */
function BillTogether({ rows, amounts, disabled, onBill }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState([]);
  if (rows.length < 2) return null;
  const chosen = rows.filter(r => picked.includes(r.key));
  const total = chosen.reduce((acc, r) => acc + Math.round((amounts.get(r.key) || 0) * 100), 0) / 100;
  const toggle = key => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : [...p, key]));
  if (!open) {
    return (
      <div>
        <button type="button" className="qe-btn" disabled={disabled} onClick={() => setOpen(true)}
          style={{ ...field, width: 'auto', height: 40, padding: '0 14px', cursor: 'pointer', fontWeight: 600 }}
        >Bill stages together…</button>
      </div>
    );
  }
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.md, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <span style={{ fontSize: font.size.sm, fontWeight: 600 }}>Pick the stages to put on one invoice</span>
      {rows.map(r => (
        <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: space.sm, minHeight: 40, fontSize: font.size.sm, cursor: 'pointer' }}>
          <input type="checkbox" checked={picked.includes(r.key)} onChange={() => toggle(r.key)} style={{ width: 20, height: 20, flexShrink: 0 }} />
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>{r.name}</span>
          <span style={{ fontWeight: 600 }}>{formatAmount(amounts.get(r.key) || 0)}</span>
        </label>
      ))}
      <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
        <button type="button" className="qe-btn" disabled={disabled || chosen.length < 2} onClick={() => onBill(chosen)}
          style={{ ...field, width: 'auto', height: 40, padding: '0 14px', cursor: 'pointer', fontWeight: 600, background: color.primary, color: '#fff', borderColor: color.primary, opacity: chosen.length < 2 ? 0.6 : 1 }}
        >{chosen.length < 2 ? 'Pick at least 2' : `Bill ${chosen.length} stages: ${formatAmount(total)}`}</button>
        <button type="button" className="qe-btn" onClick={() => { setOpen(false); setPicked([]); }}
          style={{ ...field, width: 'auto', height: 40, padding: '0 14px', cursor: 'pointer' }}
        >Cancel</button>
      </div>
    </div>
  );
}

/** One line of the final payment's make-up: the balance, a VO, or the total due. */
function FinalLine({ label, amount, strong = false }) {
  const neg = amount < 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: space.md, fontWeight: strong ? 600 : 400, color: strong ? color.text : color.muted }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ whiteSpace: 'nowrap', color: neg ? color.danger : undefined }}>{neg ? `−${formatAmount(-amount)}` : formatAmount(amount)}</span>
    </div>
  );
}

function formatPct(v) {
  if (v === '' || v === null || v === undefined) return '0%';
  return `${Number(Number(v).toFixed(2))}%`;
}

/**
 * Shown only when a stage has been billed but the quote PDF never reached its invoice
 * (the attachment failed, or the stage was billed before this existed). Needs the PIN,
 * like every Xero write.
 */
function AttachPdf({ quoteId, onAttached }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function go() {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/quotes/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId, pin }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not attach the PDF');
      setMsg(d.attached ? `Attached to ${d.invoiceNumber}.` : d.skipped);
      if (d.attached) onAttached?.();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false); setPin('');
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', padding: `${space.sm}px ${space.md}px`, background: color.accentLight, borderRadius: radius.md }}>
      <span style={{ fontSize: font.size.xs, color: color.accent, flex: '1 1 220px' }}>The quote PDF is not on the first invoice in Xero yet.</span>
      {!open ? (
        <button type="button" className="qe-btn" onClick={() => setOpen(true)} style={{ ...field, width: 'auto', padding: '0 12px', cursor: 'pointer', fontWeight: 600 }}>Attach quote PDF</button>
      ) : (
        <>
          <input type="password" inputMode="numeric" maxLength={4} value={pin} placeholder="PIN" aria-label="Your PIN"
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} style={{ ...field, width: 80 }} />
          <button type="button" disabled={busy || pin.length !== 4} onClick={go}
            style={{ ...field, width: 'auto', padding: '0 12px', cursor: 'pointer', fontWeight: 600, background: color.primary, color: '#fff', borderColor: color.primary }}>
            {busy ? 'Attaching…' : 'Attach'}
          </button>
        </>
      )}
      {msg && <span style={{ fontSize: font.size.xs, color: color.text, flexBasis: '100%' }}>{msg}</span>}
    </div>
  );
}
