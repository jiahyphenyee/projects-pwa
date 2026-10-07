// Phase 2: copy the line items of every past Xero sales invoice into Price history.
//
//   node scripts/import-price-history.mjs --dry-run   # read Xero, count, write nothing
//   node scripts/import-price-history.mjs             # write the new rows
//
// Read-only against Xero. Idempotent: a row is keyed on xero_invoice_id + xero_line_id, so a
// second run adds nothing. Imported rows have a blank property_type, which the suggestion
// rules treat as "reference only — never fills a price".
//
// What is skipped, and counted as skipped: VOIDED and DELETED invoices; description-only
// lines (no quantity or no unit amount); negative lines (discounts); lines with no
// description.

import { readTab, appendRows, safe, nextId, tabName, xero, q, readRange } from './_shared.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 500;
const STATUSES = 'DRAFT,SUBMITTED,AUTHORISED,PAID';   // everything but VOIDED and DELETED

const historyTab    = await tabName('PRICE_HISTORY', 'Price history');
const categoriesTab = await tabName('CATEGORIES', 'Categories');

// Xero "Service" option name → Categories code, via the xero_tracking_option column, so an
// imported row carries the same code a quote row would.
const categoryRows = await readRange(`${q(categoriesTab)}!A:E`);
const codeByOption = new Map();
for (const r of categoryRows.slice(1)) {
  const code = String(r[0] ?? '').trim();
  const option = String(r[4] ?? '').trim().toLowerCase();
  if (/^[A-Z]{3,6}$/.test(code) && option) codeByOption.set(option, code);
}

const existing = await readTab(historyTab, 'A:N', /^PH-/, { raw: true });
const ids = existing.map(({ row }) => row[0]);
const have = new Set(existing.map(({ row }) => `${row[12] ?? ''}|${row[13] ?? ''}`).filter(k => k !== '|'));
console.log(`Price history has ${existing.length} rows, ${have.size} of them imported from Xero`);

const api = xero();
const counts = { invoices: 0, lines: 0, written: 0, skipped: 0, alreadyThere: 0, unmappedService: new Set() };
let pending = [];

async function flush() {
  if (!pending.length) return;
  if (!DRY_RUN) await appendRows(historyTab, pending);
  console.log(`${DRY_RUN ? 'would write' : 'wrote'} ${pending.length} rows`);
  pending = [];
}

for await (const page of api.pages('/Invoices', 'Invoices', { where: 'Type=="ACCREC"', Statuses: STATUSES, order: 'Date ASC' })) {
  for (const inv of page) {
    counts.invoices++;
    const date = String(inv.DateString || '').slice(0, 10);
    const client = inv.Contact?.Name || '';

    for (const line of inv.LineItems || []) {
      counts.lines++;
      const description = String(line.Description ?? '').trim();
      const qty = Number(line.Quantity);
      const price = Number(line.UnitAmount);
      if (!description || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
        counts.skipped++;
        continue;
      }
      const key = `${inv.InvoiceID}|${line.LineItemID}`;
      if (have.has(key)) { counts.alreadyThere++; continue; }
      have.add(key);

      const option = (line.Tracking || []).find(t => t.Name === 'Service')?.Option || '';
      let service = '';
      if (option) {
        service = codeByOption.get(option.toLowerCase()) || '';
        if (!service) counts.unmappedService.add(option);
      }

      const id = nextId(ids, 'PH-', 6);
      ids.push(id);
      pending.push([
        id, safe(description), service, '', price, qty, '', safe(client), date,
        'xero_import', '', '', inv.InvoiceID, line.LineItemID,
      ]);
      counts.written++;
      if (pending.length >= BATCH) await flush();
    }
  }
}
await flush();

console.log(`\nInvoices read: ${counts.invoices}`);
console.log(`Lines read:    ${counts.lines}`);
console.log(`Rows ${DRY_RUN ? 'to write' : 'written'}:  ${counts.written}`);
console.log(`Already there: ${counts.alreadyThere}`);
console.log(`Skipped:       ${counts.skipped} (description-only, zero or negative lines)`);
if (counts.unmappedService.size) {
  console.log(`Service options with no Categories code (left blank): ${[...counts.unmappedService].join(', ')}`);
}
