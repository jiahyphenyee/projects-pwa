// One-off workbook setup for the Invoices screen's manual links. Safe to run more than
// once: it only creates what is missing, and never deletes or rewrites anything.
//
//   node scripts/setup-xero-links-tab.mjs            # make the changes
//   node scripts/setup-xero-links-tab.mjs --dry-run  # only report what would change
//
// 1. Creates the `Xero links` tab: header row, ℹ note row, data from row 3, matching the
//    Project costs / Receipted expense invoicing shape.
// 2. Adds TAB_XERO_LINKS to System config.
//
// The headers must match XERO_LINKS_COLUMNS in lib/xeroLinks.js; the app asserts them on
// first use, so any drift fails loudly rather than writing into the wrong column.

import { google } from 'googleapis';

try { process.loadEnvFile('.env.local'); } catch {}

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIG_TAB = 'System config';
const TITLE = 'Xero links';
const CONFIG_KEY = 'TAB_XERO_LINKS';
const HEADERS = ['xero_id', 'xero_number', 'project_code', 'linked_by', 'linked_at'];
const NOTE = 'ℹ  Manual links from a Xero sales invoice to a project, made on the Invoices screen. One row per invoice; a blank project_code means unlinked. Written by the Projects PWA only.';

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

const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
const titles = new Set(meta.data.sheets.map(s => s.properties.title));

if (titles.has(TITLE)) {
  log(`tab "${TITLE}" already exists`);
} else {
  log(`create tab "${TITLE}"`);
  if (!DRY_RUN) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{
      addSheet: { properties: { title: TITLE, gridProperties: { rowCount: 1000, columnCount: HEADERS.length, frozenRowCount: 1 } } },
    }] } });
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${q(TITLE)}!A1`, valueInputOption: 'RAW', requestBody: { values: [HEADERS, [NOTE]] },
    });
  }
}

const config = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${q(CONFIG_TAB)}!A:B` })).data.values || [];
if (config.some(r => String(r[0] ?? '').trim() === CONFIG_KEY)) {
  log(`${CONFIG_KEY} already in System config`);
} else {
  log(`add ${CONFIG_KEY} = ${TITLE} to System config`);
  if (!DRY_RUN) {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `${q(CONFIG_TAB)}!A:B`, valueInputOption: 'RAW', requestBody: { values: [[CONFIG_KEY, TITLE]] },
    });
  }
}
log('done');
