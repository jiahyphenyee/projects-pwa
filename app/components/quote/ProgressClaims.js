'use client';

// Progress claims on the quote screen: bill by % of the work done instead of the payment
// stages (Proposal 03). The figures shown are lib/progressClaims.mjs, the same functions the
// server bills with; the confirm step (BillConfirm) shows exactly what Xero will receive.
//
//   claim = % done × contract sum − already billed on the quote, + ticked VOs at full amount

import { useState } from 'react';
import { claimFigures, mainBilledBefore, lastPct, claimCounts } from '@/lib/progressClaims.mjs';
import { attemptInFlight, settlingBlocker } from '@/lib/clientAcceptance.mjs';
import { voSettlementDescription } from '@/lib/stageInvoice.mjs';
import { acceptDecimal } from '@/lib/quoteEditor.mjs';
import { formatAmount } from '@/app/components/TotalsCard';
import { button, card, color, font, radius, space } from '@/lib/theme';

const field = {
  height: 44, padding: '0 10px', fontSize: font.size.md, fontFamily: font.stack, color: color.text,
  border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.surface,
  boxSizing: 'border-box', width: 110, textAlign: 'right',
};
const signed = n => (n < 0 ? `−${formatAmount(-n)}` : formatAmount(n));
const pctText = n => `${Number(Number(n).toFixed(2))}%`;

/**
 * `quote` saved main quote; `stages` schedule stages (with billedAmount); `claims` its claims;
 * `vos` the project's VOs. `block`: why no claim can be made now ('' if it can).
 * `onClaim({ pct, voIds } | { claimId })` opens the confirm step.
 */
