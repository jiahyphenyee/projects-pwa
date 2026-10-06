// Helpers for the one-off scripts, which run under plain Node and so cannot use the app's
// `@/` imports. Sheets access and the Xero token store are re-implemented here in the
// smallest form; the rules are the same as lib/sheets.js and lib/xero.js.

import { google } from 'googleapis';
import { createXeroClient } from '../lib/xeroClient.mjs';

try { process.loadEnvFile('.env.local'); } catch {}

const CONFIG_TAB = 'System config';
const TOKEN_KEYS = {
  accessToken:  'XERO_PROJECTS_ACCESS_TOKEN',
  refreshToken: 'XERO_PROJECTS_REFRESH_TOKEN',
  expiry:       'XERO_PROJECTS_TOKEN_EXPIRY',
};

export const spreadsheetId = process.env.GOOGLE_SHEET_ID;
export const q = t => `'${String(t).replace(/'/g, "''")}'`;

let sheetsClient = null;
export function sheets() {
  if (sheetsClient) return sheetsClient;
  let key = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: key.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/** Rows of a range; `raw` returns numbers and date serials instead of display strings. */
export async function readRange(range, { raw = false } = {}) {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId, range, valueRenderOption: raw ? 'UNFORMATTED_VALUE' : 'FORMATTED_VALUE',
  });
  return res.data.values || [];
}

/** Data rows of a tab, filtered on an ID pattern in column A, with their 1-based row numbers. */
export async function readTab(tab, a1, idPattern, opts) {
  const rows = await readRange(`${q(tab)}!${a1}`, opts);
  return rows.map((row, i) => ({ row, rowNumber: i + 1 })).filter(({ row }) => idPattern.test(String(row[0] ?? '').trim()));
}

export async function appendRows(tab, rows, valueInputOption = 'USER_ENTERED') {
  if (!rows.length) return;
  await sheets().spreadsheets.values.append({
    spreadsheetId, range: `${q(tab)}!A:A`, valueInputOption, requestBody: { values: rows },
  });
}

export async function updateCells(data, valueInputOption = 'USER_ENTERED') {
  if (!data.length) return;
  await sheets().spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption, data } });
}

export function safe(value) {
  if (typeof value === 'string' && /^[=+\-@|]/.test(value)) return `'${value}`;
  return value ?? '';
}

export function nextId(existingIds, prefix, padding) {
  const max = existingIds.reduce((acc, id) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(id).trim());
    return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(padding, '0')}`;
}

export function columnLetter(index) {
  let n = index, out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

/** System config as a key → value map. */
export async function configMap() {
  const rows = await readRange(`${q(CONFIG_TAB)}!A:B`);
  return Object.fromEntries(rows.filter(r => r[0]).map(r => [String(r[0]).trim(), r[1] ?? '']));
}

/** Resolve a TAB_* key to the tab's current name. */
export async function tabName(key, fallback) {
  const map = await configMap();
  return String(map[`TAB_${key}`] || fallback || '').trim();
}

/**
 * Append a header to the first blank column of a tab, widening it if needed. Returns the
 * 0-based column index. Columns are only ever appended: both PWAs read shared tabs by index.
 */
export async function ensureHeader(tab, header) {
  const row = (await readRange(`${q(tab)}!1:1`))[0] || [];
  const existing = row.findIndex(h => String(h ?? '').trim().toLowerCase() === header.toLowerCase());
  if (existing !== -1) return existing;

  const index = row.length;
  const meta = await sheets().spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title,gridProperties)' });
  const p = meta.data.sheets.find(s => s.properties.title === tab)?.properties;
  if (!p) throw new Error(`Tab not found: ${tab}`);
  if (p.gridProperties.columnCount <= index) {
    await sheets().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: index + 1 - p.gridProperties.columnCount } }] },
    });
  }
  await updateCells([{ range: `${q(tab)}!${columnLetter(index)}1`, values: [[header]] }], 'RAW');
  return index;
}

// ── Xero, with the token store in System config (same keys as lib/xero.js) ──────────────

const store = {
  async load() {
    const map = await configMap();
    return {
      accessToken:  map[TOKEN_KEYS.accessToken] || '',
      refreshToken: map[TOKEN_KEYS.refreshToken] || '',
      expiry:       Number(map[TOKEN_KEYS.expiry]) || 0,
    };
  },
  async save({ accessToken, refreshToken, expiry }) {
    const rows = await readRange(`${q(CONFIG_TAB)}!A:A`);
    const data = [];
    for (const [field, key] of Object.entries(TOKEN_KEYS)) {
      const index = rows.findIndex(r => String(r[0] ?? '').trim() === key);
      if (index === -1) throw new Error(`${key} is missing from System config — run scripts/xero-auth.mjs`);
      const value = field === 'expiry' ? String(expiry) : field === 'accessToken' ? accessToken : refreshToken;
      data.push({ range: `${q(CONFIG_TAB)}!B${index + 1}`, values: [[value]] });
    }
    await updateCells(data, 'RAW');
  },
};

export function xero() {
  return createXeroClient({
    clientId:     process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    tenantId:     process.env.XERO_TENANT_ID,
    store,
    log: msg => console.log('[xero]', msg),
  });
}
