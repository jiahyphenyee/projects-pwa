// Non-receipted project costs — the tab this app owns outright.
//
// Distinct from the Expenses tab, which holds receipted expenses and is pushed to Xero
// by the sibling expense-pwa. This app never writes to Expenses and makes no Xero calls.

import { getTab, readTab, writeAfterLast, updateRange, updateRanges, findRowById, deleteRowById, safe, nextId } from '@/lib/sheets';
import { COST_TYPE_VALUES } from '@/lib/constants';
import { nowIsoSingapore, todaySingapore, isIsoDate, sheetDateToIso } from '@/lib/dates';

const COST_ID = /^PC-/;
const CATEGORY_CODE = /^[A-Z]{3,6}$/;

// Project costs tab column order (A:O)
const COL = {
  id: 0, createdAt: 1, projectCode: 2, address: 3, costDate: 4,
  costType: 5, categoryCode: 6, categoryName: 7, description: 8, amount: 9,
  invoiced: 10, invoicedDate: 11, invoiceRef: 12, createdBy: 13, updatedAt: 14,
};

function toCost({ row, rowNumber }) {
  return {
    id:           row[COL.id]           || '',
    createdAt:    row[COL.createdAt]    || '',
    projectCode:  row[COL.projectCode]  || '',
    address:      row[COL.address]      || '',
    date:         sheetDateToIso(row[COL.costDate]),
    costType:     row[COL.costType]     || '',
    categoryCode: row[COL.categoryCode] || '',
    categoryName: row[COL.categoryName] || '',
    description:  row[COL.description]  || '',
    amount:       parseAmount(row[COL.amount]),
    invoiced:     row[COL.invoiced] === true || String(row[COL.invoiced] || '').toUpperCase() === 'TRUE',
    invoicedDate: sheetDateToIso(row[COL.invoicedDate]),
    invoiceRef:   row[COL.invoiceRef]    || '',
    createdBy:    row[COL.createdBy]     || '',
    rowNumber,
  };
}

/** Sheets may hand back "1,234.50" or "$1,234.50" depending on cell formatting. */
function parseAmount(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function listCosts(projectCode) {
  const tab  = await getTab('PROJECT_COSTS');
  const rows = await readTab(tab, 'A:O', COST_ID, { raw: true });
  const costs = rows.map(toCost);
  return projectCode ? costs.filter(c => c.projectCode === projectCode) : costs;
}

export async function createCost({
  projectCode, displayAddress, date, costType, categoryCode, description, amount, createdBy,
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
  const categoriesTab = await getTab('CATEGORIES');
  const categoryRows  = await readTab(categoriesTab, 'A:C', CATEGORY_CODE);
  const category = categoryRows.find(({ row }) =>
    row[0] === String(categoryCode || '').trim() && String(row[2] || '').toUpperCase() === 'TRUE'
  );
  if (!category) {
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
    id,                              // A cost_id
    now,                             // B created_at
    safe(code),                      // C project_code
    safe(displayAddress || ''),      // D display_address — snapshot at entry time
    costDate,                        // E cost_date
    type,                            // F cost_type
    category.row[0],                 // G category_code
    safe(category.row[1] || ''),     // H category_name — plain text, not a formula
    safe(description || ''),         // I description
    value,                           // J amount
    'FALSE',                         // K invoiced
    '',                              // L invoiced_date
    '',                              // M invoice_ref
    safe(createdBy || ''),           // N created_by
    now,                             // O updated_at
  ]);

  // Row selection is not atomic here, so confirm our row is the one that landed
  const check = await readTab(tab, 'A:O', COST_ID, { raw: true });
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
    cost: { ...toCost(written), rowNumber },
  };
}

/**
 * Tick or untick a cost as invoiced.
 *
 * Writes K:L (invoiced + invoiced_date) and O (updated_at) as two ranges rather than
 * one K:O block, because M (invoice_ref) and N (created_by) sit between them and must
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

  await updateRange(tab, `K${rowNumber}:L${rowNumber}`, [
    invoiced ? 'TRUE' : 'FALSE',
    invoiced ? todaySingapore() : '',
  ]);
  await updateRange(tab, `O${rowNumber}:O${rowNumber}`, [nowIsoSingapore()]);

  const rows    = await readTab(tab, 'A:O', COST_ID, { raw: true });
  const written = rows.find(({ rowNumber: n }) => n === rowNumber);
  if (!written || written.row[COL.id] !== id) {
    return { ok: false, status: 409, error: 'The row moved while saving. Please reload.' };
  }

  return { ok: true, cost: toCost(written) };
}

/**
 * Edit a cost's own fields.
 *
 * Rewrites E:J only — the date, type, category and amount. Deliberately leaves
 * project_code and display_address (a cost does not move between projects here),
 * K:N (invoiced state, invoice_ref, created_by), and A:B (id and created_at). So
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

  const categoriesTab = await getTab('CATEGORIES');
  const categoryRows  = await readTab(categoriesTab, 'A:C', CATEGORY_CODE);
  const category = categoryRows.find(({ row }) =>
    row[0] === String(categoryCode || '').trim() && String(row[2] || '').toUpperCase() === 'TRUE'
  );
  if (!category) {
    return { ok: false, status: 400, error: `Unknown or inactive category: ${categoryCode}` };
  }

  const tab = await getTab('PROJECT_COSTS');
  const rowNumber = await findRowById(tab, id);
  if (!rowNumber) {
    return { ok: false, status: 404, error: `No cost found with id ${id}` };
  }

  await updateRanges(tab, [
    { a1: `E${rowNumber}:J${rowNumber}`, values: [
      costDate,                    // E cost_date
      type,                        // F cost_type
      category.row[0],             // G category_code
      safe(category.row[1] || ''), // H category_name
      safe(description || ''),     // I description
      value,                       // J amount
    ] },
    { a1: `O${rowNumber}:O${rowNumber}`, values: [nowIsoSingapore()] },
  ]);

  const rows    = await readTab(tab, 'A:O', COST_ID, { raw: true });
  const written = rows.find(({ rowNumber: n }) => n === rowNumber);
  if (!written || written.row[COL.id] !== id) {
    return { ok: false, status: 409, error: 'The row moved while saving. Please reload.' };
  }

  return { ok: true, cost: toCost(written) };
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
  const rows = await readTab(tab, 'A:O', COST_ID, { raw: true });

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
    { a1: `K${rowNumber}:L${rowNumber}`, values: [invoiced ? 'TRUE' : 'FALSE', date] },
    { a1: `O${rowNumber}:O${rowNumber}`, values: [now] },
  ])));

  return { ok: true, changed: targets.length };
}
