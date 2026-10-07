'use client';

// Subtotal, optional discount, contract sum and "No GST". Every figure comes from
// lib/quoteMaths.mjs, the same functions the server uses when it saves.

import { acceptDecimal } from '@/lib/quoteEditor.mjs';
import { formatAmount } from '@/app/components/TotalsCard';
import { card, color, font, radius, space } from '@/lib/theme';

const small = {
  height: 38, padding: '0 10px', fontSize: font.size.sm, fontFamily: font.stack,
  border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.surface,
  color: color.text, boxSizing: 'border-box', outline: 'none',
};

export default function TotalsPanel({ totals, discount, onDiscount, disabled }) {
  return (
    <div style={{ ...card, padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.md }}>
      <Row label="Subtotal" value={formatAmount(totals.subtotal)} />

      {!discount.on ? (
        <button
          type="button" className="qe-btn" disabled={disabled}
          onClick={() => onDiscount({ ...discount, on: true })}
          style={{
            alignSelf: 'flex-start', height: 40, padding: '0 14px', borderRadius: radius.sm,
            border: `1px dashed ${color.subtle}`, background: color.surface, fontWeight: 600,
            fontSize: font.size.sm, fontFamily: font.stack, cursor: 'pointer', color: color.text,
          }}
        >+ Add discount</button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 70px', fontSize: font.size.sm, color: color.muted }}>Discount</span>
          <div role="group" aria-label="Discount type" style={{ display: 'flex' }}>
            {['$', '%'].map((m, i) => (
              <button
                key={m} type="button" aria-pressed={discount.mode === m} disabled={disabled}
                onClick={() => onDiscount({ ...discount, mode: m })}
                style={{
                  ...small, width: 38, padding: 0, cursor: 'pointer', fontWeight: 600,
                  borderRadius: i === 0 ? `${radius.sm}px 0 0 ${radius.sm}px` : `0 ${radius.sm}px ${radius.sm}px 0`,
                  marginLeft: i === 0 ? 0 : -1,
                  background: discount.mode === m ? color.primary : color.surface,
                  color: discount.mode === m ? '#fff' : color.text,
                  borderColor: discount.mode === m ? color.primary : color.border,
                }}
              >{m}</button>
            ))}
          </div>
          <input
            value={discount.value} inputMode="decimal" placeholder="0" aria-label="Discount amount"
            disabled={disabled}
            onChange={e => onDiscount({ ...discount, value: acceptDecimal(e.target.value, discount.value) })}
            style={{ ...small, width: 84, textAlign: 'right' }}
          />
          <span style={{ minWidth: 84, textAlign: 'right', fontSize: font.size.sm, fontWeight: 600 }}>
            −{formatAmount(totals.discount)}
          </span>
          <button
            type="button" aria-label="Remove discount" title="Remove discount" disabled={disabled}
            onClick={() => onDiscount({ on: false, mode: discount.mode, value: '' })}
            style={{ ...small, width: 38, padding: 0, cursor: 'pointer', color: color.danger, fontSize: 18, lineHeight: 1 }}
          >×</button>
        </div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: space.lg,
        paddingTop: space.md, borderTop: `1px solid ${color.border}`,
      }}>
        <div>
          <div style={{ fontSize: font.size.md, fontWeight: 600 }}>Contract sum (SGD)</div>
          <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: 2 }}>No GST</div>
        </div>
        <div style={{ fontSize: font.size.xxl, fontWeight: 700 }}>{formatAmount(totals.contractSum)}</div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: space.lg }}>
      <span style={{ fontSize: font.size.sm, color: color.muted }}>{label}</span>
      <span style={{ fontSize: font.size.md, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
