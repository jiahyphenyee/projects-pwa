'use client';

// Variation orders on the quote screen (the list, with "+ Variation order") and on a VO's
// own screen (the card that bills it). A VO is extra work billed in full as its own invoice
// and kept out of the stage amounts.

import { formatAmount } from '@/app/components/TotalsCard';
import { card, color, font, radius, space } from '@/lib/theme';

const badge = (bg, fg) => ({
  display: 'inline-block', padding: '4px 9px', borderRadius: radius.sm, fontSize: font.size.xs,
  fontWeight: 600, background: bg, color: fg, whiteSpace: 'nowrap',
});

export function voStatus(vo) {
  if (vo.xeroInvoiceId) return { label: `Billed · ${vo.xeroInvoiceNumber}`, style: badge(color.successLight, color.success) };
  if (vo.status === 'error') return { label: 'Billing failed — retry', style: badge(color.dangerLight, color.danger) };
  if (vo.status === 'sending') return { label: 'Billing unfinished — retry', style: badge(color.accentLight, color.accent) };
  return { label: 'Not billed', style: badge('#EEF1F3', color.muted) };
}

export function VariationOrderList({ vos, onOpen, onNew, canAdd }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: `${space.md}px ${space.lg}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm }}>
        <h2 style={{ margin: 0, fontSize: font.size.lg, fontWeight: 700 }}>Variation orders</h2>
        <span style={{ fontSize: font.size.xs, color: color.muted }}>Extra work, each billed in full on its own. Not part of the stages.</span>
      </div>
      {vos.map(vo => {
        const st = voStatus(vo);
        return (
          <button key={vo.id} type="button" className="qe-btn" onClick={() => onOpen(vo.id)}
            style={{
              display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) 120px auto', gap: space.md, alignItems: 'center',
              width: '100%', padding: `${space.sm}px ${space.lg}px`, border: 'none', borderTop: `1px solid ${color.border}`,
              borderRadius: 0, background: color.surface, textAlign: 'left', cursor: 'pointer', fontFamily: font.stack, color: color.text,
            }}>
            <span style={{ fontSize: font.size.md, fontWeight: 700 }}>VO{vo.voNumber}</span>
            <span style={{ fontSize: font.size.xs, color: color.muted }}>{vo.id}</span>
            <span style={{ fontSize: font.size.sm, fontWeight: 600, textAlign: 'right' }}>${formatAmount(vo.xeroInvoiceId ? vo.billedAmount : vo.contractSum)}</span>
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

export function VoBillCard({ vo, contractSum, dirty, disabled, onBill }) {
  const st = vo ? voStatus(vo) : null;
  const block = !vo ? 'Save the variation order before billing.'
    : dirty ? 'Save your changes before billing.'
    : !(contractSum > 0) ? 'Add priced lines first.'
    : '';
  return (
    <div style={{ ...card, padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: font.size.lg, fontWeight: 700 }}>Billing</h2>
        {st && <span style={st.style}>{st.label}</span>}
      </div>
      <p style={{ margin: 0, fontSize: font.size.xs, color: color.muted }}>
        A variation order is billed in full as one approved invoice, with every line, title and the discount, and does not change the payment stages.
      </p>
      {!vo?.xeroInvoiceId && (
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
    </div>
  );
}
