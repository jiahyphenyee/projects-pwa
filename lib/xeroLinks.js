// Manual links from a Xero sales invoice to a project, made on the Invoices screen.
//
// Xero has no project field. Most invoices are matched by the app's own billing record or
// by Reference (lib/projectFigures.mjs → assignDocuments), but some never can be: two
// projects at one address (one billed to the ID firm, one to the owner), or an old invoice
// typed with a different address. A person links those once, here.
//
// This app owns the tab outright. One row per invoice, keyed by Xero's InvoiceID in column
// A. Unlinking blanks project_code rather than deleting the row, so no row index ever
// shifts under a concurrent write. A link is a fact about our books, never written to Xero.

import { getTab, readTab, updateRanges, writeAfterLast, assertHeaders, safe } from '@/lib/sheets';
import { nowIsoSingapore } from '@/lib/dates';

// Xero ids are GUIDs. Column A is filtered by this, so the header and ℹ note rows drop out.
const XERO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_CODE = /^(PRJ-|GEN-)\d+$/;
const FIRST_DATA_ROW = 3;

export const XERO_LINKS_COLUMNS = [
  ['xeroId',      'xero_id'],
  ['xeroNumber',  'xero_number'],
  ['projectCode', 'project_code'],
  ['linkedBy',    'linked_by'],
  ['linkedAt',    'linked_at'],
];
const COL     = Object.fromEntries(XERO_LINKS_COLUMNS.map(([f], i) => [f, i]));
const HEADERS = XERO_LINKS_COLUMNS.map(([, h]) => h);

const isMissingTab = err => /unable to parse range/i.test(err?.message || '');
const missingTabMessage = tab =>
  `The "${tab}" tab is missing from the workbook. Run node scripts/setup-xero-links-tab.mjs once.`;

async function linksTab() {
  const tab = await getTab('XERO_LINKS');
  await assertHeaders(tab, HEADERS);
  return tab;
}

function toLink({ row, rowNumber }) {
  return {
    xeroId:      String(row[COL.xeroId] ?? '').trim(),
    xeroNumber:  row[COL.xeroNumber] || '',
    projectCode: String(row[COL.projectCode] ?? '').trim(),
    linkedBy:    row[COL.linkedBy] || '',
    linkedAt:    row[COL.linkedAt] || '',
    rowNumber,
  };
}

/**
 * Every live link, [{ xeroId, projectCode, … }]. Unlinked rows (blank project) are left
 * out. A workbook without the tab yet reads as "no links", so the project screen still
 * renders; linking, by contrast, fails loudly.
 */
export async function readXeroLinks() {
  let tab;
  try {
    tab = await linksTab();
    // If a race left two rows for one invoice, the later row is the later decision.
    const latest = new Map();
    for (const link of (await readTab(tab, 'A:E', XERO_ID)).map(toLink)) latest.set(link.xeroId, link);
    return [...latest.values()].filter(l => l.projectCode);
  } catch (err) {
    if (isMissingTab(err)) {
      console.warn('[xeroLinks]', missingTabMessage(tab || 'Xero links'));
      return [];
    }
    throw err;
  }
}

/**
 * Link one invoice to a project, or unlink it with projectCode = ''. Upserts by xero_id.
 * Returns { ok, link } or { ok: false, status, error }.
 */
export async function setXeroLink({ xeroId, xeroNumber = '', projectCode = '', by = '' }) {
  const id = String(xeroId || '').trim();
  const code = String(projectCode || '').trim();
  if (!XERO_ID.test(id)) return { ok: false, status: 400, error: 'A valid Xero invoice id is required' };
  if (code && !PROJECT_CODE.test(code)) return { ok: false, status: 400, error: 'A valid project code is required' };

  let tab;
  try {
    tab = await linksTab();
    const rows = (await readTab(tab, 'A:E', XERO_ID)).map(toLink);
    // Every row for this invoice, not just the first: two people linking at once can each
    // append one, and an unlink that blanked only one would leave the other in force.
    const existing = rows.filter(r => r.xeroId === id);
    const now = nowIsoSingapore();

    let rowNumber;
    if (existing.length) {
      rowNumber = existing[0].rowNumber;
      await updateRanges(tab, existing.map(r => ({ a1: `C${r.rowNumber}:E${r.rowNumber}`, values: [safe(code), safe(by), now] })));
    } else {
      if (!code) return { ok: true, link: null };   // unlinking something never linked
      rowNumber = await writeAfterLast(tab, XERO_ID, [id, safe(xeroNumber), safe(code), safe(by), now], { firstDataRow: FIRST_DATA_ROW });
    }

    // writeAfterLast picks its row non-atomically, so confirm ours is the one that landed.
    const check = (await readTab(tab, 'A:E', XERO_ID)).map(toLink).find(r => r.rowNumber === rowNumber);
    if (!check || check.xeroId !== id) return { ok: false, status: 409, error: 'The row moved while saving. Please reload.' };
    return { ok: true, link: check };
  } catch (err) {
    if (isMissingTab(err)) return { ok: false, status: 500, error: missingTabMessage(tab || 'Xero links') };
    throw err;
  }
}
