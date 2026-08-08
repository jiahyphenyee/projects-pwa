'use client';

// Phase 1: the gate works and the shell renders. Recent projects, search and
// "New project" land in Phase 2.

import AppShell from '@/app/components/AppShell';
import { card, color, font, space } from '@/lib/theme';

export default function HomePage() {
  return (
    <AppShell title="Projects">
      <div style={{ ...card, padding: space.xl, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: font.size.md, fontWeight: 500 }}>
          Signed in
        </p>
        <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.sm, color: color.muted }}>
          Recent projects, search and cost tracking arrive in the next phase.
        </p>
      </div>
    </AppShell>
  );
}
