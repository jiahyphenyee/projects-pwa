'use client';

// Summary · Costs · Billing — the views of one project, as many as the viewer may open.
// Links, not buttons: each view is its own URL, so browser back, bookmarks and a shared
// link all land on the right one. Billing is for those without the Summary, which already
// carries both of its panels; with only one view to offer, nothing is drawn.
//
// Drawn in FilterChip's selected-option idiom (bordered, squarer than a Tag), the app's
// existing vocabulary for "pick one of these" — never a Tag, which is a fact, not a control.

import Link from 'next/link';
import { useViewer } from '@/lib/useViewer';
import { PERMISSIONS } from '@/lib/roles.mjs';
import { color, font, radius, space } from '@/lib/theme';

/** The views `can` opens, in switch order. */
function projectViews(code, can) {
  const base = `/projects/${encodeURIComponent(code)}`;
  const summary = can(PERMISSIONS.SUMMARY);
  return [
    summary && { key: 'summary', label: 'Summary', href: base },
    { key: 'costs', label: 'Costs', href: `${base}/costs` },
    !summary && (can(PERMISSIONS.QUOTES) || can(PERMISSIONS.INVOICES))
      && { key: 'billing', label: 'Billing', href: `${base}/billing` },
  ].filter(Boolean);
}

export default function ViewSwitch({ code, current, style }) {
  const { can, ready } = useViewer();
  const views = projectViews(code, can);
  if (!ready || views.length < 2) return null;
  return (
    <nav aria-label="Project view" style={{ display: 'flex', gap: 6, ...style }}>
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
