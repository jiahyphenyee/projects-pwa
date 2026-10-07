'use client';

// The quote line table. Desktop-first grid; on a phone it scrolls sideways inside its own
// container so the page never does. All row rules live in lib/quoteEditor.mjs; this file
// only renders rows and turns clicks into those operations.

import { useEffect, useRef } from 'react';
import {
  insertItem, insertTitle, duplicateRow, moveRow, removeRow, updateRow, lineNumbers, acceptDecimal, formatPrice,
} from '@/lib/quoteEditor.mjs';
import { lineAmount, sectionSubtotals } from '@/lib/quoteMaths.mjs';
import { formatAmount } from '@/app/components/TotalsCard';
import { color, font, radius, space } from '@/lib/theme';

const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%236B7280' stroke-width='1.75' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

const field = {
  width: '100%', minWidth: 0, height: 38, padding: '0 10px',
  fontSize: font.size.sm, fontFamily: font.stack, color: color.text,
  border: `1px solid ${color.border}`, borderRadius: radius.sm,
  background: color.surface, boxSizing: 'border-box', outline: 'none',
};
const select = {
  ...field, appearance: 'none', WebkitAppearance: 'none',
  backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center', paddingRight: 28,
};
const textButton = {
  height: 34, padding: '0 9px', border: `1px solid ${color.border}`, borderRadius: radius.sm,
  background: color.surface, color: color.text, fontSize: font.size.xs, fontWeight: 600,
  fontFamily: font.stack, cursor: 'pointer', whiteSpace: 'nowrap',
};
const iconButton = {
  ...textButton, width: 34, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const headCell = {
  fontSize: font.size.xs, fontWeight: 600, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: color.muted,
};

/** Grid template. The unit column exists only while "Show unit" is ticked. */
function columns(showUnit) {
  return ['32px', 'minmax(260px, 1fr)', '160px', '76px', ...(showUnit ? ['104px'] : []), '104px', '104px', '312px'].join(' ');
}

function Icon({ d, danger }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={danger ? color.danger : color.text}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map(p => <path key={p} d={p} />)}
    </svg>
  );
}
const UP = ['M12 19V5', 'M6 11l6-6 6 6'];
const DOWN = ['M12 5v14', 'M6 13l6 6 6-6'];
const BIN = ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'];
const COPY = ['M9 9h11v11H9z', 'M5 15V5a1 1 0 0 1 1-1h10'];

