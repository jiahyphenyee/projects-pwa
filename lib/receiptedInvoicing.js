// Invoiced tracking for receipted expenses.
//
// A receipted expense lives in the `Receipted expenses` tab, which belongs to the sibling
// expense-pwa and is pushed to Xero — this app must never write to it. But we still need
// to record whether that spend has been billed on to the client, which is a fact about
// OUR invoicing, not about the expense claim.
//
// So the state lives in its own tab, keyed by `expense_id`, and is joined on read. That
// keeps `Receipted expenses` strictly read-only (see lib/expenses.js) while giving this
// app a column it fully owns.
//
// Non-receipted costs do NOT use this tab — they carry their own invoiced state in
// `Project costs` J:L, written by lib/costs.js. Both are normalised to the same shape by
// the costs route, so the UI never has to know which is which.

import {
  getTab, readTab, updateRanges, writeAfterLast, findRowById, assertHeaders, safe,
} from '@/lib/sheets';
import { nowIsoSingapore, todaySingapore, sheetDateToIso } from '@/lib/dates';
import { refToWrite } from '@/lib/costBilling.mjs';

const EXPENSE_ID = /^EXP-/;

// Row 1 header, row 2 the `ℹ` note, data from row 3 — the same shape as `Project costs`.
// This MUST stay below the note row: writeAfterLast falls back to it when the tab holds no
// data yet, so a 2 here would overwrite the note with the very first tick. Reads are safe
// either way, since readTab filters on the EXP- prefix.
const FIRST_DATA_ROW = 3;

// Column order (A:E), paired with the header each position must carry. One list, two
// derived views — the indices read by, and the headers asserted against — so they cannot
// drift apart. Same pattern as lib/costs.js and lib/expenses.js.
const COLUMNS = [
  ['id',           'expense_id'],
  ['invoiced',     'invoiced'],
  ['invoicedDate', 'invoiced_date'],
  ['invoiceRef',   'invoice_ref'],
  ['updatedAt',    'updated_at'],
];

const COL     = Object.fromEntries(COLUMNS.map(([field], i) => [field, i]));
const HEADERS = COLUMNS.map(([, header]) => header);

/**
 * True when the workbook has no such tab.
 *
 * The API reports a missing tab as a 400 on the range rather than a 404, and the message
 * is the only thing that distinguishes it from a malformed range. Matched narrowly on
 * purpose: every other failure must keep propagating, because quietly treating a broken
 * read as "nothing is invoiced" would show wrong money as though it were right.
 */
function isMissingTab(err) {
  return /unable to parse range/i.test(err?.message || '');
}

function missingTabMessage(tabName) {
  return (
    `The "${tabName}" tab is missing from the workbook. Create it with the headers ` +
    `${HEADERS.join(', ')} in row 1, and set TAB_RECEIPTED_INVOICING in System config.`
  );
}

/** The invoicing tab, with its column layout verified once per process. */
async function invoicingTab() {
  const tab = await getTab('RECEIPTED_INVOICING');
  await assertHeaders(tab, HEADERS);
  return tab;
}

function readFlag(value) {
  return value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';
}

function toEntry({ row, rowNumber }) {
  return {
    id:           String(row[COL.id] ?? '').trim(),
    invoiced:     readFlag(row[COL.invoiced]),
    invoicedDate: sheetDateToIso(row[COL.invoicedDate]),
    invoiceRef:   row[COL.invoiceRef] || '',
    rowNumber,
  };
}

/**
 * Every recorded invoicing state, as expense_id → entry.
 *
 * A row absent from this tab means "not invoiced" — rows are written lazily on the first
 * tick, so the tab holds only expenses someone has actually acted on.
 *
 * Degrades to an empty map if the tab does not exist yet, so a workbook that hasn't been
 * set up still renders its costs instead of failing the whole project screen. Writes, by
 * contrast, fail loudly: silently dropping a tick would be a lie about the books.
 */
export async function readInvoicingMap() {
  let tab;
  try {
    tab = await invoicingTab();
    const rows = await readTab(tab, 'A:E', EXPENSE_ID, { raw: true });
    return new Map(rows.map(r => {
      const entry = toEntry(r);
      return [entry.id, entry];
    }));
  } catch (err) {
    if (isMissingTab(err)) {
      console.warn('[receiptedInvoicing]', missingTabMessage(tab || 'Receipted expense invoicing'));
      return new Map();
    }
    throw err;
  }
}

/**
 * Tick or untick one receipted expense as invoiced.
 *
 * Upserts by `expense_id`: an existing row is rewritten in place, a new one is appended.
 * `invoiced_date` is stamped on tick and cleared on untick, so it never describes a state
 * the row is not in — the same contract as setInvoiced() on a project cost.
 *
 * `invoice_ref` (D) is written blank and never touched afterwards, mirroring how
 * `Project costs` L is reserved for a future invoicing screen.
 */
