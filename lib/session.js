// Client-side session. localStorage (survives app close) with an explicit expiry,
// unlike the sibling expense-pwa which uses sessionStorage.
//
// This is a convenience gate, not a security boundary — the PIN is verified server-side
// on every login, but nothing here stops a determined user editing localStorage. That is
// acceptable for an internal tool on personal devices.

import { SESSION_KEY, SESSION_TTL_DAYS } from '@/lib/constants';
import { hasAccess } from '@/lib/roles.mjs';

const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export function saveUser(user) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      name:      user.name,
      role:      user.role,      // what lib/roles.mjs gates screens on
      expiresAt: Date.now() + TTL_MS,
    }));
  } catch {
    // private mode / quota — the user simply gets logged out on reload
  }
}

export function getUser() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.name || !session?.expiresAt) return null;
    // A session from before a role lost access (or was never given it) signs out
    if (Date.now() > session.expiresAt || !hasAccess(session.role)) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { name: session.name, role: session.role };
  } catch {
    return null;
  }
}

export function clearUser() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** Days remaining on the session, for display. Null if not logged in. */
export function daysRemaining() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!session?.expiresAt) return null;
    return Math.max(0, Math.ceil((session.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  } catch {
    return null;
  }
}
