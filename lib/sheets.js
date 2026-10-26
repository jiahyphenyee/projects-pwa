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
  PROJECTS:             'Projects',
  PROJECT_COSTS:        'Project costs',
  EXPENSES:             'Expenses',
  RECEIPTED_INVOICING:  'Receipted expense invoicing',
  CONTACTS:             'Contacts',
  CATEGORIES:           'Categories',
  WORKERS:              'Workers',
  QUOTES:               'Quotes',
  QUOTE_LINES:          'Quote lines',
  PAYMENT_STAGES:       'Payment stages',
  PRICE_HISTORY:        'Price history',
  XERO_LINKS:           'Xero links',
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
 * MUST be quoted — 'Project costs'!A:N is valid, Project costs!A:N is a 400.
 */
export function quoteTab(tabName) {
  return `'${String(tabName).replace(/'/g, "''")}'`;
}

/** Build a full A1 range: range('Project costs', 'A:N') -> "'Project costs'!A:N" */
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
 * even when nothing was entered — passing a wide range like 'A:N' therefore makes the
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

/**
 * Append several rows in one request. Same rules as appendRow: `a1` is a single column
 * used only to find the end of the table. One request means the rows land together — the
 * API never writes half of them — which is what lets a quote's lines be saved as a block.
 */
export async function appendRows(tabName, a1, rows) {
  if (!rows.length) return null;
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: range(tabName, a1),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  return res.data.updates?.updatedRange;
}

/**
 * Delete a set of rows by their 1-based numbers, in one structural request.
 *
 * All the deletions are sent in a single batchUpdate, bottom-up, so the API applies them
 * atomically against the row numbers the caller read — none of them shifts another. The
 * caller must have read those numbers immediately beforehand; this is the same window as
 * deleteRowById's and only acceptable on tabs this app owns outright.
 */
export async function deleteRowsByNumbers(tabName, rowNumbers) {
  const unique = [...new Set(rowNumbers)].sort((a, b) => b - a);
  if (!unique.length) return 0;
  const gid = await getSheetGid(tabName);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSheetId(),
    requestBody: {
      requests: unique.map(n => ({
        deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
      })),
    },
  });
  return unique.length;
}

/**
 * Overwrite several ranges in one request. Used for bulk edits so marking twenty costs
 * is a single round trip rather than twenty, which would also risk partial application
 * if one failed midway.
 */
export async function updateRanges(tabName, edits) {
  if (!edits.length) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSheetId(),
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: edits.map(({ a1, values }) => ({ range: range(tabName, a1), values: [values] })),
    },
  });
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
  // A row wider than the tab is a column map that has drifted from the sheet, and the
  // API's own error for it ("exceeds grid limits") names neither. Say which, here, before
  // spending a write on it — a caller writing one column too many otherwise fails on
  // every single insert with a message that points nowhere.
  const columnCount = await getSheetColumnCount(tabName);
  if (values.length > columnCount) {
    throw new Error(
      `${tabName} is ${columnCount} columns wide but ${values.length} values were given. ` +
      `The column map in the caller is out of date with the sheet.`
    );
  }

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
  await updateRange(tabName, `A${target}:${columnLetter(values.length - 1)}${target}`, values);
  return target;
}

/**
 * 0-based column index to an A1 column letter: 0 -> A, 25 -> Z, 26 -> AA.
 *
 * Not String.fromCharCode(65 + i): that returns '[' for column 26 and keeps going into
 * punctuation, producing a range the API rejects for a reason unrelated to the mistake.
 */
export function columnLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Verify a tab's header row still matches the column map the caller reads it with.
 *
 * Insurance against the one spreadsheet failure that is otherwise invisible. Inserting
 * or deleting a column shifts every field after it, and code addressing columns by index
 * carries on reading the neighbour's values as though nothing happened — an amount
 * renders as a label, a checkbox parses as a number, and nothing throws. A wrong figure
 * is worse than an error, so this turns that class of drift into a loud one.
 *
 * `expected` is position-indexed; a `null` entry means "this app does not address that
 * column, so its name is not our business". Columns beyond the array are ignored — the
 * check is that the ones we do address are where we think they are.
 *
 * Memoised per process: one extra read on a cold start, nothing on warm requests. A
 * failed read is not cached, so a transient error cannot wedge the tab permanently.
 *
 * The cache key includes the expectation, not just the tab. Keying on the tab alone
 * would let the first caller's map satisfy the check for every later one — so a second
 * module reading the same tab through a different, wrong map would sail past unverified,
 * which is the exact failure this function exists to catch.
 */
