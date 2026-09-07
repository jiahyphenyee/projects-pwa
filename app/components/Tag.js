'use client';

import { font, radius, tag as palette } from '@/lib/theme';

/**
 * Small status pill. `variant` picks a palette from lib/theme.
 *
 * Colour alone never carries the meaning — every tag also states it in words, so the
 * row still reads correctly in greyscale or to anyone who can't separate the hues.
 *
 * Tags never wrap, so only fixed vocabulary belongs in one — a category code, a status.
 * Anything of unbounded length (a payee, an address) goes in a row's `meta` text, which
 * wraps; as a tag it would push the row sideways on a phone.
 */
export default function Tag({ variant = 'neutral', children, onClick, disabled, ariaLabel, pressed }) {
  const colors = palette[variant] || palette.neutral;

  const style = {
    display:      'inline-flex',
    alignItems:   'center',
    gap:          4,
    padding:      '3px 9px',
    borderRadius: radius.pill,
    fontSize:     11,
    fontWeight:   600,
    lineHeight:   1.5,
    whiteSpace:   'nowrap',
    fontFamily:   font.stack,
    background:   colors.bg,
    color:        colors.fg,

    // An outline means "pressable" — the same rule FilterChip follows. A static tag is a
    // fact about its row, not a control, so it wears none. Kept transparent rather than
    // removed so both kinds measure identically and never sit a pixel apart in a row.
    border:       `1px solid ${onClick ? colors.border : 'transparent'}`,
  };

  if (!onClick) return <span style={style}>{children}</span>;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      style={{ ...style, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >{children}</button>
  );
}
