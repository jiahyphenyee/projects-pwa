// Sales invoices and credit notes from Xero, for the project screen's invoiced, collected
// and outstanding figures. Read-only: nothing here writes to Xero, so dry run does not
// apply — reads are always real (lib/xero.js).
//
// Xero has no project field, so a project's invoices are found by Reference. That needs
// every sales document in the organisation, not a filtered query: a hand-raised invoice
// may carry the address in a different format, which only invoicesForProject() in
// lib/projectFigures.mjs can match. The whole list is a couple of pages, fetched once
// and memoised, so opening several projects in a row costs Xero nothing extra.

import { getXero } from '@/lib/xero';

const TTL_MS = 10 * 60 * 1000;

// Voided and deleted invoices never were invoices. Drafts are read so the project can list
// and download them, but lib/projectFigures.mjs never counts one in any total. Credit
// notes stay live-only: a draft credit has not reduced anything yet.
const INVOICE_STATUSES = 'DRAFT,SUBMITTED,AUTHORISED,PAID';
const CREDIT_STATUSES  = 'AUTHORISED,PAID';

let cache = null;   // { at, promise }

/** Xero's date as YYYY-MM-DD: DateString when present, else the /Date(ms+0000)/ form. */
function xeroDate(doc, field) {
  const s = doc[`${field}String`];
  if (s) return String(s).slice(0, 10);
  const ms = String(doc[field] || '').match(/\/Date\((\d+)/);
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : '';
}

function toInvoice(inv) {
  return {
    kind:      'invoice',
    id:        inv.InvoiceID,
    number:    inv.InvoiceNumber || '',
    reference: inv.Reference || '',
    contact:   inv.Contact?.Name || '',
    status:    inv.Status,
    date:      xeroDate(inv, 'Date'),
    dueDate:   xeroDate(inv, 'DueDate'),
    total:     Number(inv.Total) || 0,
    due:       Number(inv.AmountDue) || 0,
  };
}

function toCredit(cn) {
  return {
    kind:      'credit',
    id:        cn.CreditNoteID,
    number:    cn.CreditNoteNumber || '',
    reference: cn.Reference || '',
    contact:   cn.Contact?.Name || '',
    status:    cn.Status,
    date:      xeroDate(cn, 'Date'),
    dueDate:   '',
    total:     Number(cn.Total) || 0,
    due:       Number(cn.RemainingCredit) || 0,
  };
}

async function collect(path, key, where, map, statuses) {
  const out = [];
  for await (const page of getXero().pages(path, key, { where, Statuses: statuses })) {
    out.push(...page.map(map));
  }
  return out;
}

async function fetchAll() {
  const [invoices, credits] = await Promise.all([
    collect('/Invoices', 'Invoices', 'Type=="ACCREC"', toInvoice, INVOICE_STATUSES),
    // Credit notes are a separate endpoint. If this connection cannot read them, the
    // figures are still right for every project that has none — so say so, don't fail.
    collect('/CreditNotes', 'CreditNotes', 'Type=="ACCRECCREDIT"', toCredit, CREDIT_STATUSES)
      .then(list => ({ list, ok: true }))
      .catch(err => {
        console.error('Xero credit notes read error:', err.message);
        return { list: [], ok: false };
      }),
  ]);
  return { docs: [...invoices, ...credits.list], creditNotesRead: credits.ok, fetchedAt: Date.now() };
}

/**
 * Every sales invoice (drafts included) and live credit note in the organisation, normalised for
 * lib/projectFigures.mjs. Memoised for ten minutes; a failed read is not cached, so the
 * next request tries again.
 */
export function listSalesDocuments() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetchAll();
  cache = { at: Date.now(), promise };
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}

/**
 * One sales invoice as a PDF, straight from Xero, drafts included. A read: nothing is
 * written to Xero, so dry run does not apply. Returns { bytes, fileName } or null when
 * Xero has no such invoice.
 */
export async function invoicePdf(invoiceId) {
  const { docs } = await listSalesDocuments();
  const doc = docs.find(d => d.kind === 'invoice' && d.id === invoiceId);
  if (!doc) return null;
  const bytes = await getXero().get(`/Invoices/${encodeURIComponent(invoiceId)}`, {
    headers: { Accept: 'application/pdf' },
    binary: true,
  });
  const name = (doc.number || 'invoice').replace(/[^\w.-]+/g, '_');
  return { bytes, fileName: `${name}.pdf` };
}
