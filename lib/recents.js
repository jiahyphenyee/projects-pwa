// Recently-opened projects, per user, per device.
//
// Deliberately localStorage rather than a sheet-backed access log: recording a row on
// every project tap would cost a write per navigation and grow the workbook forever.
// The trade-off is that recents don't follow you between phone and laptop.

import { RECENTS_KEY, RECENTS_LIMIT } from '@/lib/constants';

function keyFor(userName) {
  return `${RECENTS_KEY}_${userName || 'anon'}`;
}

/** Project codes, most recently opened first. */
export function getRecentCodes(userName) {
  try {
    const raw = localStorage.getItem(keyFor(userName));
    const codes = JSON.parse(raw || '[]');
    return Array.isArray(codes) ? codes.filter(c => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

/** Fired after recents change, so screens showing them can refresh without remounting. */
export const RECENTS_CHANGED = 'projects-pwa:recents-changed';

/** Move a code to the front, de-duplicated, capped at RECENTS_LIMIT. */
export function recordRecent(userName, code) {
  if (!code) return;
  try {
    const current = getRecentCodes(userName);
    if (current[0] === code) return;                 // already at the front, nothing to do

    const next = [code, ...current.filter(c => c !== code)].slice(0, RECENTS_LIMIT);
    localStorage.setItem(keyFor(userName), JSON.stringify(next));
    // The App Router may keep the home screen mounted, so a remount isn't guaranteed
    window.dispatchEvent(new Event(RECENTS_CHANGED));
  } catch {
    // quota or private mode — recents silently stop updating, which is survivable
  }
}

/**
 * Resolve codes to project objects, dropping any that no longer exist.
 * Falls back to the newest projects when the user has no history yet — sheet order is
 * creation order, so the tail of the list is newest.
 */
export function resolveRecents(userName, projects) {
  if (!projects?.length) return { items: [], isFallback: false };

  const byCode = new Map(projects.map(p => [p.code, p]));
  const items  = getRecentCodes(userName)
    .map(code => byCode.get(code))
    .filter(Boolean);

  if (items.length) return { items, isFallback: false };

  return {
    items: [...projects].slice(-RECENTS_LIMIT).reverse(),
    isFallback: true,
  };
}
