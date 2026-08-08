// READ-ONLY view of the receipted Expenses tab.
//
// That tab belongs to the sibling expense-pwa, which creates the rows and pushes them
// to Xero. This app must never write to it and makes no Xero calls of its own — it
// reads only so a project's total cost isn't understated by leaving receipted spend out.

import { getTab, readTab } from '@/lib/sheets';
import { sheetDateToIso } from '@/lib/dates';

const EXPENSE_ID = /^EXP-/;

// Expenses tab column order
const COL = {
  id: 0, date: 1, projectCode: 2, address: 3, category: 4, description: 5,
  amount: 6, payeeName: 8, submittedBy: 11, adminStatus: 12,
};

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
  const tab  = await getTab('EXPENSES');
  const rows = await readTab(tab, 'A:R', EXPENSE_ID, { raw: true });

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
      status:      String(row[COL.adminStatus] || 'pending').toLowerCase(),
      rowNumber,
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
}
