// Non-receipted project costs — the tab this app owns outright.
//
// Distinct from the Expenses tab, which holds receipted expenses and is pushed to Xero
// by the sibling expense-pwa. This app never writes to Expenses and makes no Xero calls.

import { getTab, readTab, writeAfterLast, updateRange, updateRanges, findRowById, deleteRowById, safe, nextId } from '@/lib/sheets';
import { COST_TYPE_VALUES } from '@/lib/constants';
import { nowIsoSingapore, todaySingapore, isIsoDate, sheetDateToIso } from '@/lib/dates';

const COST_ID = /^PC-/;
const CATEGORY_CODE = /^[A-Z]{3,6}$/;

// Project costs tab column order (A:N).
//
// There is NO category_name column — the trade's display name is joined from the
// Categories tab on read (see readCategories). The tab is exactly 14 columns wide and
// every range here must stay inside it: a write past N is rejected outright by the API
// with "exceeds grid limits", not silently truncated.
const COL = {
  id: 0, createdAt: 1, projectCode: 2, projectName: 3, costDate: 4,
  costType: 5, categoryCode: 6, description: 7, amount: 8,
  invoiced: 9, invoicedDate: 10, invoiceRef: 11, createdBy: 12, updatedAt: 13,
};

/**
 * The Categories tab as a code→name map, plus the set of codes still active.
 *
 * Names are needed for every code ever used, not just the live ones: deactivating a
 * category must not blank the label on the costs already booked against it. Only writes
 * check `active`.
 */
async function readCategories() {
  const tab  = await getTab('CATEGORIES');
  const rows = await readTab(tab, 'A:C', CATEGORY_CODE);

  const names  = new Map();
  const active = new Set();
  rows.forEach(({ row }) => {
    const code = String(row[0] || '').trim();
    if (!code) return;
    names.set(code, row[1] || code);
    if (String(row[2] || '').toUpperCase() === 'TRUE') active.add(code);
  });
  return { names, active };
}

function toCost({ row, rowNumber }, categoryNames) {
  const categoryCode = row[COL.categoryCode] || '';

  return {
    id:           row[COL.id]          || '',
    createdAt:    row[COL.createdAt]   || '',
    projectCode:  row[COL.projectCode] || '',
    projectName:  row[COL.projectName] || '',
    date:         sheetDateToIso(row[COL.costDate]),
    costType:     String(row[COL.costType] || '').trim(),
    categoryCode,
    categoryName: categoryNames?.get(categoryCode) || categoryCode,
    description:  row[COL.description] || '',
    amount:       parseAmount(row[COL.amount]),
    invoiced:     row[COL.invoiced] === true || String(row[COL.invoiced] || '').toUpperCase() === 'TRUE',
    invoicedDate: sheetDateToIso(row[COL.invoicedDate]),
    invoiceRef:   row[COL.invoiceRef]  || '',
    createdBy:    row[COL.createdBy]   || '',
    rowNumber,
  };
}

/**
 * Sheets may hand back "1,234.50" or "$1,234.50" depending on cell formatting.
 *
 * Returns null, never 0, for a cell that is not a number. A zero is a real amount and a
 * plausible one, so coercing garbage to it makes a misread column look like sound data —
 * which is exactly how a column-order bug once read as "every cost is $0.00".
 */
