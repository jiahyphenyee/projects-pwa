'use client';

import { color, font, radius, space } from '@/lib/theme';

/**
 * A toggleable filter control.
 *
 * Deliberately NOT a `Tag`. Tags and filters sit inches apart on the project screen and
 * mean opposite things — a tag is a fact about the row it sits on, a chip is a control
 * that changes what you can see. When they looked alike, the category tag on a row read as
 * something you could press. So this is squarer, larger and bordered: the same
 * selected-option idiom as the cost type buttons in `CostForm`, which is already the app's
 * vocabulary for "pick this one".
 *
 * Colour never carries the state alone — the border weight and the label's own weight
 * change with it, so the selection survives greyscale.
 */
export default function FilterChip({ children, selected, onClick, ariaLabel }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className="filter-chip"
      style={{
        // 34px, not the 44px of a primary tap target: these sit in a wrapping row of a
        // dozen, and a full-height control each would push the list itself off the screen.
        minHeight:    34,
        padding:      `6px ${space.md}px`,
        borderRadius: radius.md,
        border:       `1.5px solid ${selected ? color.primary : color.border}`,
        background:   selected ? color.primaryLight : color.surface,
        color:        selected ? color.primaryDark : color.text,
        fontSize:     font.size.sm,
        fontWeight:   selected ? 600 : 400,
        fontFamily:   font.stack,
        lineHeight:   1.4,
        whiteSpace:   'nowrap',
        cursor:       'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >{children}</button>
  );
}

/** A labelled row of chips. The label is what stops "All" reading as a category. */
export function FilterGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: space.sm, alignItems: 'baseline', marginBottom: space.sm }}>
      <span style={{
        fontSize: font.size.xs, color: color.muted,
        // Wide enough for the longest label, so both rows of chips start on one line
        flexShrink: 0, width: 58, paddingTop: 8,
      }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
