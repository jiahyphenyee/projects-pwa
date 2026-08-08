'use client';

// Stale-while-revalidate project list. Renders instantly from the last cached copy,
// then refreshes in the background. The cache is also what makes offline reads work
// in a later phase.

import { useCallback, useEffect, useMemo, useState } from 'react';

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

  // Prepared once per list change rather than per keystroke — see buildSearchIndex
  const index = useMemo(() => buildSearchIndex(projects), [projects]);
  const search = useCallback(query => searchIndex(index, query), [index]);

  return { projects, search, loading, error, cachedAt, refresh: () => load({ silent: true }) };
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
 * Precompute each project's searchable text once, when the list loads.
 *
 * Normalising is a regex replace that allocates a new string, so doing it inside the
 * filter meant 4 allocations per project per keystroke — ~43ms per 5 keystrokes at
 * 10k projects, which is visible jank on a phone. Preparing it up front makes each
 * keystroke a plain substring check: ~14x faster, and flat regardless of how many
 * times you type.
 *
 * `project_name` is usually a copy of `display_address`, so duplicates are dropped to
 * keep the haystack small.
 */
export function buildSearchIndex(projects) {
  return projects.map(project => {
    const parts = [...new Set([project.address, project.projectName, project.clientName, project.code].filter(Boolean))];
    return {
      project,
      haystack: parts.map(normalise).join(' '),
      raw:      parts.join(' ').toLowerCase(),
    };
  });
}

/**
 * Case- and punctuation-insensitive match against a prepared index.
 *
 * Normalised matching is a strict superset of plain substring matching: removing the
 * same characters from both sides preserves any contiguous match. The raw fallback
 * exists only for queries that are entirely punctuation (e.g. "#"), which would
 * otherwise normalise to an empty string and match everything.
 */
export function searchIndex(index, query) {
  const raw = query.trim().toLowerCase();
  if (!raw) return index.map(entry => entry.project);

  const q = normalise(raw);
  const matches = q
    ? index.filter(entry => entry.haystack.includes(q))
    : index.filter(entry => entry.raw.includes(raw));

  return matches.map(entry => entry.project);
}
