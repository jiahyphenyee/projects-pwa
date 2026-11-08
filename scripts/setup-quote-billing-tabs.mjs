// One-off workbook setup for quote and billing. Safe to run more than once: every step
// checks before it acts and reports what it did.
//
//   node scripts/setup-quote-billing-tabs.mjs            # make the changes
//   node scripts/setup-quote-billing-tabs.mjs --dry-run  # only report what would change
//
// What it does, in order:
//   1. Deletes the unused invoicing tabs (Invoices, Payments, Payment allocations, Reports)
//      and the System config keys that served only them. Agreed with JY 2026-10-06 after
//      confirming no app and no formula outside those tabs reads them, and that the bound
//      Apps Script only names them as lookup keys that a deleted tab can never trigger.
//   2. Creates the four quote tabs with a header row and an ℹ note row, matching the
//      Project costs / Receipted expense invoicing shape (data from row 3). On a tab that
//      already exists, any header the schema has gained since (e.g. Quotes X–Z:
//      vo_reason, vo_title, settled_on_stage_id) is appended after the last one.
//   3. Adds the TAB_* keys and the quote config values to System config.
//   4. Appends `property_type` to Projects (column M) and `xero_tracking_option` to
//      Categories (column E), filling the latter from the map the expense app hard-codes
//      today so both apps can read one list.
//   5. Appends `quote_id` to Project costs (column O): the quote a cost counts towards
//      when picked by hand on the cost (2026-11-08).
//
// Columns are only ever appended, never inserted: both PWAs read Projects and Categories
// by index. System config rows are found by key in every app, so deleting rows there is
// safe.

import { google } from 'googleapis';
import {
  QUOTE_TAB_SPECS, QUOTE_CONFIG_DEFAULTS, OBSOLETE_TABS, OBSOLETE_CONFIG_KEYS,
  PROJECTS_PROPERTY_TYPE_HEADER, CATEGORIES_TRACKING_HEADER, CATEGORY_TO_TRACKING,
  PROJECT_COSTS_QUOTE_HEADER,
} from '../lib/quoteSchema.mjs';

try { process.loadEnvFile('.env.local'); } catch {}

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIG_TAB = 'System config';

function sheetsClient() {
  let key = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: key.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const sheets = sheetsClient();
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const q = t => `'${String(t).replace(/'/g, "''")}'`;
const log = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[setup]', ...a);

async function tabProps() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title,gridProperties)' });
  return new Map(meta.data.sheets.map(s => [s.properties.title, s.properties]));
}

async function batch(requests) {
  if (!requests.length || DRY_RUN) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function values(range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function write(range, rows, valueInputOption = 'RAW') {
  if (DRY_RUN) return;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption, requestBody: { values: rows } });
}

// ── 1. Remove the obsolete tabs and keys ────────────────────────────────────────────────

async function removeObsoleteTabs(props) {
  const requests = [];
  for (const title of OBSOLETE_TABS) {
    const p = props.get(title);
    if (!p) { log(`tab "${title}" already gone`); continue; }
    requests.push({ deleteSheet: { sheetId: p.sheetId } });
    log(`delete tab "${title}"`);
  }
  await batch(requests);
}

async function removeObsoleteKeys(props) {
  const rows = await values(`${q(CONFIG_TAB)}!A:A`);
  const gid = props.get(CONFIG_TAB).sheetId;
  const indexes = [];
  rows.forEach((r, i) => { if (OBSOLETE_CONFIG_KEYS.includes(String(r[0] ?? '').trim())) indexes.push(i); });
  if (!indexes.length) { log('obsolete config keys already gone'); return; }

  // Bottom-up, so earlier deletions do not shift the rows still to delete
  const requests = indexes.sort((a, b) => b - a).map(i => ({
    deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } },
  }));
  indexes.forEach(i => log(`delete config row ${i + 1}: ${rows[i][0]}`));
  await batch(requests);
}

// ── 2. Create the quote tabs ────────────────────────────────────────────────────────────

