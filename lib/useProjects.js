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

/**
 * Strip everything that isn't a letter or digit, so punctuation and spacing in an
 * address don't have to be typed exactly. Addresses are written inconsistently
 * (#09-90, #09 - 90, Blk/Block), and nobody wants to type the hyphen.
 *   "0990"   matches  "…Yishun Central 1 #09-90"
 *   "09 90"  matches  the same
 *   "prj001" matches  "PRJ-001"  (codes are zero-padded, so "prj1" does not)
 */
function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Case- and punctuation-insensitive match across the fields someone would search by.
 *
 * Normalised matching is a strict superset of plain substring matching: removing the
 * same characters from both sides preserves any contiguous match. The raw fallback
 * exists only for queries that are entirely punctuation (e.g. "#"), which would
 * otherwise normalise to an empty string and match everything.
 */
export function searchProjects(projects, query) {
  const raw = query.trim().toLowerCase();
  if (!raw) return projects;

  const q = normalise(raw);
  const fields = p => [p.address, p.projectName, p.clientName, p.code];

  if (!q) {
    return projects.filter(p => fields(p).some(f => (f || '').toLowerCase().includes(raw)));
  }
  return projects.filter(p => fields(p).some(f => normalise(f).includes(q)));
}