export default function LineEditor({ rows, onChange, showUnit, categories, units, defaultService, disabled }) {
  const inputs = useRef(new Map());
  const pendingFocus = useRef(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = inputs.current.get(pendingFocus.current);
    pendingFocus.current = null;
    if (el) el.focus();
  });

  function apply({ rows: next, key }) {
    if (key) pendingFocus.current = key;
    onChange(next);
  }

  const numbers = lineNumbers(rows);
  const sections = sectionSubtotals(rows.map(r => ({
    id: r.key, kind: r.kind, qty: qtyOf(r), unitPrice: priceOf(r),
  })));
  const template = columns(showUnit);
  const amountColumn = showUnit ? 7 : 6;   // 1-based; titles span description → unit price
  const activeCategories = categories.filter(c => c.active);

  return (
    <div style={{
      background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg,
      overflowX: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ minWidth: showUnit ? 1240 : 1130 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: template, gap: space.sm, alignItems: 'center',
          padding: `${space.sm}px ${space.md}px`, background: '#EEF1F3',
          borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
        }}>
          <div style={headCell}>No.</div>
          <div style={headCell}>Description</div>
          <div style={headCell}>Service</div>
          <div style={headCell}>Qty</div>
          {showUnit && <div style={headCell}>Unit</div>}
          <div style={headCell}>Unit price</div>
          <div style={{ ...headCell, textAlign: 'right' }}>Amount</div>
          <div style={headCell}>Row actions</div>
        </div>

        {rows.map((row, i) => {
          const isTitle = row.kind === 'title';
          const ref = el => { if (el) inputs.current.set(row.key, el); else inputs.current.delete(row.key); };
          const set = change => onChange(updateRow(rows, row.key, change));
          const onKeyDown = e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              apply(insertItem(rows, i + 1, defaultService));
            }
          };
          const common = (
            <>
              <button type="button" className="qe-btn" style={textButton} disabled={disabled}
                onClick={() => apply(insertItem(rows, i, defaultService))}>+ Above</button>
              <button type="button" className="qe-btn" style={textButton} disabled={disabled}
                onClick={() => apply(insertItem(rows, i + 1, defaultService))}>+ Below</button>
            </>
          );
          const tail = (
            <>
              <button type="button" className="qe-btn" style={iconButton} disabled={disabled || i === 0}
                aria-label={isTitle ? 'Move title up' : 'Move line up'} title="Move up"
                onClick={() => onChange(moveRow(rows, i, -1))}><Icon d={UP} /></button>
              <button type="button" className="qe-btn" style={iconButton} disabled={disabled || i === rows.length - 1}
                aria-label={isTitle ? 'Move title down' : 'Move line down'} title="Move down"
                onClick={() => onChange(moveRow(rows, i, 1))}><Icon d={DOWN} /></button>
              <button type="button" className="qe-btn" style={iconButton} disabled={disabled || rows.length <= 1}
                aria-label={isTitle ? 'Delete title' : 'Delete line'}
                title={isTitle ? 'Delete title (the lines under it stay)' : 'Delete line'}
                onClick={() => onChange(removeRow(rows, i))}><Icon d={BIN} danger /></button>
            </>
          );

          return (
            <div key={row.key} style={{
              display: 'grid', gridTemplateColumns: template, gap: space.sm, alignItems: 'center',
              padding: `${space.sm}px ${space.md}px`, borderTop: `1px solid ${color.border}`,
              background: isTitle ? '#F3F5F6' : color.surface,
            }}>
              {isTitle ? (
                <>
                  <div />
                  <input
                    ref={ref} value={row.description} disabled={disabled}
                    aria-label="Section title" placeholder="Section title, e.g. LIVING ROOM"
                    onChange={e => set({ description: e.target.value })} onKeyDown={onKeyDown}
                    style={{
                      ...field, gridColumn: `2 / ${amountColumn}`, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.04em', borderColor: color.subtle,
                    }}
                  />
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: color.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Subtotal</div>
                    <div style={{ fontSize: font.size.sm, fontWeight: 700 }}>{formatAmount(sections.get(row.key) || 0)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: space.xs }}>{common}{tail}</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: font.size.sm, fontWeight: 600, color: color.muted }}>{numbers.get(row.key)}</div>
                  <input
                    ref={ref} value={row.description} disabled={disabled}
                    aria-label={`Description, line ${numbers.get(row.key)}`}
                    placeholder="Description"
                    onChange={e => set({ description: e.target.value })} onKeyDown={onKeyDown}
                    style={field}
                  />
                  <select
                    value={row.service} disabled={disabled} aria-label="Service"
                    onChange={e => set({ service: e.target.value })} style={select}
                  >
                    <option value="">No service</option>
                    {activeCategories.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                    {row.service && !activeCategories.some(c => c.code === row.service) && (
                      <option value={row.service}>
                        {categories.find(c => c.code === row.service)?.name || row.service} (inactive)
                      </option>
                    )}
                  </select>
                  <input
                    value={row.qty} disabled={disabled} inputMode="decimal" aria-label="Quantity"
                    onChange={e => set({ qty: acceptDecimal(e.target.value, row.qty) })}
                    style={{ ...field, textAlign: 'right' }}
                  />
                  {showUnit && (
                    <select
                      value={row.unit} disabled={disabled} aria-label="Unit"
                      onChange={e => set({ unit: e.target.value })} style={select}
                    >
                      <option value="">no unit</option>
                      {units.map(u => <option key={u} value={u}>{u}</option>)}
                      {row.unit && !units.includes(row.unit) && <option value={row.unit}>{row.unit}</option>}
                    </select>
                  )}
                  <input
                    value={row.unitPrice} disabled={disabled} inputMode="decimal" aria-label="Unit price"
                    placeholder="0.00"
                    onChange={e => set({ unitPrice: acceptDecimal(e.target.value, row.unitPrice) })}
                    onBlur={() => { const f = formatPrice(row.unitPrice); if (f !== row.unitPrice) set({ unitPrice: f }); }}
                    style={{ ...field, textAlign: 'right' }}
                  />
                  <div style={{ textAlign: 'right', fontSize: font.size.sm, fontWeight: 600 }}>
                    {formatAmount(lineAmount(qtyOf(row), priceOf(row)))}
                  </div>
                  <div style={{ display: 'flex', gap: space.xs }}>
                    {common}
                    <button type="button" className="qe-btn" style={{ ...textButton, background: '#F3F5F6' }}
                      disabled={disabled} title="Add a section title above this line"
                      onClick={() => apply(insertTitle(rows, i))}>+ Title</button>
                    <button type="button" className="qe-btn" style={iconButton} disabled={disabled}
                      aria-label="Duplicate line" title="Duplicate line"
                      onClick={() => apply(duplicateRow(rows, i))}><Icon d={COPY} /></button>
                    {tail}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: space.md, alignItems: 'center',
          padding: `${space.md}px`, borderTop: `1px solid ${color.border}`,
        }}>
          <button type="button" className="qe-btn" disabled={disabled}
            style={{ ...textButton, height: 40, padding: '0 14px', borderStyle: 'dashed', borderColor: color.subtle }}
            onClick={() => apply(insertItem(rows, rows.length, defaultService))}>+ Add line at the end</button>
          <button type="button" className="qe-btn" disabled={disabled}
            style={{ ...textButton, height: 40, padding: '0 14px', borderStyle: 'dashed', borderColor: color.subtle, background: '#F3F5F6' }}
            onClick={() => apply(insertTitle(rows, rows.length))}>+ Add title at the end</button>
          <span style={{ fontSize: font.size.xs, color: color.muted }}>
            Press Enter in a description to add a line directly below it.
          </span>
        </div>
      </div>
    </div>
  );
}

/** Blank quantity counts as 1, as it is saved; blank price as 0. */
export function qtyOf(row) {
  return String(row.qty).trim() === '' ? 1 : Number(row.qty);
}
export function priceOf(row) {
  return String(row.unitPrice).trim() === '' ? 0 : Number(row.unitPrice);
}