export default function ProgressClaims({ quote, stages = [], claims = [], vos = [], block = '', onClaim }) {
  const counted = claims.filter(claimCounts);
  const open = vos.filter(v => !v.xeroInvoiceId && !attemptInFlight(v));
  const [pct, setPct] = useState('');
  const [unticked, setUnticked] = useState([]);   // ticked by default: only exceptions are kept
  const [show, setShow] = useState(counted.length > 0);

  const accepted = open.filter(v => !settlingBlocker(v));
  const all100 = Number(pct) === 100;
  const chosen = accepted.filter(v => all100 || !unticked.includes(v.id));
  const fig = claimFigures({
    contractSum: quote.contractSum, pct, billedBefore: mainBilledBefore(stages, counted),
    previousPct: lastPct(counted), vos: chosen,
  });

  const busy = claims.find(attemptInFlight);
  const finalBilled = stages.some(s => s.isFinal && s.xeroInvoiceId);
  const why = block || (finalBilled ? 'The final payment is already invoiced.' : '') || (busy ? `Claim ${busy.claimNo} has an unfinished attempt: press Retry on it first.` : '');

  if (!show) {
    return (
      <div style={{ ...card, padding: space.lg, display: 'flex', flexWrap: 'wrap', gap: space.sm, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <div style={{ fontSize: font.size.md, fontWeight: 700 }}>Progress claims</div>
          <div style={{ fontSize: font.size.xs, color: color.muted }}>Bill by % of work done instead of the stages. After the first claim, the stages are switched off.</div>
        </div>
        <button type="button" disabled={finalBilled} onClick={() => setShow(true)} style={{ ...button.secondary, minHeight: 44 }}>Bill by % done…</button>
      </div>
    );
  }

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: `${space.md}px ${space.lg}px` }}>
        <h2 style={{ margin: 0, fontSize: font.size.lg, fontWeight: 700 }}>Progress claims</h2>
        <span style={{ fontSize: font.size.xs, color: color.muted }}>
          % done × contract sum, less what is already billed, plus the VOs you tick at their full amount.
        </span>
      </div>

      {claims.map(c => (
        <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, alignItems: 'center', padding: `${space.sm}px ${space.lg}px`, borderTop: `1px solid ${color.border}` }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ fontSize: font.size.sm, fontWeight: 600 }}>Claim {c.claimNo} · {pctText(c.pctDone)} done</div>
            <div style={{ fontSize: font.size.xs, color: color.muted }}>
              {formatAmount(c.mainAmount)}{c.voIds.length ? ` + ${c.voIds.length} VO${c.voIds.length === 1 ? '' : 's'} ${signed(c.voAmount)}` : ''}
            </div>
          </div>
          <span style={{ fontSize: font.size.sm, fontWeight: 700 }}>{formatAmount(c.total)}</span>
          {c.xeroInvoiceId ? (
            <span style={{ padding: '5px 9px', borderRadius: radius.sm, fontSize: font.size.xs, fontWeight: 600, background: color.successLight, color: color.success }}>Billed · {c.xeroInvoiceNumber}</span>
          ) : attemptInFlight(c) ? (
            <button type="button" onClick={() => onClaim({ claimId: c.id })} style={{ ...button.primary, minHeight: 40, padding: '0 14px' }}>Retry</button>
          ) : null}
        </div>
      ))}

      <div style={{ padding: `${space.md}px ${space.lg}px`, borderTop: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', gap: space.sm }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', fontSize: font.size.sm, fontWeight: 600 }}>
          New claim: work done
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input value={pct} inputMode="decimal" placeholder={counted.length ? `> ${lastPct(counted)}` : '0'} aria-label="% of work done"
              onChange={e => setPct(acceptDecimal(e.target.value, pct))} style={field} disabled={!!why} />
            <span style={{ color: color.muted }}>%</span>
          </span>
        </label>

        {open.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: font.size.xs, color: color.muted }}>
              Variation orders on this claim{all100 ? ' (100% adds every accepted one)' : ''}:
            </span>
            {open.map(v => {
              const notAccepted = !!settlingBlocker(v);
              const on = !notAccepted && (all100 || !unticked.includes(v.id));
              return (
                <label key={v.id} style={{ display: 'flex', alignItems: 'center', gap: space.sm, minHeight: 40, fontSize: font.size.sm, opacity: notAccepted ? 0.55 : 1 }}>
                  <input type="checkbox" checked={on} disabled={notAccepted || all100 || !!why}
                    onChange={() => setUnticked(u => (u.includes(v.id) ? u.filter(x => x !== v.id) : [...u, v.id]))}
                    style={{ width: 20, height: 20, flexShrink: 0 }} />
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>{voSettlementDescription(v)}{notAccepted ? ' · not accepted yet' : ''}</span>
                  <span style={{ fontWeight: 600 }}>{signed(v.contractSum)}</span>
                </label>
              );
            })}
          </div>
        )}

        {fig.pct !== null && (
          <div style={{ background: '#F7F8F9', borderRadius: radius.md, padding: space.md, display: 'flex', flexDirection: 'column', gap: 4, fontSize: font.size.sm }}>
            <Line label={`${pctText(fig.pct)} of contract sum ${formatAmount(quote.contractSum)}`} amount={fig.gross} />
            {fig.billedBefore > 0 && <Line label="Less already billed" amount={-fig.billedBefore} />}
            {chosen.map(v => <Line key={v.id} label={voSettlementDescription(v)} amount={v.contractSum} />)}
            <Line label="Total due" amount={fig.total} strong />
          </div>
        )}
        {pct !== '' && fig.problems.length > 0 && (
          <span role="alert" style={{ fontSize: font.size.xs, color: color.danger }}>{fig.problems.join(' ')}</span>
        )}
        {why && <span style={{ fontSize: font.size.xs, color: color.accent }}>{why}</span>}
        <div>
          <button type="button" disabled={!!why || fig.problems.length > 0}
            onClick={() => onClaim({ pct: Number(pct), voIds: chosen.map(v => v.id) })}
            style={{ ...button.primary, minHeight: 44, opacity: why || fig.problems.length ? 0.6 : 1 }}
          >{fig.problems.length || why ? 'Make claim' : `Make claim for ${formatAmount(fig.total)}`}</button>
        </div>
      </div>
    </div>
  );
}

function Line({ label, amount, strong = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: space.md, fontWeight: strong ? 700 : 400 }}>
      <span style={{ minWidth: 0 }}>{label}</span>
      <span style={{ whiteSpace: 'nowrap', color: amount < 0 ? color.danger : undefined }}>{signed(amount)}</span>
    </div>
  );
}
