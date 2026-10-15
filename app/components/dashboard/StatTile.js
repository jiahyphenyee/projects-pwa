'use client';

// One headline figure: what it is, the number, and a line of context. The number leads;
// the label and note are the two smaller sizes, as on every other card.

import { card, color, font, space } from '@/lib/theme';

export default function StatTile({ label, value, note, muted = false }) {
  return (
    <div style={{ ...card, padding: `${space.md}px ${space.lg}px`, minWidth: 0 }}>
      <div style={{ fontSize: font.size.xs, color: color.muted }}>{label}</div>
      <div style={{
        fontSize: font.size.xl, fontWeight: 600, lineHeight: 1.2, marginTop: 2,
        color: muted ? color.subtle : color.text, fontVariantNumeric: 'tabular-nums',
        overflowWrap: 'anywhere',
      }}>{value}</div>
      {note && (
        <div style={{ fontSize: font.size.xs, color: color.subtle, marginTop: 2, lineHeight: 1.4 }}>{note}</div>
      )}
    </div>
  );
}
