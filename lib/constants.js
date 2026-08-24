// Shared constants. Nothing here is spreadsheet-tab-name aware — tab names come from
// the System config tab via lib/sheets.js getTab().

// ── Session ─────────────────────────────────────────────────────────────────
export const SESSION_KEY      = 'projects_pwa_user';
export const SESSION_TTL_DAYS = 7;

// Roles with elevated access. v1 does no gating — every logged-in user sees everything —
// but role is carried on the session so gated sections can be added without touching auth.
export const ADMIN_ROLES = ['admin', 'boss_man'];

// ── Projects ────────────────────────────────────────────────────────────────
// Catch-all bucket for general company expenses. Browsable like any other project,
// but MUST be excluded from every cross-project rollup — see lib/rollups.js.
export const GENERAL_PROJECT_CODE = 'GEN-000';

export const PROJECT_STATUSES = {
  ACTIVE:  'active',
  ON_HOLD: 'on-hold',
  CLOSED:  'closed',
};

// ── Costs ───────────────────────────────────────────────────────────────────
export const COST_TYPES = [
  { value: 'material',        label: 'Material'        },
  { value: 'external_labour', label: 'External Labour' },
  { value: 'transport',       label: 'Transport'       },
];

export const COST_TYPE_VALUES = COST_TYPES.map(t => t.value);

// Preselected on the cost form. Material is the most common entry, so defaulting to it
// saves a tap on most costs. Set to '' to force a deliberate choice every time.
export const DEFAULT_COST_TYPE = 'material';

// ── Recents ─────────────────────────────────────────────────────────────────
export const RECENTS_KEY   = 'projects_pwa_recents';
export const RECENTS_LIMIT = 5;
