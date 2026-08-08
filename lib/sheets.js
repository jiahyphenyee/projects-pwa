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
export async function readTab(tabName, a1, idPattern, { raw = false } = {}) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: range(tabName, a1),
    // raw:true returns dates as serial numbers, amounts as numbers and checkboxes as
    // booleans, instead of display strings. Needed wherever values are sorted or
    // summed — "10 Aug 2026" sorts before "9 Aug 2026" as text.
    valueRenderOption: raw ? 'UNFORMATTED_VALUE' : 'FORMATTED_VALUE',
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
 * `a1` MUST be a single column, normally 'A:A'. The API uses that range to detect
 * where the table ends, and a checkbox column reports "FALSE" in every formatted row
 * even when nothing was entered — passing a wide range like 'A:O' therefore makes the
 * table look 1000 rows long and appends far below the real data, outside the formatted
 * ranges. Column A is genuinely blank in unused rows. Values still write across all
 * columns from A, regardless of how narrow the search range is.
 *
 * Deliberately NOT insertDataOption: 'INSERT_ROWS'. Inserting a row is a structural
 * change to every column, so it fails on any tab with a protected column — the
 * Projects tab protects column C ("autofilled"). The default OVERWRITE writes into
 * existing empty rows instead.
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

/**
 * Write a row immediately after the last row whose column A matches `idPattern`.
 *
 * Used instead of appendRow on tabs carrying a checkbox column. A checkbox reports
 * "FALSE" in every formatted row even when empty, so the API's table detection treats
 * those rows as occupied and appends *below* them — landing outside the formatted
 * ranges, where dates stay as text instead of becoming real dates. Narrowing the
 * search range does not help: detection looks at whole rows.
 *
 * The trade-off is that row selection is no longer atomic, so two simultaneous writers
 * could target one row. Callers must verify the readback. With a handful of users that
 * window is negligible; revisit if this ever becomes a multi-user write path.
 */
export async function writeAfterLast(tabName, idPattern, values, { firstDataRow = 3 } = {}) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: range(tabName, 'A:A'),
  });
  const rows = res.data.values || [];

  let lastDataRow = 0;
  rows.forEach((row, i) => {
    if (idPattern.test(String(row[0] ?? '').trim())) lastDataRow = i + 1;
  });

  const target = Math.max(lastDataRow + 1, firstDataRow);
  const lastCol = String.fromCharCode('A'.charCodeAt(0) + values.length - 1);
  await updateRange(tabName, `A${target}:${lastCol}${target}`, values);
  return target;
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
