// Design tokens for inline styles, matching the sibling expense-pwa's approach.
// Centralised so the look stays consistent as dashboard sections are added, and so a
// future move to a CSS solution is a single-file change.
//
// Primary is deliberately teal, not the expense app's blue (#1D5C8F) — both apps will be
// installed on the same phone and need to be tellable apart at a glance.

export const color = {
  primary:      '#0F766E',
  primaryDark:  '#115E59',
  primaryLight: '#CCFBF1',

  accent:       '#B45309',   // "not invoiced" / needs attention
  accentLight:  '#FEF3C7',

  danger:       '#B91C1C',
  dangerLight:  '#FEE2E2',

  success:      '#15803D',
  successLight: '#DCFCE7',

  bg:      '#F5F6F7',
  surface: '#FFFFFF',
  border:  '#E3E5E8',

  text:   '#1A1D21',
  muted:  '#6B7280',
  subtle: '#9CA3AF',
};

// Tag palettes. Each is a light ground with a dark foreground of the same hue, so they
// stay legible and read as one family rather than competing with the teal primary.
// Cost types get distinct hues; status tags reuse the semantic colours above.
export const tag = {
  material:    { bg: '#E0F2FE', fg: '#075985', border: '#BAE6FD' },  // sky
  labour:      { bg: '#EDE9FE', fg: '#5B21B6', border: '#DDD6FE' },  // violet
  transport:   { bg: '#FFEDD5', fg: '#9A3412', border: '#FED7AA' },  // orange
  receipted:   { bg: '#F1F5F9', fg: '#334155', border: '#CBD5E1' },  // slate
  invoiced:    { bg: '#DCFCE7', fg: '#15803D', border: '#86EFAC' },
  notInvoiced: { bg: '#FEF3C7', fg: '#B45309', border: '#FDE68A' },
  neutral:     { bg: '#F3F4F6', fg: '#4B5563', border: '#E5E7EB' },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };

export const font = {
  stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  size:  { xs: 12, sm: 13, md: 15, lg: 17, xl: 22, xxl: 28 },
};

export const shadow = {
  card: '0 1px 2px rgba(16,24,40,0.05), 0 1px 3px rgba(16,24,40,0.06)',
  lift: '0 4px 12px rgba(16,24,40,0.10)',
};

export const card = {
  background:   color.surface,
  border:       `1px solid ${color.border}`,
  borderRadius: radius.lg,
  boxShadow:    shadow.card,
};

export const button = {
  primary: {
    background:   color.primary,
    color:        '#fff',
    border:       'none',
    borderRadius: radius.md,
    padding:      '14px 18px',
    fontSize:     font.size.md,
    fontWeight:   600,
    cursor:       'pointer',
    fontFamily:   font.stack,
  },
  secondary: {
    background:   color.surface,
    color:        color.text,
    border:       `1px solid ${color.border}`,
    borderRadius: radius.md,
    padding:      '14px 18px',
    fontSize:     font.size.md,
    fontWeight:   500,
    cursor:       'pointer',
    fontFamily:   font.stack,
  },
};

export const input = {
  width:        '100%',
  minWidth:     0,          // grid/flex items default to min-content; without this they can't shrink
  maxWidth:     '100%',
  padding:      '13px 14px',
  fontSize:     font.size.md,
  border:       `1px solid ${color.border}`,
  borderRadius: radius.md,
  background:   color.surface,
  color:        color.text,
  fontFamily:   font.stack,
  outline:      'none',
  boxSizing:    'border-box',
};

// iOS Safari sizes date inputs to their native control, ignoring width:100% and
// overflowing the card. Dropping the native appearance makes it size like a text field.
export const dateInput = {
  ...input,
  WebkitAppearance: 'none',
  appearance:       'none',
  display:          'block',
  textAlign:        'left',
};
