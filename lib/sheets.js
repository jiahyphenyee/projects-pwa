// Generic Google Sheets access layer. Deliberately not project-aware — section-specific
// logic belongs in its own module (lib/costs.js, and later lib/payroll.js etc).
//
// No tab name is ever hardcoded in a route. Tab names resolve from the workbook's
// "System config" tab via getTab(), so renaming a tab is a config edit, not a code change.

import { getSheetsClient, getSheetId } from '@/lib/google';

const CONFIG_TAB = 'System config';
const CONFIG_TTL_MS = 5 * 60 * 1000;

// Used only if the config fetch fails or a key is missing, so the app degrades
// rather than 500s. Keep in sync with the TAB_* keys in System config.
const TAB_FALLBACKS = {
  PROJECTS:      'Projects',
  PROJECT_COSTS: 'Project costs',
  EXPENSES:      'Expenses',
  CONTACTS:      'Contacts',
  CATEGORIES:    'Categories',
  WORKERS:       'Workers',
};

let configCache = null;   // { map, fetchedAt }
let configInFlight = null;

/** Fetch the System config key/value map, memoised for CONFIG_TTL_MS. */
async function getConfigMap() {
  const fresh = configCache && Date.now() - configCache.fetchedAt < CONFIG_TTL_MS;
  if (fresh) return configCache.map;
  if (configInFlight) return configInFlight;

  configInFlight = (async () => {
    try {
      const sheets = await getSheetsClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: getSheetId(),
        range: `${quoteTab(CONFIG_TAB)}!A:B`,
      });
      const map = Object.fromEntries(
        (res.data.values || [])
          .filter(r => r[0] && String(r[0]).trim())
          .map(r => [String(r[0]).trim(), r[1] ?? ''])
      );
      configCache = { map, fetchedAt: Date.now() };
      return map;
    } catch (err) {
      console.warn('[sheets] System config unreadable, using fallbacks:', err.message);
      return configCache?.map ?? {};
    } finally {
      configInFlight = null;
    }
  })();

  return configInFlight;
}

/**
 * Resolve a tab name from its TAB_* config key.
 * getTab('PROJECT_COSTS') -> value of TAB_PROJECT_COSTS, e.g. "Project costs"
 */
export async function getTab(key) {
  const map = await getConfigMap();
  const value = map[`TAB_${key}`];
  if (value && String(value).trim()) return String(value).trim();

  const fallback = TAB_FALLBACKS[key];
  if (!fallback) throw new Error(`Unknown tab key: TAB_${key}`);
  console.warn(`[sheets] TAB_${key} missing from System config, falling back to "${fallback}"`);
  return fallback;
}

/** Read any other config value, e.g. getConfig('GST_RATE'). */
export async function getConfig(key) {
  const map = await getConfigMap();
  return map[key];
}

/**
 * Quote a tab name for use in an A1 range. Tab names containing spaces or quotes
 * MUST be quoted — 'Project costs'!A:O is valid, Project costs!A:O is a 400.
 */
export function quoteTab(tabName) {
  return `'${String(tabName).replace(/'/g, "''")}'`;
}

/** Build a full A1 range: range('Project costs', 'A:O') -> "'Project costs'!A:O" */
export function range(tabName, a1) {
  return `${quoteTab(tabName)}!${a1}`;
}

/**
 * Read a tab and return only real data rows.
 *
 * This workbook has header rows AND free-text "ℹ" note rows sitting INSIDE the data
 * range (Projects row 2, Expenses row 4). Never use .slice(1) — always filter by a
 * recognisable ID in the first column.
 *
 * Returns [{ row, rowNumber }] where rowNumber is the 1-based sheet row, needed for
 * targeted updates.
 */
export async function readTab(tabName, a1, idPattern) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: range(tabName, a1),
  });
  const values = res.data.values || [];
  return values
    .map((row, i) => ({ row, rowNumber: i + 1 }))
    .filter(({ row }) => idPattern.test(String(row[0] ?? '').trim()));
}

/**
 * Prevent user text being interpreted as a formula. Sheets treats a leading
 * = + - @ | as the start of an expression under USER_ENTERED.
 */
export function safe(value) {
  if (typeof value === 'string' && /^[=+\-@|]/.test(value)) return `'${value}`;
  return value ?? '';
}

/**
 * Append a row. The API picks the next empty row server-side, so concurrent appends
 * are safe.
 *
 * Deliberately NOT insertDataOption: 'INSERT_ROWS'. Inserting a row is a structural
 * change to every column, so it fails on any tab with a protected column — the
 * Projects tab protects column C ("autofilled"). The default OVERWRITE writes into
 * the existing empty rows below the data instead, which touches only the columns named
 * in `a1`. Both tabs have ~1000 blank rows, so there is room; if a tab ever fills its
 * grid the API grows it automatically.
 */
export async function appendRow(tabName, a1, values) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: range(tabName, a1),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
  return res.data.updates?.updatedRange;
}

/** Overwrite an explicit range, e.g. a single located row. */
export async function updateRange(tabName, a1, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: range(tabName, a1),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

/** Find the 1-based sheet row whose column A equals id. Returns null if absent. */
export async function findRowById(tabName, id) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: range(tabName, 'A:A'),
  });
  const values = res.data.values || [];
  const index = values.findIndex(r => String(r[0] ?? '').trim() === id);
  return index === -1 ? null : index + 1;
}

/** Numeric sheetId (gid) for a tab, needed for structural ops like row deletion. Memoised. */
const gidCache = new Map();

export async function getSheetGid(tabName) {
  if (gidCache.has(tabName)) return gidCache.get(tabName);
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: getSheetId(),
    fields: 'sheets.properties(sheetId,title)',
  });
  const found = meta.data.sheets.find(s => s.properties.title === tabName);
  if (!found) throw new Error(`Tab not found: ${tabName}`);
  gidCache.set(tabName, found.properties.sheetId);
  return found.properties.sheetId;
}

/**
 * Next sequential ID for a prefix, using max+1 over existing IDs rather than a row
 * count — safe against deleted rows and note rows.
 * nextId([...], 'PC-', 4) -> 'PC-0007'
 */
export function nextId(existingIds, prefix, padding) {
  const max = existingIds.reduce((acc, id) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(id).trim());
    return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(padding, '0')}`;
}
