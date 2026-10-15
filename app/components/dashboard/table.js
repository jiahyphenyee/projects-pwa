// Shared styles for dashboard tables. A table is only for figures read across AND down —
// a list of things is LineRows. It always sits in its own scroll box, so a phone scrolls
// the table, never the page.

import { color, font, space } from '@/lib/theme';

export const scrollBox = { overflowX: 'auto', WebkitOverflowScrolling: 'touch', minWidth: 0 };

export const table = { width: '100%', borderCollapse: 'collapse', fontFamily: font.stack };

const cell = {
  padding: `${space.sm}px ${space.md}px`, textAlign: 'right', whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums', fontSize: font.size.sm,
};

/** The same weight and colour as the cost list's column headings. */
export const th = { ...cell, fontSize: font.size.xs, fontWeight: 600, color: color.subtle };
export const td = cell;
export const firstCol = { textAlign: 'left', paddingLeft: 0 };
export const lastCol  = { paddingRight: 0 };
export const rowRule  = { borderTop: `1px solid ${color.border}` };
export const totalRule = { borderTop: `2px solid ${color.text}`, fontWeight: 600 };
