// Who can do what. A role is the third part of a `PWA_USER_n = name|PIN|role` row in
// System config, shared with expense-pwa. A role not listed here has no access to this
// app: /api/auth refuses its PIN and a session carrying it is dropped. Every listed role
// can open projects, create them, and enter and tick costs in both ledgers; the
// permissions below are what sits on top of that. `.mjs` so `node --test` runs it.

export const PERMISSIONS = {
  SUMMARY:  'summary',   // the project Summary: profit, margin, budget, cost split, by service
  QUOTES:   'quotes',    // write quotes and variation orders, and bill them to Xero
  INVOICES: 'invoices',  // the project's sales invoices in Xero
};

const ALL = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS = {
  admin:    ALL,
  boss_man: ALL,
  office:   [PERMISSIONS.QUOTES, PERMISSIONS.INVOICES],
};

// The sheet is typed by hand, so " Office " is office.
const normalise = role => String(role || '').trim().toLowerCase();

export function hasAccess(role) {
  return Object.hasOwn(ROLE_PERMISSIONS, normalise(role));
}

export function can(role, permission) {
  return hasAccess(role) && ROLE_PERMISSIONS[normalise(role)].includes(permission);
}
