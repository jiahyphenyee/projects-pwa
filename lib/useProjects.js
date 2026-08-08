'use client';

// Stale-while-revalidate project list. Renders instantly from the last cached copy,
// then refreshes in the background. The cache is also what makes offline reads work
// in a later phase.

import { useCallback, useEffect, useState } from 'react';

const CACHE_KEY = 'projects_pwa_projects_cache';
const TTL_MS    = 5 * 60 * 1000;

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!cached?.projects?.length) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCache(projects) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ projects, cachedAt: Date.now() }));
  } catch {
    // quota — the app still works, just without instant loads
  }
}

export function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [cachedAt, setCachedAt] = useState(null);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res  = await fetch('/api/projects');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load projects');
      setProjects(data.projects);
      setCachedAt(Date.now());
      setError('');
      writeCache(data.projects);
    } catch (err) {
      // Keep showing cached data if we have it — a failed refresh shouldn't blank the screen
      setError(err.message === 'Failed to fetch' ? 'Offline — showing saved data' : err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // localStorage is unavailable during prerender, so the cache is read here, not in
    // a useState initialiser
    const cached = readCache();
    if (cached) {
      setProjects(cached.projects);
      setCachedAt(cached.cachedAt);
      setLoading(false);
      // Only hit the network if the cache has gone stale
      if (Date.now() - cached.cachedAt > TTL_MS) load({ silent: true });
      return;
    }
    load();
  }, [load]);

  return { projects, loading, error, cachedAt, refresh: () => load({ silent: true }) };
}

/** Case-insensitive match across the fields someone would actually search by. */
export function searchProjects(projects, query) {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  return projects.filter(p =>
    (p.address     || '').toLowerCase().includes(q) ||
    (p.projectName || '').toLowerCase().includes(q) ||
    (p.clientName  || '').toLowerCase().includes(q) ||
    (p.code        || '').toLowerCase().includes(q)
  );
}