function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value ?? '').trim();
  if (!text) return null;

  const n = parseFloat(text.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function listCosts(projectCode) {
  const tab = await getTab('PROJECT_COSTS');
  const [rows, categories] = await Promise.all([
    readTab(tab, 'A:N', COST_ID, { raw: true }),
    readCategories(),
  ]);

  const costs = rows.map(row => toCost(row, categories.names));
  return projectCode ? costs.filter(c => c.projectCode === projectCode) : costs;
}

export async function createCost({
  projectCode, projectName, date, costType, categoryCode, description, amount, createdBy,
}) {
  const code = String(projectCode || '').trim();
  if (!code) return { ok: false, status: 400, error: 'Project is required' };

  const type = String(costType || '').trim();
  if (!COST_TYPE_VALUES.includes(type)) {
    return { ok: false, status: 400, error: `Cost type must be one of: ${COST_TYPE_VALUES.join(', ')}` };
  }

  const costDate = String(date || '').trim() || todaySingapore();
  if (!isIsoDate(costDate)) {
    return { ok: false, status: 400, error: 'Date must be a valid YYYY-MM-DD' };
  }

  const value = typeof amount === 'number' ? amount : parseFloat(String(amount ?? '').replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, status: 400, error: 'Amount must be a number greater than zero' };
  }
  // Guard against a mistyped amount silently entering the books
  if (value > 1_000_000) {
    return { ok: false, status: 400, error: 'Amount looks wrong — over $1,000,000' };
  }

  // Category is required and must be live, so reporting can rely on it
  const category  = String(categoryCode || '').trim();
  const categories = await readCategories();
  if (!categories.active.has(category)) {
    return { ok: false, status: 400, error: `Unknown or inactive category: ${categoryCode}` };
  }

  const tab      = await getTab('PROJECT_COSTS');
  const existing = await readTab(tab, 'A:A', COST_ID);
  const id       = nextId(existing.map(({ row }) => row[0]), 'PC-', 4);
  const now      = nowIsoSingapore();

  // writeAfterLast, not appendRow: the invoiced checkbox column makes every formatted
  // row report FALSE, so the API's table detection appends past row 1000 — outside the
  // date and currency formatting. See writeAfterLast for the full explanation.
  const rowNumber = await writeAfterLast(tab, COST_ID, [
    id,                            // A cost_id
    now,                           // B created_at
    safe(code),                    // C project_code
    safe(projectName || ''),       // D project_name — snapshot at entry time
    costDate,                      // E cost_date
    type,                          // F cost_type
    category,                      // G category_code
    safe(description || ''),       // H description
    value,                         // I amount
    'FALSE',                       // J invoiced
    '',                            // K invoiced_date
    '',                            // L invoice_ref
    safe(createdBy || ''),         // M created_by
    now,                           // N updated_at
  ]);

  // Row selection is not atomic here, so confirm our row is the one that landed
  const check = await readTab(tab, 'A:N', COST_ID, { raw: true });
  const written = check.find(({ rowNumber: n }) => n === rowNumber);
  if (!written || written.row[COL.id] !== id) {
    return {
      ok: false,
      status: 409,
      error: 'Another entry was saved at the same moment. Please try again.',
    };
  }

  return {
    ok: true,
    cost: { ...toCost(written, categories.names), rowNumber },
  };
}

/**
 * Tick or untick a cost as invoiced.
 *
 * Writes J:K (invoiced + invoiced_date) and N (updated_at) as two ranges rather than
 * one J:N block, because L (invoice_ref) and M (created_by) sit between them and must
 * not be clobbered. invoiced_date is stamped on tick and cleared on untick, so it never
 * describes a state the row is not in.
 */
export async function setInvoiced(costId, invoiced) {
  const id = String(costId || '').trim();
  if (!COST_ID.test(id)) {
    return { ok: false, status: 400, error: 'A valid cost id is required' };
  }

  const tab = await getTab('PROJECT_COSTS');
  const rowNumber = await findRowById(tab, id);
  if (!rowNumber) {
    return { ok: false, status: 404, error: `No cost found with id ${id}` };
  }

  // One batch, not two calls: the ranges are validated together and applied together, so
  // a bad range can never leave the invoiced flag written and its timestamp missing.
  await updateRanges(tab, [
    { a1: `J${rowNumber}:K${rowNumber}`, values: [
      invoiced ? 'TRUE' : 'FALSE',
      invoiced ? todaySingapore() : '',
    ] },
    { a1: `N${rowNumber}:N${rowNumber}`, values: [nowIsoSingapore()] },
  ]);

  const [rows, categories] = await Promise.all([
    readTab(tab, 'A:N', COST_ID, { raw: true }),
    readCategories(),
  ]);
  const written = rows.find(({ rowNumber: n }) => n === rowNumber);
  if (!written || written.row[COL.id] !== id) {
    return { ok: false, status: 409, error: 'The row moved while saving. Please reload.' };
  }

  return { ok: true, cost: toCost(written, categories.names) };
}

/**
 * Edit a cost's own fields.
 *
 * Rewrites E:I only — the date, type, category, description and amount. Deliberately
 * leaves project_code and project_name (a cost does not move between projects here),
 * J:M (invoiced state, invoice_ref, created_by), and A:B (id and created_at). So
 * correcting an amount never silently un-bills a line or reassigns authorship.
 */
