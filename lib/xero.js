// The app's Xero connection. Tokens live in System config under XERO_PROJECTS_* — this
// app's own set, from its own Xero app registration. The expense app's XERO_* rows are
// never read or written here: refresh tokens are single-use, and two apps sharing one set
// would take turns invalidating it.
//
// XERO_DRY_RUN: anything other than the exact string "false" means dry run. Phases 2–4
// only read from Xero; the single write function arrives in Phase 5 and honours this flag.

import { getSheetsClient, getSheetId } from '@/lib/google';
import { quoteTab } from '@/lib/sheets';
import { createXeroClient } from '@/lib/xeroClient.mjs';

const CONFIG_TAB = 'System config';
export const TOKEN_KEYS = {
  accessToken:  'XERO_PROJECTS_ACCESS_TOKEN',
  refreshToken: 'XERO_PROJECTS_REFRESH_TOKEN',
  expiry:       'XERO_PROJECTS_TOKEN_EXPIRY',
};

export function isDryRun() {
  return process.env.XERO_DRY_RUN !== 'false';
}

async function readConfigRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${quoteTab(CONFIG_TAB)}!A:B`,
  });
  return res.data.values || [];
}

const store = {
  async load() {
    const rows = await readConfigRows();
    const find = key => rows.find(r => String(r[0] ?? '').trim() === key)?.[1] || '';
    return {
      accessToken:  find(TOKEN_KEYS.accessToken),
      refreshToken: find(TOKEN_KEYS.refreshToken),
      expiry:       Number(find(TOKEN_KEYS.expiry)) || 0,
    };
  },
  // Rows are found by key on every save, so moving them in the sheet is harmless.
  // One batch write, RAW, so a token is never parsed as a formula or a number.
  async save({ accessToken, refreshToken, expiry }) {
    const rows = await readConfigRows();
    const sheets = await getSheetsClient();
    const data = [];
    for (const [field, key] of Object.entries(TOKEN_KEYS)) {
      const index = rows.findIndex(r => String(r[0] ?? '').trim() === key);
      if (index === -1) throw new Error(`${key} is missing from System config — run scripts/xero-auth.mjs`);
      const value = field === 'expiry' ? String(expiry) : field === 'accessToken' ? accessToken : refreshToken;
      data.push({ range: `${quoteTab(CONFIG_TAB)}!B${index + 1}`, values: [[value]] });
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSheetId(),
      requestBody: { valueInputOption: 'RAW', data },
    });
  },
};

let client = null;

/** The shared client. Reads are always real; writes come only through Phase 5's wrapper. */
export function getXero() {
  if (!client) {
    client = createXeroClient({
      clientId:     process.env.XERO_CLIENT_ID,
      clientSecret: process.env.XERO_CLIENT_SECRET,
      tenantId:     process.env.XERO_TENANT_ID,
      store,
      log: msg => console.log('[xero]', msg),
    });
  }
  return client;
}
