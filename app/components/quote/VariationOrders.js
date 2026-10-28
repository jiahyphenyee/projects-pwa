'use client';

// Variation orders on the quote screen (the list, with "+ Variation order") and on a VO's
// own screen (the card with its title, reason and billing). A VO adds work (positive lines)
// or omits it (negative lines). Every VO settles on the final payment invoice as one signed
// line, unless it is an addition billed early with "Bill now", which then stays off it.

import { formatAmount } from '@/app/components/TotalsCard';
import { VO_REASONS } from '@/lib/quoteSchema.mjs';
import { card, color, font, radius, space } from '@/lib/theme';

const badge = (bg, fg) => ({
  display: 'inline-block', padding: '4px 9px', borderRadius: radius.sm, fontSize: font.size.xs,
  fontWeight: 600, background: bg, color: fg, whiteSpace: 'nowrap',
});

const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%236B7280' stroke-width='1.75' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

const field = {
  height: 38, padding: '0 10px', fontSize: font.size.sm, fontFamily: font.stack, color: color.text,
  border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.surface,
  boxSizing: 'border-box', outline: 'none', width: '100%', minWidth: 0,
};
const select = {
  ...field, appearance: 'none', WebkitAppearance: 'none', paddingRight: 30,
  backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
};

/**
 * `finalBilled`: whether the project's final payment is already invoiced. A VO not yet
 * billed is then "Not billed" rather than "On final invoice" — there is no final left.
 */
export function voStatus(vo, finalBilled = false, byClaims = false) {
  const onClaim = String(vo.settledOnStageId || '').startsWith('CLM-');
  if (vo.xeroInvoiceId && vo.settledOnStageId) return { label: `${onClaim ? 'On claim' : 'On final'} · ${vo.xeroInvoiceNumber}`, style: badge(color.successLight, color.success) };
  if (vo.xeroInvoiceId) return { label: `Billed · ${vo.xeroInvoiceNumber}`, style: badge(color.successLight, color.success) };
  if (vo.status === 'error') return { label: 'Billing failed — retry', style: badge(color.dangerLight, color.danger) };
  if (vo.status === 'sending') return { label: 'Billing unfinished — retry', style: badge(color.accentLight, color.accent) };
  if (finalBilled) return { label: 'Not billed', style: badge('#EEF1F3', color.muted) };
  if (byClaims) return { label: 'For a progress claim', style: badge(color.accentLight, color.accent) };
  return { label: 'On final invoice', style: badge(color.accentLight, color.accent) };
}

/** "−500.00" for an omission, "800.00" for an addition. */
const signed = n => (n < 0 ? `−${formatAmount(-n)}` : formatAmount(n));