export async function updateCost(costId, { date, costType, categoryCode, description, amount }) {
  const id = String(costId || '').trim();
  if (!COST_ID.test(id)) {
    return { ok: false, status: 400, error: 'A valid cost id is required' };
  }

  const type = String(costType || '').trim();
  if (!COST_TYPE_VALUES.includes(type)) {
    return { ok: false, status: 400, error: `Cost type must be one of: ${COST_TYPE_VALUES.join(', ')}` };
  }

  const costDate = String(date || '').trim();
  if (!isIsoDate(costDate)) {
    return { ok: false, status: 400, error: 'Date must be a valid YYYY-MM-DD' };
  }

  const value = typeof amount === 'number' ? amount : parseFloat(String(amount ?? '').replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, status: 400, error: 'Amount must be a number greater than zero' };
  }
  if (value > 1_000_000) {
    return { ok: false, status: 400, error: 'Amount looks wrong — over $1,000,000' };
  }

  const category   = String(categoryCode || '').trim();
  const categories = await readCategories();
  if (!categories.active.has(category)) {
    return { ok: false, status: 400, error: `Unknown or inactive category: ${categoryCode}` };
  }

  const tab = await getTab('PROJECT_COSTS');
  const rowNumber = await findRowById(tab, id);
  if (!rowNumber) {
    return { ok: false, status: 404, error: `No cost found with id ${id}` };
  }

  await updateRanges(tab, [
    { a1: `E${rowNumber}:I${rowNumber}`, values: [
      costDate,                  // E cost_date
      type,                      // F cost_type
      category,                  // G category_code
      safe(description || ''),   // H description
      value,                     // I amount
    ] },
    { a1: `N${rowNumber}:N${rowNumber}`, values: [nowIsoSingapore()] },
  ]);

  const rows    = await readTab(tab, 'A:N', COST_ID, { raw: true });
  const written = rows.find(({ rowNumber: n }) => n === rowNumber);
  if (!written || written.row[COL.id] !== id) {
    return { ok: false, status: 409, error: 'The row moved while saving. Please reload.' };
  }

  return { ok: true, cost: toCost(written, categories.names) };
}

/**
 * Hard-delete a cost row.
 *
 * Chosen over a soft void: this tab is owned by the app, so a removed line leaves no
 * orphan. The trade-offs, accepted deliberately — a deleted cost leaves no audit trail,
 * and deleting the highest id means max+1 reuses it on the next insert. Switching to a
 * soft void later means changing this function and adding one column.
 */
export async function deleteCost(costId) {
  const id = String(costId || '').trim();
  if (!COST_ID.test(id)) {
    return { ok: false, status: 400, error: 'A valid cost id is required' };
  }

  const tab = await getTab('PROJECT_COSTS');
  const result = await deleteRowById(tab, id);

  if (!result.deleted) {
    return result.reason === 'not-found'
      ? { ok: false, status: 404, error: `No cost found with id ${id}` }
      : { ok: false, status: 409, error: 'The row moved while deleting. Please reload and try again.' };
  }

  return { ok: true, id };
}

/**
 * Mark every cost on a project invoiced (or not) in one batch.
 *
 * Rows already in the target state are skipped, so re-running it does not restamp
 * invoiced_date on costs that were billed weeks ago.
 */
export async function setInvoicedForProject(projectCode, invoiced) {
  const code = String(projectCode || '').trim();
  if (!code) return { ok: false, status: 400, error: 'Project is required' };

  const tab  = await getTab('PROJECT_COSTS');
  const rows = await readTab(tab, 'A:N', COST_ID, { raw: true });

  const targets = rows.filter(({ row }) => {
    if (row[COL.projectCode] !== code) return false;
    const current = row[COL.invoiced] === true || String(row[COL.invoiced] || '').toUpperCase() === 'TRUE';
    return current !== invoiced;
  });

  if (!targets.length) {
    return { ok: true, changed: 0 };
  }

  const now  = nowIsoSingapore();
  const date = invoiced ? todaySingapore() : '';

  await updateRanges(tab, targets.flatMap(({ rowNumber }) => ([
    { a1: `J${rowNumber}:K${rowNumber}`, values: [invoiced ? 'TRUE' : 'FALSE', date] },
    { a1: `N${rowNumber}:N${rowNumber}`, values: [now] },
  ])));

  return { ok: true, changed: targets.length };
}
