'use client';

// Full project list. Pages the already-cached array client-side rather than issuing
// more requests — the whole list is one small Sheets read. Revisit only if this grows
// into the low thousands.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import ProjectRow from '@/app/components/ProjectRow';
import { useProjects, searchProjects } from '@/lib/useProjects';
import { getUser } from '@/lib/session';
import { button, card, color, font, input, radius, space } from '@/lib/theme';

const PAGE_SIZE = 50;

export default function AllProjectsPage() {
  const { projects, loading, error } = useProjects();
  const [query, setQuery] = useState('');
  const [page, setPage]   = useState(1);
  const [userName, setUserName] = useState('');
  const router = useRouter();

  useEffect(() => { setUserName(getUser()?.name || ''); }, []);

  // Newest first — sheet order is creation order
  const filtered = useMemo(() => {
    const matched = searchProjects(projects, query);
    return [...matched].reverse();
  }, [projects, query]);

  useEffect(() => { setPage(1); }, [query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageItems  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <AppShell
      title="All projects"
      subtitle={loading ? 'Loading…' : `${filtered.length} project${filtered.length === 1 ? '' : 's'}`}
      onBack={() => router.push('/home')}
    >
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

      <section style={{ ...card, padding: space.sm }}>
        {pageItems.map(p => (
          <ProjectRow key={p.code} project={p} userName={userName} />
        ))}

        {!loading && pageItems.length === 0 && (
          <p style={{ padding: space.md, margin: 0, fontSize: font.size.sm, color: color.muted }}>
            {query.trim() ? `Nothing matches “${query.trim()}”.` : 'No projects yet.'}
          </p>
        )}
      </section>

      {totalPages > 1 && (
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: space.md, marginTop: space.lg,
        }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage === 1}
            style={{ ...button.secondary, opacity: safePage === 1 ? 0.4 : 1, flex: 1 }}
          >Previous</button>

          <span style={{ fontSize: font.size.sm, color: color.muted, flexShrink: 0 }}>
            {safePage} / {totalPages}
          </span>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            style={{ ...button.secondary, opacity: safePage === totalPages ? 0.4 : 1, flex: 1 }}
          >Next</button>
        </nav>
      )}
    </AppShell>
  );
}
