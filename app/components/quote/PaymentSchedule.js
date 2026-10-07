'use client';

// The payment schedule card. Shares are edited here and saved with the quote; each stage is
// billed on its own with "Bill now". Amounts come from lib/quoteMaths.mjs scheduleAmounts,
// the same function the server bills with, so what is shown is what is invoiced.

import { scheduleAmounts } from '@/lib/quoteMaths.mjs';
import { acceptDecimal } from '@/lib/quoteEditor.mjs';
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
    xeroSyncStatus: s.xeroSyncStatus || '', billedAt: s.billedAt || '',
  }));
}

export function defaultStages() {
  return ['Deposit', 'Progress payment 1', 'Progress payment 2', 'Progress payment 3']
    .map(name => ({ key: stageKey(), id: '', name, sharePct: '', isFinal: false, billed: false }))
    .concat([{ key: stageKey(), id: '', name: 'Final payment (balance)', sharePct: '', isFinal: true, billed: false }]);
}

/** Amounts and flags for the rows as they stand, unsaved edits included. */
export function computeSchedule(rows, contractSum) {
  const others = rows.filter(r => !r.isFinal);
  const final = rows.find(r => r.isFinal);
  const s = scheduleAmounts(
    contractSum,
    others.map(r => ({ sharePct: r.sharePct === '' ? null : Number(r.sharePct), billedAmount: r.billed ? r.billedAmount : null })),
    final?.billed ? final.billedAmount : null,
  );
  const amounts = new Map(others.map((r, i) => [r.key, s.amounts[i]]));
  if (final) amounts.set(final.key, s.finalAmount);
  return { ...s, amounts };
}

export default function PaymentSchedule({ rows, onChange, contractSum, dirty, saved, onBill, disabled }) {
  const s = computeSchedule(rows, contractSum);
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
  const globalBlock = !saved ? 'Save the quote before billing.'
    : dirty ? 'Save your changes before billing.'
    : s.overAllocated ? 'The stages add up to more than 100%.'
    : s.finalNegative ? 'The contract sum is less than what has already been billed.'
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
                {r.isFinal || r.billed ? (
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
                <div style={{ textAlign: 'right', fontSize: font.size.sm, fontWeight: 600, color: amount < 0 ? color.danger : color.text }}>
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
                      onClick={() => onBill(r)} className="qe-btn"
                      style={{
                        height: 36, padding: '0 14px', borderRadius: radius.sm, fontWeight: 600, fontSize: font.size.sm,
                        fontFamily: font.stack, cursor: 'pointer',
                        border: `1px solid ${r.key === nextKey ? color.primary : color.border}`,
                        background: r.key === nextKey ? color.primary : color.surface,
                        color: r.key === nextKey ? '#fff' : color.text,
                      }}
                    >{r.xeroSyncStatus === 'error' ? 'Retry bill' : 'Bill now'}</button>
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
          <span style={{ fontSize: font.size.xs, color: color.muted }}>Shares total {formatPct(s.sharesTotal)}; the final payment takes the rest.</span>
        </div>
        {s.overAllocated && (
          <div role="alert" style={{ padding: `${space.sm}px ${space.md}px`, background: color.dangerLight, color: color.danger, borderRadius: radius.md, fontSize: font.size.xs }}>
            The stages add up to more than 100%. Reduce a share so there is a balance for the final payment. Billing is off until then.
          </div>
        )}
        {!s.overAllocated && s.finalNegative && (
          <div role="alert" style={{ padding: `${space.sm}px ${space.md}px`, background: color.dangerLight, color: color.danger, borderRadius: radius.md, fontSize: font.size.xs }}>
            The contract sum is now less than what has already been billed, so the final payment is negative. Billing is off until the quote is fixed.
          </div>
        )}
        {(dirty || !saved) && !s.overAllocated && (
          <span style={{ fontSize: font.size.xs, color: color.accent }}>{globalBlock}</span>
        )}
      </div>
    </div>
  );
}

function formatPct(v) {
  if (v === '' || v === null || v === undefined) return '0%';
  return `${Number(Number(v).toFixed(2))}%`;
}
