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

// ── Reads used by billing ────────────────────────────────────────────────────────────

/** A Xero contact by ContactID, or null if Xero has no such contact. */
export async function getXeroContact(contactId) {
  try {
    const res = await getXero().get(`/Contacts/${encodeURIComponent(contactId)}`);
    return res?.Contacts?.[0] || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Every sales invoice whose number starts with `prefix`, any status, voided included. */
export async function listInvoiceNumbers(prefix) {
  const where = `Type=="ACCREC" AND InvoiceNumber.StartsWith("${prefix.replace(/"/g, '')}")`;
  const numbers = [];
  // Not summaryOnly: Xero refuses a StartsWith filter with it. A day's invoices are few.
  for await (const page of getXero().pages('/Invoices', 'Invoices', { where })) {
    for (const inv of page) if (inv.InvoiceNumber) numbers.push(inv.InvoiceNumber);
  }
  return numbers;
}

/** The sales invoice with exactly this number, or null. */
export async function findInvoiceByNumber(invoiceNumber) {
  const where = `Type=="ACCREC" AND InvoiceNumber=="${invoiceNumber.replace(/"/g, '')}"`;
  const res = await getXero().get(`/Invoices?${new URLSearchParams({ where })}`);
  return res?.Invoices?.[0] || null;
}

// ── The one write ────────────────────────────────────────────────────────────────────

/**
 * Create one invoice in Xero. EVERY Xero write in this app goes through here.
 *
 * Dry run (the default — anything but XERO_DRY_RUN=false): logs the payload and returns a
 * clearly fake result without calling Xero. The caller must not store a dry-run result as
 * billed; `dryRun: true` is on the result so it can tell.
 *
 * `idempotencyKey` is sent as Xero's Idempotency-Key header, so a repeated request with the
 * same key (a retry after a lost response) returns the first invoice instead of a second.
 */
export async function createInvoice(invoice, { idempotencyKey } = {}) {
  if (isDryRun()) {
    console.log('[xero] DRY RUN — invoice NOT sent:\n' + JSON.stringify(invoice, null, 2));
    return { dryRun: true, invoice: { ...invoice, InvoiceID: `DRYRUN-${Date.now()}` } };
  }
  const res = await getXero().post('/Invoices', { Invoices: [invoice] }, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  });
  const created = res?.Invoices?.[0];
  if (!created?.InvoiceID) throw new Error('Xero accepted the request but returned no invoice');
  return { dryRun: false, invoice: created };
}

/** Xero's validation messages from a failed write, e.g. ["Invoice # must be unique."]. */
export function validationMessages(err) {
  try {
    const body = JSON.parse(err?.body || '{}');
    return (body.Elements || []).flatMap(e => (e.ValidationErrors || []).map(v => v.Message)).filter(Boolean);
  } catch {
    return [];
  }
}
