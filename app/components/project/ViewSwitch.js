'use client';

// Summary · Costs — the two views of one project. Links, not buttons: each view is its
// own URL, so browser back, bookmarks and a shared link all land on the right one.
//
// Drawn in FilterChip's selected-option idiom (bordered, squarer than a Tag), the app's
// existing vocabulary for "pick one of these" — never a Tag, which is a fact, not a control.

import Link from 'next/link';
import { color, font, radius, space } from '@/lib/theme';

export default function ViewSwitch({ code, current }) {
  const base = `/projects/${encodeURIComponent(code)}`;
  const views = [
    { key: 'summary', label: 'Summary', href: base },
    { key: 'costs',   label: 'Costs',   href: `${base}/costs` },
  ];
  return (
    <nav aria-label="Project view" style={{ display: 'flex', gap: 6 }}>
      {views.map(v => {
        const on = v.key === current;
        return (
          <Link
            key={v.key}
            href={v.href}
            aria-current={on ? 'page' : undefined}
            className="filter-chip"
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: 44,
              padding: `0 ${space.lg}px`, borderRadius: radius.md,
              border: `1.5px solid ${on ? color.primary : color.border}`,
              background: on ? color.primaryLight : color.surface,
              color: on ? color.primaryDark : color.text,
              fontSize: font.size.sm, fontWeight: on ? 600 : 400,
              textDecoration: 'none', whiteSpace: 'nowrap',
              WebkitTapHighlightColor: 'transparent',
            }}
          >{v.label}</Link>
        );
      })}
    </nav>
  );
}
