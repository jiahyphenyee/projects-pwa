// Quotes made in Xero before this app wrote quotes, shown on a project's Quotes page with
// a PDF. Read-only: nothing here writes to Xero, so dry run does not apply.
//
// Matched to projects the way invoices are (lib/projectFigures.mjs → assignDocuments), by
// Reference. Reading Xero quotes needs a permission this app's connection may not have; a
// refusal is reported as `noPermission` so the page can say so instead of failing.

import { getXero } from '@/lib/xero';

const TTL_MS = 10 * 60 * 1000;
let cache = null;   // { at, promise }

function xeroDate(doc, field) {
  const s = doc[`${field}String`];
  if (s) return String(s).slice(0, 10);
  const ms = String(doc[field] || '').match(/\/Date\((\d+)/);
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : '';
}

const toQuote = q => ({
  kind:      'quote',
  id:        q.QuoteID,
  number:    q.QuoteNumber || '',
  reference: q.Reference || '',
  title:     q.Title || '',
  contact:   q.Contact?.Name || '',
  status:    q.Status || '',
  date:      xeroDate(q, 'Date'),
  total:     Number(q.Total) || 0,
});

async function fetchAll() {
  const out = [];
  try {
    for await (const page of getXero().pages('/Quotes', 'Quotes')) out.push(...page.map(toQuote));
  } catch (err) {
    if (err.status === 401 || err.status === 403) return { quotes: [], noPermission: true, fetchedAt: Date.now() };
    throw err;
  }
  return { quotes: out.filter(q => q.status !== 'DELETED'), noPermission: false, fetchedAt: Date.now() };
}

/** Every Xero quote, memoised for ten minutes. A failed read is not cached. */
export function listXeroQuotes() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetchAll();
  cache = { at: Date.now(), promise };
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}

/** One Xero quote as a PDF, or null when Xero has no such quote. */
export async function xeroQuotePdf(quoteId) {
  const { quotes } = await listXeroQuotes();
  const q = quotes.find(x => x.id === quoteId);
  if (!q) return null;
  const bytes = await getXero().get(`/Quotes/${encodeURIComponent(quoteId)}`, {
    headers: { Accept: 'application/pdf' },
    binary: true,
  });
  return { bytes, fileName: `${(q.number || 'quote').replace(/[^\w.-]+/g, '_')}.pdf` };
}
