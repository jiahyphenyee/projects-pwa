// Price memory: suggestions while typing, and the price check under a row. Pure, and run in
// the browser on price history loaded once with the screen — no request per keystroke.
//
// The one rule that must never bend: a price is only ever FILLED from a past quote of the
// same property type. Rows with a blank property type (imported from past Xero invoices)
// are shown for reference and never fill a price.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const IMPORTED_LABEL = 'Past invoice';

/** "2026-09-14" → "Sep 2026". */
export function monthLabel(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

const keyOf = description => String(description || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Group history rows by description, ignoring case and spacing. Rows from `excludeQuoteId`
 * are left out, so a quote never suggests (or price-checks against) its own saved lines.
 *
 * Each item: { key, description, service, unit, quotes: [{ propertyType, price, date, client, source }] }
 * with quotes oldest first. Description, service and unit come from the newest row.
 */
export function buildMemory(rows, { excludeQuoteId } = {}) {
  const groups = new Map();
  for (const r of rows) {
    if (excludeQuoteId && r.quoteId === excludeQuoteId) continue;
    const price = Number(r.unitPrice);
    const key = keyOf(r.description);
    if (!key || !Number.isFinite(price) || price <= 0) continue;
    if (!groups.has(key)) groups.set(key, { key, rows: [] });
    groups.get(key).rows.push(r);
  }

  const items = [];
  for (const { key, rows: list } of groups.values()) {
    list.sort((a, b) => String(a.quotedAt || '').localeCompare(String(b.quotedAt || '')));
    const newest = list[list.length - 1];
    const newestWith = field => [...list].reverse().find(r => r[field])?.[field] || '';
    items.push({
      key,
      description: String(newest.description).trim(),
      service: newestWith('service'),
      unit: newestWith('unit'),
      quotes: list.map(r => ({
        propertyType: r.propertyType || '',
        price: Number(r.unitPrice),
        date: r.quotedAt || '',
        client: r.client || '',
        source: r.source || '',
      })),
    });
  }
  return { items, byKey: new Map(items.map(i => [i.key, i])) };
}

/** The most recent quote for this property type, or null. Blank type never counts. */
export function lastFor(item, propertyType) {
  if (!propertyType) return null;
  for (let i = item.quotes.length - 1; i >= 0; i--) {
    if (item.quotes[i].propertyType === propertyType) return item.quotes[i];
  }
  return null;
}

/** The most recent quote of each OTHER type, imported rows grouped as "Past invoice". */
export function otherTypesLast(item, propertyType) {
  const seen = new Map();
  for (let i = item.quotes.length - 1; i >= 0; i--) {
    const q = item.quotes[i];
    if (q.propertyType && q.propertyType === propertyType) continue;
    const label = q.propertyType || IMPORTED_LABEL;
    if (!seen.has(label)) seen.set(label, q);
  }
  return [...seen.entries()].map(([label, q]) => ({ label, ...q }));
}

/** Words of 2 or more characters, lower case. */
export function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/i).filter(w => w.length >= 2);
}

/**
 * Version 1 matching: an item matches when its description contains every typed word.
 * Only for text of 3 or more characters. At most `limit` results, ordered so the useful
 * ones come first: items with a quote for this property type, then the most recently quoted.
 */
export function suggest(memory, text, propertyType, limit = 4) {
  if (String(text || '').trim().length < 3) return [];
  const ws = words(text);
  if (!ws.length) return [];
  const hits = memory.items.filter(item => ws.every(w => item.key.includes(w)));
  const rank = item => {
    const last = lastFor(item, propertyType);
    const newest = item.quotes[item.quotes.length - 1]?.date || '';
    return [last ? 1 : 0, last?.date || newest];
  };
  hits.sort((a, b) => {
    const [ah, ad] = rank(a);
    const [bh, bd] = rank(b);
    return bh - ah || String(bd).localeCompare(String(ad));
  });
  return hits.slice(0, limit);
}

/**
 * What picking a suggestion changes on a row. The price is filled only from a past quote
 * of this property type, and only when the row has no price yet: a price already typed is
 * never replaced.
 */
export function applyPick(row, item, propertyType) {
  const last = lastFor(item, propertyType);
  const change = { description: item.description, suggestDone: item.description };
  if (item.service) change.service = item.service;
  if (item.unit) change.unit = item.unit;
  if (last && String(row.unitPrice ?? '').trim() === '') change.unitPrice = last.price.toFixed(2);
  const showUnit = item.unit === 'sqft' || item.unit === 'ft run';
  return { change, showUnit };
}

/**
 * The price check line under a row whose description exactly matches a past item.
 * Returns null when there is no exact match.
 *   { kind: 'last', last }                  price blank, a quote exists for this type
 *   { kind: 'higher' | 'lower', diff, last } price entered and differs
 *   { kind: 'same', last }                  price entered and equal
 *   { kind: 'none', others }                no quote for this type; other types for reference
 */
export function priceCheck(memory, description, unitPrice, propertyType) {
  const item = memory.byKey.get(keyOf(description));
  if (!item) return null;
  const last = lastFor(item, propertyType);
  if (!last) return { kind: 'none', item, others: otherTypesLast(item, propertyType) };

  const typed = String(unitPrice ?? '').trim();
  if (typed === '') return { kind: 'last', item, last };
  const cents = Math.round(Number(typed) * 100) - Math.round(last.price * 100);
  if (cents === 0) return { kind: 'same', item, last };
  return { kind: cents > 0 ? 'higher' : 'lower', item, last, diff: Math.abs(cents) / 100 };
}