export async function setExpenseInvoiced(expenseId, invoiced, invoiceRef) {
  const id = String(expenseId || '').trim();
  if (!EXPENSE_ID.test(id)) {
    return { ok: false, status: 400, error: 'A valid expense id is required' };
  }

  // Confirm the expense is real before recording anything against it. This tab is joined
  // on read, so a row for an id that is not in `Receipted expenses` would never surface
  // anywhere — invisible rot rather than a visible error. This is a read of column A
  // only; the tab itself stays untouched.
  const expensesTab = await getTab('EXPENSES');
  if (!(await findRowById(expensesTab, id))) {
    return { ok: false, status: 404, error: `No receipted expense found with id ${id}` };
  }

  let tab;
  try {
    tab = await invoicingTab();
    const rows     = await readTab(tab, 'A:E', EXPENSE_ID, { raw: true });
    const existing = rows.map(toEntry).find(e => e.id === id);

    const now  = nowIsoSingapore();
    const date = invoiced ? todaySingapore() : '';
    const flag = invoiced ? 'TRUE' : 'FALSE';

    let rowNumber;
    if (existing) {
      rowNumber = existing.rowNumber;
      // B:C and E as two ranges, not one B:E block — D (invoice_ref) sits between them
      // and must not be clobbered by a plain tick. D is written only when a ref is given
      // (billed direct) or the cost is unticked (no invoice of any kind any more).
      const ref = refToWrite(invoiced, invoiceRef);
      await updateRanges(tab, ref === undefined ? [
        { a1: `B${rowNumber}:C${rowNumber}`, values: [flag, date] },
        { a1: `E${rowNumber}:E${rowNumber}`, values: [now] },
      ] : [
        { a1: `B${rowNumber}:E${rowNumber}`, values: [flag, date, safe(ref), now] },
      ]);
    } else {
      rowNumber = await writeAfterLast(
        tab,
        EXPENSE_ID,
        [safe(id), flag, date, safe(refToWrite(invoiced, invoiceRef) || ''), now],
        { firstDataRow: FIRST_DATA_ROW },
      );
    }

    // writeAfterLast picks its row non-atomically, so confirm ours is the one that landed
    const check   = await readTab(tab, 'A:E', EXPENSE_ID, { raw: true });
    const written = check.find(({ rowNumber: n }) => n === rowNumber);
    if (!written || String(written.row[COL.id] ?? '').trim() !== id) {
      return { ok: false, status: 409, error: 'The row moved while saving. Please reload.' };
    }

    return { ok: true, entry: toEntry(written) };

  } catch (err) {
    if (isMissingTab(err)) {
      return { ok: false, status: 500, error: missingTabMessage(tab || 'Receipted expense invoicing') };
    }
    throw err;
  }
}

/**
 * Mark a set of receipted expenses invoiced (or not) in one batch.
 *
 * Rows already in the target state are skipped, so re-running never restamps an
 * `invoiced_date` on something billed weeks ago. Unticking an expense that has no row is
 * also a no-op: absent already means not invoiced, and writing FALSE rows for every
 * untouched expense would fill the tab with noise.
 */
export async function setExpenseInvoicedForProject(expenseIds, invoiced) {
  const ids = [...new Set(
    (expenseIds || []).map(v => String(v || '').trim()).filter(id => EXPENSE_ID.test(id))
  )];
  if (!ids.length) return { ok: true, changed: 0 };

  let tab;
  try {
    tab = await invoicingTab();
    const rows = await readTab(tab, 'A:E', EXPENSE_ID, { raw: true });
    const byId = new Map(rows.map(r => { const e = toEntry(r); return [e.id, e]; }));

    const now  = nowIsoSingapore();
    const date = invoiced ? todaySingapore() : '';
    const flag = invoiced ? 'TRUE' : 'FALSE';

    // New rows go in a contiguous block after the last existing one. Computed here rather
    // than by calling writeAfterLast per id, so twenty expenses stay one round trip.
    let nextRow = Math.max(FIRST_DATA_ROW, ...rows.map(r => r.rowNumber + 1));

    const edits = [];
    let changed = 0;   // rows touched, not ranges written — an existing row takes two
    for (const id of ids) {
      const existing = byId.get(id);
      if (existing) {
        if (existing.invoiced === invoiced) continue;
        edits.push({ a1: `B${existing.rowNumber}:C${existing.rowNumber}`, values: [flag, date] });
        edits.push({ a1: `E${existing.rowNumber}:E${existing.rowNumber}`, values: [now] });
      } else {
        if (!invoiced) continue;
        edits.push({ a1: `A${nextRow}:E${nextRow}`, values: [safe(id), flag, date, '', now] });
        nextRow++;
      }
      changed++;
    }

    if (!edits.length) return { ok: true, changed: 0 };

    await updateRanges(tab, edits);
    return { ok: true, changed };

  } catch (err) {
    if (isMissingTab(err)) {
      return { ok: false, status: 500, error: missingTabMessage(tab || 'Receipted expense invoicing') };
    }
    throw err;
  }
}