async function createQuoteTabs(props) {
  for (const spec of QUOTE_TAB_SPECS) {
    if (props.has(spec.title)) {
      const header = (await values(`${q(spec.title)}!1:1`))[0] || [];
      // Columns added to a spec after the tab was made are appended, never inserted
      for (let i = header.length; i < spec.headers.length; i++) {
        await appendHeader(await tabProps(), spec.title, spec.headers[i]);
        header.push(spec.headers[i]);
      }
      const drift = spec.headers.filter((h, i) => String(header[i] ?? '').trim().toLowerCase() !== h);
      log(`tab "${spec.title}" exists` + (drift.length ? ` — HEADER DRIFT on: ${drift.join(', ')}` : ', headers match'));
      continue;
    }
    log(`create tab "${spec.title}" with ${spec.headers.length} columns`);
    await batch([{
      addSheet: {
        properties: {
          title: spec.title,
          gridProperties: { rowCount: 1000, columnCount: spec.headers.length, frozenRowCount: 1 },
        },
      },
    }]);
    await write(`${q(spec.title)}!A1`, [spec.headers, [spec.note]]);
  }
}

// ── 3. Config keys ──────────────────────────────────────────────────────────────────────

async function addConfigKeys() {
  const rows = await values(`${q(CONFIG_TAB)}!A:B`);
  const have = new Set(rows.map(r => String(r[0] ?? '').trim()));
  const missing = [];
  for (const spec of QUOTE_TAB_SPECS) {
    if (!have.has(spec.configKey)) missing.push([spec.configKey, spec.title]);
  }
  for (const [key, value] of Object.entries(QUOTE_CONFIG_DEFAULTS)) {
    if (!have.has(key)) missing.push([key, value]);
  }
  if (!missing.length) { log('config keys all present'); return; }
  missing.forEach(([k, v]) => log(`add config ${k} = ${v === '' ? '(blank)' : v}`));
  if (DRY_RUN) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${q(CONFIG_TAB)}!A:B`, valueInputOption: 'RAW', requestBody: { values: missing },
  });
}

// ── 4. New columns on shared tabs ───────────────────────────────────────────────────────

/** Append a header to the first blank column after the last used one, widening the tab if needed. */
async function appendHeader(props, tab, header) {
  const row = (await values(`${q(tab)}!1:1`))[0] || [];
  const existing = row.findIndex(h => String(h ?? '').trim().toLowerCase() === header);
  if (existing !== -1) { log(`${tab}: "${header}" already at column ${colLetter(existing)}`); return existing; }

  const index = row.length;   // first column after the last header
  const p = props.get(tab);
  if (p.gridProperties.columnCount <= index) {
    log(`${tab}: widen from ${p.gridProperties.columnCount} to ${index + 1} columns`);
    await batch([{ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: index + 1 - p.gridProperties.columnCount } }]);
  }
  log(`${tab}: add header "${header}" at column ${colLetter(index)}`);
  await write(`${q(tab)}!${colLetter(index)}1`, [[header]]);
  return index;
}

async function fillCategoryTracking(col) {
  const rows = await values(`${q('Categories')}!A:${colLetter(col)}`);
  const updates = [];
  rows.forEach((r, i) => {
    const code = String(r[0] ?? '').trim();
    if (i === 0 || !/^[A-Z]{3,6}$/.test(code)) return;
    if (String(r[col] ?? '').trim()) return;                 // already filled by hand
    if (!(code in CATEGORY_TO_TRACKING)) { log(`Categories: ${code} has no known Xero option, left blank`); return; }
    const option = CATEGORY_TO_TRACKING[code];
    if (option === null) return;                              // deliberately untagged
    updates.push({ range: `${q('Categories')}!${colLetter(col)}${i + 1}`, values: [[option]] });
    log(`Categories: ${code} → "${option}"`);
  });
  if (!updates.length || DRY_RUN) return;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: updates } });
}

function colLetter(index) {
  let n = index, out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────

let props = await tabProps();
await removeObsoleteTabs(props);
await removeObsoleteKeys(props);
props = await tabProps();
await createQuoteTabs(props);
await addConfigKeys();
props = await tabProps();
await appendHeader(props, 'Projects', PROJECTS_PROPERTY_TYPE_HEADER);
const trackingCol = await appendHeader(props, 'Categories', CATEGORIES_TRACKING_HEADER);
await fillCategoryTracking(trackingCol);
await appendHeader(props, 'Project costs', PROJECT_COSTS_QUOTE_HEADER);
log('done');
