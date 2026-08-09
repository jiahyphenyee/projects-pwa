'use client';

import { color, font, space } from '@/lib/theme';

/**
 * One line item — used by both project costs and receipted expenses.
 *
 * Shared deliberately: the two lists sit on the same screen and previously drifted
 * apart (different amount sizes, different padding) because they were written as
 * separate markup. Any typography change belongs here, once.
 *
 *   label                                    amount
 *   [tag] [tag] meta                        [action]
 */
export default function LineRow({ label, amount, tags, meta, action, first, dimmed, onLabelClick }) {
  // The label and amount become one tap target for editing when a handler is given.
  // The row's own action (e.g. the invoiced switch) stays outside it, so ticking a
  // line never opens the editor by accident.
  const headingStyle = {
    display: 'flex', gap: space.md, alignItems: 'baseline',
    width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', padding: 0,
    fontFamily: 'inherit', color: 'inherit',
    cursor: onLabelClick ? 'pointer' : 'default',
    WebkitTapHighlightColor: 'transparent',
  };

  const heading = (
    <>
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: font.size.sm, fontWeight: 500, lineHeight: 1.4,
      }}>{label}</span>
      <span style={{
        fontSize: font.size.sm, fontWeight: 600, lineHeight: 1.4,
        fontVariantNumeric: 'tabular-nums', flexShrink: 0,
      }}>{amount}</span>
    </>
  );

  return (
    <div style={{
      padding: `${space.sm}px 0`,
      borderTop: first ? 'none' : `1px solid ${color.border}`,
      opacity: dimmed ? 0.5 : 1,
    }}>
      {onLabelClick
        ? <button onClick={onLabelClick} style={headingStyle} aria-label={`Edit ${label}`}>{heading}</button>
        : <div style={headingStyle}>{heading}</div>}

      <div style={{
        display: 'flex', gap: space.sm, marginTop: space.xs,
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          display: 'flex', gap: 5, alignItems: 'center',
          flexWrap: 'wrap', minWidth: 0,
        }}>
          {tags}
          {meta && (
            <span style={{ fontSize: font.size.xs, color: color.subtle, lineHeight: 1.4 }}>
              {meta}
            </span>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}
