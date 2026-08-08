'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import ProjectRow from '@/app/components/ProjectRow';
import { useProjects } from '@/lib/useProjects';
import { resolveRecents, RECENTS_CHANGED } from '@/lib/recents';
import { getUser } from '@/lib/session';
import { button, card, color, font, input, radius, space } from '@/lib/theme';

export default function HomePage() {
  const { projects, search, loading, error } = useProjects();
  const [query, setQuery] = useState('');
  const [userName, setUserName] = useState('');
  const [recentsTick, setRecentsTick] = useState(0);
  const router = useRouter();

  useEffect(() => { setUserName(getUser()?.name || ''); }, []);

  // Refresh recents when they change elsewhere, and when returning to the tab
  useEffect(() => {
    const bump = () => setRecentsTick(t => t + 1);
    window.addEventListener(RECENTS_CHANGED, bump);
    window.addEventListener('focus', bump);
    return () => {
      window.removeEventListener(RECENTS_CHANGED, bump);
      window.removeEventListener('focus', bump);
    };
  }, []);

  const results = useMemo(
    () => (query.trim() ? search(query).slice(0, 20) : []),
    [search, query]
  );

  // Recents resolve against localStorage, so only compute once userName is known
  const recents = useMemo(
    () => (userName ? resolveRecents(userName, projects) : { items: [], isFallback: false }),
    // recentsTick forces recomputation when localStorage changed without a remount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userName, projects, recentsTick]
  );

  const searching = query.trim().length > 0;

  return (
    <AppShell title="Projects">
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search address, client or code"
        aria-label="Search projects"
        style={{ ...input, marginBottom: space.lg }}
      />

      {error && (
        <div style={{
          background: color.accentLight, color: color.accent,
          padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
          fontSize: font.size.sm, marginBottom: space.lg,
        }}>{error}</div>
      )}

      {searching ? (
        <section style={{ ...card, padding: space.sm }}>
          <SectionLabel>
            {results.length === 0
              ? 'No matches'
              : `${results.length} match${results.length === 1 ? '' : 'es'}`}
          </SectionLabel>
          {results.map(p => (
            <ProjectRow key={p.code} project={p} userName={userName} />
          ))}
          {results.length === 0 && !loading && (
            <p style={{
              padding: `${space.md}px ${space.sm}px`, margin: 0,
              fontSize: font.size.sm, color: color.muted,
            }}>
              Nothing matches “{query.trim()}”. Check the spelling, or add it as a new project.
            </p>
          )}
        </section>
      ) : (
        <section style={{ ...card, padding: space.sm, marginBottom: space.lg }}>
          <SectionLabel>
            {recents.isFallback ? 'Latest projects' : 'Recently opened'}
          </SectionLabel>

          {loading && recents.items.length === 0 && (
            <p style={{ padding: space.md, margin: 0, fontSize: font.size.sm, color: color.muted }}>
              Loading…
            </p>
          )}

          {!loading && recents.items.length === 0 && (
            <p style={{ padding: space.md, margin: 0, fontSize: font.size.sm, color: color.muted }}>
              No projects yet. Add your first one below.
            </p>
          )}

          {recents.items.map(p => (
            <ProjectRow key={p.code} project={p} userName={userName} />
          ))}
        </section>
      )}

      {!searching && (
        <div style={{ display: 'grid', gap: space.md }}>
          <button
            onClick={() => router.push('/projects')}
            style={button.secondary}
          >
            All projects{projects.length ? ` (${projects.length})` : ''}
          </button>
          <button
            onClick={() => router.push('/projects/new')}
            style={button.primary}
          >
            + New project
          </button>
        </div>
      )}
    </AppShell>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: font.size.xs, fontWeight: 600, color: color.subtle,
      textTransform: 'uppercase', letterSpacing: 0.5,
      padding: `${space.sm}px ${space.sm}px ${space.xs}px`,
    }}>{children}</div>
  );
}
