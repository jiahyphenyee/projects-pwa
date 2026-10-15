'use client';

// The dashboard's one container: a card with a title, an optional one-line subtitle and
// an optional action on the right. Every block on a dashboard screen is a Panel, so they
// line up and read as one page. It is the same `card` as the workflow screens use: a
// dashboard is laid out differently, not styled differently.
//
// A Panel's action only ever leaves the dashboard — to the screen where the change is
// made. Dashboards never edit in place.

import Link from 'next/link';
import { card, color, font, radius, space } from '@/lib/theme';

export default function Panel({ title, subtitle, action, children }) {
  return (
    <section style={{ ...card, padding: space.lg, minWidth: 0 }}>
      {(title || action) && (
        <header style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `${space.xs}px ${space.md}px`,
          marginBottom: space.sm,
        }}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <h2 style={{ margin: 0, fontSize: font.size.md, fontWeight: 600, color: color.text }}>{title}</h2>
            {subtitle && (
              <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: 2, lineHeight: 1.45 }}>{subtitle}</div>
            )}
          </div>
          {action && <PanelLink {...action} />}
        </header>
      )}
      {children}
    </section>
  );
}

/** "All costs →": a plain link with a full 44px tap target. */
export function PanelLink({ href, label }) {
  return (
    <Link href={href} className="ghost-button" style={{
      display: 'inline-flex', alignItems: 'center', minHeight: 44, flexShrink: 0,
      padding: `0 ${space.sm}px`, margin: `0 -${space.sm}px`, borderRadius: radius.sm,
      fontSize: font.size.sm, fontWeight: 600, color: color.primary, textDecoration: 'none',
    }}>{label} →</Link>
  );
}
