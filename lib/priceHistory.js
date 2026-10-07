// Price history: every item ever quoted, for the suggestions in the quote editor.
//
// Rows from quotes and VOs are keyed on line_id, which is never reused (lib/quotes.js),
// so saving the same quote again updates its rows in place rather than adding more. A
// line removed from the quote has its row removed too: history mirrors what the saved
// quote says, so a line ID can never carry a stale item. Imported Xero rows are keyed on
// xero_line_id instead and are never touched here.

import {
  getTab, readTab, appendRows, updateRanges, deleteRowsByNumbers, assertHeaders, safe, nextId,
} from '@/lib/sheets';
import { PRICE_HISTORY_COLUMNS } from '@/lib/quoteSchema.mjs';
import { todaySingapore, sheetDateToIso } from '@/lib/dates';

const HISTORY_ID = /^PH-/;
const COL     = Object.fromEntries(PRICE_HISTORY_COLUMNS.map(([field], i) => [field, i]));
const HEADERS = PRICE_HISTORY_COLUMNS.map(([, header]) => header);
const WIDTH   = HEADERS.length;
const LAST    = String.fromCharCode(64 + WIDTH);   // 14 columns → N

async function historyTab() {
  const tab = await getTab('PRICE_HISTORY');
  await assertHeaders(tab, HEADERS);
  return tab;
}

function toEntry({ row, rowNumber }) {
  return {
    id:            row[COL.id] || '',
    description:   row[COL.description] || '',
    service:       row[COL.service] || '',
    unit:          row[COL.unit] || '',
    unitPrice:     Number(row[COL.unitPrice]) || 0,
    qty:           Number(row[COL.qty]) || 0,
    propertyType:  row[COL.propertyType] || '',
    client:        row[COL.client] || '',
    quotedAt:      sheetDateToIso(row[COL.quotedAt]),
    source:        row[COL.source] || '',
    quoteId:       row[COL.quoteId] || '',
    lineId:        row[COL.lineId] || '',
    xeroInvoiceId: row[COL.xeroInvoiceId] || '',
    xeroLineId:    row[COL.xeroLineId] || '',
    rowNumber,
  };
}

/** Every history row. Phase 4 loads this once per screen open. */
export async function listPriceHistory() {
  const tab = await historyTab();
  const rows = await readTab(tab, `A:${LAST}`, HISTORY_ID, { raw: true });
  return rows.map(toEntry);
}

function rowFor(id, line, ctx) {
  return [
    id,
    safe(line.description),
    safe(line.service || ''),
    safe(line.unit || ''),
    line.unitPrice,
    line.qty,
    safe(ctx.propertyType),
    safe(ctx.clientName || ''),
    ctx.quotedAt,
    ctx.source,
    ctx.quoteId,
    line.id,
    '',
    '',
  ];
}

/**
 * Make the history rows for a quote match its saved item lines.
 *
 * Only priced item rows are worth remembering: a title has no price, and a $0 line would
 * only ever suggest $0. Returns counts so the caller can report what changed.
 */
export async function writePriceHistoryForQuote({ quoteId, kind, propertyType, clientName, lines, existing }) {
  const tab = await historyTab();
  // `existing` lets a caller that has already read the tab skip a second read
  const all = existing || (await readTab(tab, `A:${LAST}`, HISTORY_ID, { raw: true })).map(toEntry);
  const mine = all.filter(e => e.quoteId === quoteId);
  const byLine = new Map(mine.map(e => [e.lineId, e]));

  const ctx = { quoteId, propertyType, clientName, quotedAt: todaySingapore(), source: kind === 'vo' ? 'vo' : 'quote' };
  const wanted = lines.filter(l => l.kind === 'item' && l.description && Number(l.unitPrice) > 0);

  const updates = [];
  const inserts = [];
  const ids = all.map(e => e.id);
  const seen = new Set();

  for (const line of wanted) {
    seen.add(line.id);
    const existing = byLine.get(line.id);
    if (existing) {
      updates.push({ a1: `A${existing.rowNumber}:${LAST}${existing.rowNumber}`, values: rowFor(existing.id, line, ctx) });
    } else {
      const id = nextId(ids, 'PH-', 6);
      ids.push(id);
      inserts.push(rowFor(id, line, ctx));
    }
  }
  const stale = mine.filter(e => !seen.has(e.lineId)).map(e => e.rowNumber);

  // Updates and appends touch different rows, so they go together; deletes go last
  // because they shift the row numbers the updates were addressed to.
  await Promise.all([
    updates.length ? updateRanges(tab, updates) : null,
    inserts.length ? appendRows(tab, 'A:A', inserts) : null,
  ]);
  if (stale.length) await deleteRowsByNumbers(tab, stale);

  return { updated: updates.length, added: inserts.length, removed: stale.length };
}