const headerChecks = new Map();

export function assertHeaders(tabName, expected) {
  const key = `${tabName}\u0000${expected.join('\u0001')}`;
  if (!headerChecks.has(key)) {
    headerChecks.set(key, verifyHeaders(tabName, expected).catch(err => {
      headerChecks.delete(key);
      throw err;
    }));
  }
  return headerChecks.get(key);
}

async function verifyHeaders(tabName, expected) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: range(tabName, `A1:${columnLetter(expected.length - 1)}1`),
  });
  const actual = (res.data.values || [])[0] || [];

  const norm = v => String(v ?? '').trim().toLowerCase();
  const drift = expected
    .map((want, i) => ({ col: columnLetter(i), want, got: actual[i] }))
    .filter(({ want, got }) => want !== null && norm(want) !== norm(got));

  if (!drift.length) return;

  throw new Error(
    `${tabName} no longer has the columns this code expects — ` +
    drift.map(({ col, want, got }) => `${col} should be "${want}" but is "${got ?? '(empty)'}"`).join('; ') +
    `. A column was probably inserted or deleted. Fix the column map in code to match ` +
    `the sheet, and check every A1 range for this tab, rather than reshaping the sheet.`
  );
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

/**
 * Delete the row whose column A equals `id`.
 *
 * The API deletes by row index, not by ID, and indexes shift under concurrent writes.
 * The row is therefore re-verified immediately before deletion and the call aborts on
 * a mismatch rather than removing whatever moved into that position. The window is not
 * zero — with more concurrent writers this should become a soft delete instead.
 *
 * Only safe on tabs this app owns. Structural deletes fail on any tab with a protected
 * column, and are forbidden by convention on the shared tabs regardless.
 */
export async function deleteRowById(tabName, id) {
  const rowNumber = await findRowById(tabName, id);
  if (!rowNumber) return { deleted: false, reason: 'not-found' };

  const sheets = await getSheetsClient();
  const check = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: range(tabName, `A${rowNumber}:A${rowNumber}`),
  });
  if (String(check.data.values?.[0]?.[0] ?? '').trim() !== id) {
    return { deleted: false, reason: 'moved' };
  }

  const gid = await getSheetGid(tabName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }],
    },
  });
  return { deleted: true, rowNumber };
}

/**
 * A tab's gid and width. Memoised for the life of the process, like the config map.
 *
 * Width is only ever used to reject a too-wide write, so a stale value fails closed: if
 * someone widens a tab mid-process the next insert complains until the lambda recycles,
 * which is the harmless direction. A narrowed tab is caught immediately, which is the
 * one that matters.
 */
const propsCache = new Map();

async function getSheetProps(tabName) {
  if (propsCache.has(tabName)) return propsCache.get(tabName);
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: getSheetId(),
    fields: 'sheets.properties(sheetId,title,gridProperties.columnCount)',
  });
  const found = meta.data.sheets.find(s => s.properties.title === tabName);
  if (!found) throw new Error(`Tab not found: ${tabName}`);

  const props = {
    gid:         found.properties.sheetId,
    columnCount: found.properties.gridProperties?.columnCount ?? Infinity,
  };
  propsCache.set(tabName, props);
  return props;
}

/** Numeric sheetId (gid) for a tab, needed for structural ops like row deletion. */
export async function getSheetGid(tabName) {
  return (await getSheetProps(tabName)).gid;
}

/** How many columns the tab actually has. A write past the last one is a hard API error. */
export async function getSheetColumnCount(tabName) {
  return (await getSheetProps(tabName)).columnCount;
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
