// Small localStorage cache used as the guaranteed offline fallback.
//
// The service worker already caches API responses, but it only runs in production and
// only after its first install. This layer works everywhere and survives a cache purge,
// so a project you have opened before still renders its last-known costs with no signal.

export function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return entry && entry.data !== undefined ? entry : null;
  } catch {
    return null;
  }
}

export function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    // Quota exceeded, or private mode. Caching is an enhancement, so drop it silently
    // rather than failing the read that just succeeded.
  }
}

export function costsCacheKey(projectCode) {
  return `projects_pwa_costs_${projectCode}`;
}

/** The project screen's quote, Xero invoice and threshold figures (/api/dashboard). */
export function dashboardCacheKey(projectCode) {
  return `projects_pwa_dashboard_${projectCode}`;
}

/** "just now", "12 min ago", "3 hr ago" — for showing how stale offline data is. */
export function describeAge(timestamp) {
  if (!timestamp) return '';
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
