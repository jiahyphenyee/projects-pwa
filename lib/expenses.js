// READ-ONLY view of the receipted Expenses tab.
//
// That tab belongs to the sibling expense-pwa, which creates the rows and pushes them
// to Xero. This app must never write to it and makes no Xero calls of its own — it
// reads only so a project's total cost isn't understated by leaving receipted spend out.

import { getTab, readTab, assertHeaders } from '@/lib/sheets';
import { sheetDateToIso } from '@/lib/dates';

const EXPENSE_ID = /^EXP-/;

// Receipted expenses column order (A:T), paired with the header each position must
// carry. `null` marks a column this app does not read — that tab belongs to expense-pwa.
// P (xero_bill_id) is read only to show the receipt attached to that bill (JY, 2026-10-28).
// T (`cost_type`) is chosen on the expense app's form and splits a job's cost; it is
// blank on every row submitted before 2026-10-15.
const COLUMNS = [
  ['id',          'expense_id'],
  ['date',        'date'],
  ['projectCode', 'project_code'],
  ['address',     'display_address'],
  ['category',    'category'],
  ['description', 'description'],
  ['amount',      'amount'],
  [null,          null],             // H payee_id
  ['payeeName',   'payee_name'],
  [null,          null],             // J payee_type
  [null,          null],             // K receipt_urls
  ['submittedBy', 'submitted_by'],
  ['adminStatus', 'admin_status'],
  [null,          null],             // N approved_by
  [null,          null],             // O approved_date
  ['xeroBillId',  'xero_bill_id'],   // P — the Xero bill (draft or approved) carrying the receipt
  [null,          null],             // Q xero_sync_status
  [null,          null],             // R xero_sync_error
  [null,          null],             // S receipt_status
  ['costType',    'cost_type'],
];

const COL = Object.fromEntries(
  COLUMNS.map(([field], i) => [field, i]).filter(([field]) => field !== null)
);
const HEADERS = COLUMNS.map(([, header]) => header);

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Receipted expenses booked against a project.
 *
 * Rejected claims are excluded — an admin rejecting a claim means the company is not
 * carrying that cost, so counting it would overstate the project. Pending ones are
 * included: they have been spent, they just haven't been reviewed yet.
 */
export async function listReceiptedExpenses(projectCode) {
  const tab = await getTab('EXPENSES');
  await assertHeaders(tab, HEADERS);
  const rows = await readTab(tab, 'A:T', EXPENSE_ID, { raw: true });

  return rows
    .filter(({ row }) => row[COL.projectCode] === projectCode)
    .filter(({ row }) => String(row[COL.adminStatus] || '').toLowerCase() !== 'rejected')
    .map(({ row, rowNumber }) => ({
      id:          row[COL.id]          || '',
      date:        sheetDateToIso(row[COL.date]),
      category:    row[COL.category]    || '',
      description: row[COL.description] || '',
      amount:      parseAmount(row[COL.amount]),
      payeeName:   row[COL.payeeName]   || '',
      submittedBy: row[COL.submittedBy] || '',
      costType:    String(row[COL.costType] || '').trim(),
      xeroBillId:  String(row[COL.xeroBillId] || '').trim(),
      status:      String(row[COL.adminStatus] || 'pending').toLowerCase(),
      rowNumber,
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
}

/** One receipted expense by id, from any project, or null. Read-only. */
export async function findReceiptedExpense(expenseId) {
  const tab = await getTab('EXPENSES');
  await assertHeaders(tab, HEADERS);
  const rows = await readTab(tab, 'A:T', EXPENSE_ID, { raw: true });
  const hit = rows.find(({ row }) => String(row[COL.id] || '').trim() === expenseId);
  if (!hit) return null;
  return { id: expenseId, projectCode: hit.row[COL.projectCode] || '', xeroBillId: String(hit.row[COL.xeroBillId] || '').trim() };
}