export function VariationOrderList({ vos, onOpen, onNew, canAdd, finalBilled = false, byClaims = false }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: `${space.md}px ${space.lg}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm }}>
        <h2 style={{ margin: 0, fontSize: font.size.lg, fontWeight: 700 }}>Variation orders</h2>
        <span style={{ fontSize: font.size.xs, color: color.muted }}>Additions and omissions. Each settles on the final invoice unless billed early.</span>
      </div>
      {vos.map(vo => {
        const st = voStatus(vo, finalBilled, byClaims);
        const amount = vo.xeroInvoiceId ? vo.billedAmount : vo.contractSum;
        return (
          <button key={vo.id} type="button" className="qe-btn" onClick={() => onOpen(vo.id)}
            style={{
              display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) 96px 120px auto', gap: space.md, alignItems: 'center',
              width: '100%', padding: `${space.sm}px ${space.lg}px`, border: 'none', borderTop: `1px solid ${color.border}`,
              borderRadius: 0, background: color.surface, textAlign: 'left', cursor: 'pointer', fontFamily: font.stack, color: color.text,
            }}>
            <span style={{ fontSize: font.size.md, fontWeight: 700 }}>VO{vo.voNumber}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: font.size.sm, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vo.title || vo.id}</span>
              <span style={{ display: 'block', fontSize: font.size.xs, color: color.muted }}>{vo.id}</span>
            </span>
            <span style={{ fontSize: font.size.xs, color: color.muted }}>{vo.voReason || ''}</span>
            <span style={{ fontSize: font.size.sm, fontWeight: 600, textAlign: 'right', color: amount < 0 ? color.danger : color.text }}>${signed(amount || 0)}</span>
            <span style={st.style}>{st.label}</span>
          </button>
        );
      })}
      <div style={{ padding: `${space.md}px ${space.lg}px`, borderTop: vos.length ? `1px solid ${color.border}` : 'none' }}>
        <button type="button" className="qe-btn" onClick={onNew} disabled={!canAdd}
          title={canAdd ? '' : 'Save the quote first'}
          style={{ height: 40, padding: '0 14px', borderRadius: radius.sm, border: `1px dashed ${color.subtle}`, background: color.surface, fontWeight: 600, fontSize: font.size.sm, fontFamily: font.stack, cursor: 'pointer', color: color.text }}
        >+ Variation order</button>
      </div>
    </div>
  );
}

/**
 * The VO's own card: its title and reason (saved with it), its status, and "Bill now" for
 * an addition. An omission, or a VO netting to $0, has no button: it settles on the final.
 */
export function VoBillCard({ vo, contractSum, title, reason, onTitle, onReason, dirty, disabled, locked, finalBilled = false, onBill }) {
  const st = vo ? voStatus(vo, finalBilled) : null;
  const addition = contractSum > 0;
  const block = !vo ? 'Save the variation order before billing.'
    : dirty ? 'Save your changes before billing.'
    : '';
  return (
    <div style={{ ...card, padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: font.size.lg, fontWeight: 700 }}>Variation order</h2>
        {st && <span style={st.style}>{st.label}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 160px', gap: space.md }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: font.size.xs, color: color.muted, minWidth: 0 }}>
          Title on the final invoice
          <input value={title} disabled={disabled || locked} placeholder="First line's description if blank"
            onChange={e => onTitle(e.target.value)} style={field} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: font.size.xs, color: color.muted, minWidth: 0 }}>
          Reason
          <select value={reason} disabled={disabled || locked} onChange={e => onReason(e.target.value)} style={select}>
            <option value="">—</option>
            {VO_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            {reason && !VO_REASONS.includes(reason) && <option value={reason}>{reason}</option>}
          </select>
        </label>
      </div>

      <p style={{ margin: 0, fontSize: font.size.xs, color: color.muted }}>
        {addition
          ? 'An addition goes onto the final payment invoice as one "Add:" line, or is billed now on its own with every line, title and discount. Billed early, it stays off the final invoice.'
          : 'Negative lines are an omission. It goes onto the final payment invoice as one "Less:" line; it cannot be invoiced on its own.'}
        {' '}Stage amounts never change.
      </p>

      {!vo?.xeroInvoiceId && addition && (
        <div style={{ display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <button type="button" onClick={onBill} disabled={disabled || !!block} title={block}
            style={{
              height: 40, padding: '0 16px', borderRadius: radius.sm, fontWeight: 600, fontSize: font.size.sm,
              fontFamily: font.stack, cursor: block ? 'default' : 'pointer', border: `1px solid ${color.primary}`,
              background: block ? color.surface : color.primary, color: block ? color.muted : '#fff',
            }}
          >{vo?.status === 'error' || vo?.status === 'sending' ? 'Retry bill' : `Bill now · $${formatAmount(contractSum)}`}</button>
          {block && <span style={{ fontSize: font.size.xs, color: color.accent }}>{block}</span>}
        </div>
      )}
      {!vo?.xeroInvoiceId && !addition && finalBilled && (
        <span style={{ fontSize: font.size.xs, color: color.danger }}>The final invoice is already issued. Adjust this in Xero by hand.</span>
      )}
    </div>
  );
}
