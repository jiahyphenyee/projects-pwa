'use client';

import { color, font, space } from '@/lib/theme';

/**
 * One line item — used by both project costs and receipted expenses.
 *
 * Shared deliberately: the two lists sit on the same screen and previously drifted
 * apart (different amount sizes, different padding) because they were written as
 * separate markup. Any typography change belongs here, once.
 *
 *   label                     │        │
 *   [tag] [tag] meta          │ amount │ [action]
 *
 * Three columns, all vertically centred against each other. The action sits BESIDE the
 * text rather than under it — it carries a 44px tap target, and stacked below the meta
 * line that made the row's secondary line taller than its primary one.
 *
 * The amount is its own column for the same reason: pinned to the label's baseline it
 * rode high against a two-line block, out of line with the control opposite it. Centred,
 * the two things you scan for — the figure and its tick — sit level.
 *
 * Amounts take their natural width and the action column is fixed, so every amount's
 * RIGHT edge lands in the same place: a column of figures you can read down.
 */
export default function LineRow({ label, amount, tags, meta, action, first, dimmed, onLabelClick, labelVerb = 'Edit', clampLines = 0 }) {
  // The label and amount become one tap target for editing when a handler is given.
  // The row's own action (e.g. the invoiced switch) stays outside it, so ticking a
  // line never opens the editor by accident.
  const headingStyle = {
    display: 'block', width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', padding: 0,
    fontFamily: 'inherit', color: 'inherit',
    cursor: onLabelClick ? 'pointer' : 'default',
    WebkitTapHighlightColor: 'transparent',
  };

  // The two lines must be visibly different sizes, not one pixel apart. At 13px over 12px
  // nothing led, and the tinted category pill on the lower line out-weighed the label
  // above it — the row read bottom-first. 15/600 over 12/400 is what makes the label the
  // thing you see, and everything else supporting detail.
  const heading = (
    <span className="row-label-text" style={{
      display: 'block', minWidth: 0,
      fontSize: font.size.md, fontWeight: 600, lineHeight: 1.35,
      color: color.text,
      // Long text (a receipt typed out in full) is cut to a few lines; the detail shows it whole
      ...(clampLines ? { display: '-webkit-box', WebkitLineClamp: clampLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
    }}>{label}</span>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: space.sm,
      // Generous, deliberately: at 8px the rows ran together into one block of text and
      // the separator was doing all the work of telling them apart.
      padding: `${space.md}px 0`,
      borderTop: first ? 'none' : `1px solid ${color.border}`,
      opacity: dimmed ? 0.5 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {onLabelClick
          ? (
            <button
              onClick={onLabelClick}
              className="row-label"
              style={headingStyle}
              aria-label={`${labelVerb} ${label}`}
            >{heading}</button>
          )
          : <div style={headingStyle}>{heading}</div>}

        <div style={{
          display: 'flex', gap: 5, alignItems: 'center',
          flexWrap: 'wrap', minWidth: 0, marginTop: space.xs,
        }}>
          {tags}
          {meta && (
            <span style={{ fontSize: font.size.xs, color: color.subtle, lineHeight: 1.4 }}>
              {meta}
            </span>
          )}
        </div>
      </div>

      {amount !== undefined && amount !== null && (
        <span style={{
          fontSize: font.size.md, fontWeight: 600, lineHeight: 1.35,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
          color: color.text,
        }}>{amount}</span>
      )}

      {action}
    </div>
  );
}
