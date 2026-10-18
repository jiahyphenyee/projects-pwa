// Shared constants. Nothing here is spreadsheet-tab-name aware — tab names come from
// the System config tab via lib/sheets.js getTab().

// ── Session ─────────────────────────────────────────────────────────────────
export const SESSION_KEY      = 'projects_pwa_user';
export const SESSION_TTL_DAYS = 7;

// Roles and what each may do: lib/roles.mjs.

// ── Projects ────────────────────────────────────────────────────────────────
// Catch-all bucket for general company expenses. Browsable like any other project,
// but MUST be excluded from every cross-project rollup — see lib/rollups.js.
export const GENERAL_PROJECT_CODE = 'GEN-000';

// A lock code is free text — "door lock: 1234#, gate lock: 5678" — so the cap is only
// wide enough to hold a sentence, not a pasted paragraph.
export const LOCK_CODE_MAX = 200;

export const PROJECT_STATUSES = {
  ACTIVE:  'active',
  ON_HOLD: 'on-hold',
  CLOSED:  'closed',
};

// ── Costs ───────────────────────────────────────────────────────────────────
// `value` is the literal string in the Project costs `cost_type` column, and must stay
// identical to that column's own dropdown in the workbook — the sheet validates against
// its list, so a value the app invents is rejected there even when the API accepts it.
// `variant` names a tag palette rather than reusing the value, so the palette keys stay
// readable identifiers instead of "labour (external)".
export const COST_TYPES = [
  { value: 'material',          label: 'Material',        variant: 'material'       },
  { value: 'labour (internal)', label: 'Internal Labour', variant: 'internalLabour' },
  { value: 'labour (external)', label: 'External Labour', variant: 'externalLabour' },
  { value: 'transport',         label: 'Transport',       variant: 'transport'      },
];

export const COST_TYPE_VALUES = COST_TYPES.map(t => t.value);

// Preselected on the cost form. Material is the most common entry, so defaulting to it
// saves a tap on most costs. Set to '' to force a deliberate choice every time.
export const DEFAULT_COST_TYPE = 'material';

// ── Recents ─────────────────────────────────────────────────────────────────
export const RECENTS_KEY   = 'projects_pwa_recents';
export const RECENTS_LIMIT = 5;
