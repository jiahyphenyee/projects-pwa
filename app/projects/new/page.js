'use client';

// Placeholder so the home screen's "New project" button isn't a dead link during
// Phase 2 testing. Replaced by the real form in Phase 3.

import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import { card, color, font, space } from '@/lib/theme';

export default function NewProjectPage() {
  const router = useRouter();

  return (
    <AppShell title="New project" onBack={() => router.back()}>
      <div style={{ ...card, padding: space.xl, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: font.size.md, fontWeight: 500 }}>Coming next</p>
        <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.sm, color: color.muted }}>
          Project creation is the next phase.
        </p>
      </div>
    </AppShell>
  );
}
