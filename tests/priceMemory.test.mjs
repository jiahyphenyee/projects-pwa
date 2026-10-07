import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemory, suggest, lastFor, applyPick, priceCheck, words, monthLabel, IMPORTED_LABEL,
} from '../lib/priceMemory.mjs';

const row = (description, propertyType, unitPrice, quotedAt, extra = {}) => ({
  description, propertyType, unitPrice, quotedAt, client: 'Client ' + quotedAt, service: 'ELEC', unit: 'pcs', source: propertyType ? 'quote' : 'xero_import', ...extra,
});

const history = [
  row('Supply & install 13A double socket outlet', 'HDB', 85, '2026-03-02'),
  row('Supply & install 13A double socket outlet', 'Condo', 95, '2026-07-10'),
  row('supply & install 13a DOUBLE socket outlet ', 'HDB', 88, '2026-09-01'),   // same item, other casing
  row('Supply & install 13A single socket outlet', 'Condo', 70, '2026-08-20'),
  row('Supply & install 13A single socket outlet', '', 60, '2026-11-12'),        // imported, future date
  row('Gypsum board partition wall', 'HDB', 6.5, '2026-02-01', { service: 'CEIL', unit: 'sqft' }),
  row('Old socket repair', '', 40, '2025-01-01'),
  row('Own line on this quote', 'HDB', 10, '2026-10-01', { quoteId: 'Q-0009' }),
  row('Zero priced', 'HDB', 0, '2026-10-01'),
];
const memory = buildMemory(history, { excludeQuoteId: 'Q-0009' });

test('groups by description ignoring case and spacing; skips own quote and unpriced rows', () => {
  const keys = memory.items.map(i => i.key);
  assert.equal(keys.filter(k => k.includes('double socket')).length, 1);
  assert.ok(!keys.some(k => k.includes('own line')));
  assert.ok(!keys.some(k => k.includes('zero priced')));
  assert.equal(memory.byKey.get('supply & install 13a double socket outlet').quotes.length, 3);
});

test('"13a socket" on an HDB quote suggests the socket items, HDB-priced first', () => {
  const hits = suggest(memory, '13a socket', 'HDB');
  assert.deepEqual(hits.map(h => h.key), [
    'supply & install 13a double socket outlet',   // has an HDB quote
    'supply & install 13a single socket outlet',
  ]);
  assert.equal(lastFor(hits[0], 'HDB').price, 88);
  assert.equal(lastFor(hits[1], 'HDB'), null);
});

test('matching needs every word of 2+ characters, at least 3 characters typed, at most 4 results', () => {
  assert.deepEqual(words('13A x socket'), ['13a', 'socket']);
  assert.equal(suggest(memory, 'so', 'HDB').length, 0);
  assert.equal(suggest(memory, 'socket repair', 'HDB').length, 1);
  assert.equal(suggest(memory, 'socket gypsum', 'HDB').length, 0);
  const many = buildMemory(Array.from({ length: 9 }, (_, i) => row(`tile type ${i}`, 'HDB', 5, '2026-01-01')));
  assert.equal(suggest(many, 'tile', 'HDB').length, 4);
});

test('imported rows never count as a price for any type', () => {
  const single = memory.byKey.get('supply & install 13a single socket outlet');
  assert.equal(lastFor(single, ''), null);
  assert.equal(lastFor(single, 'HDB'), null);
  assert.equal(lastFor(memory.byKey.get('old socket repair'), 'HDB'), null);
});

test('picking fills the last price for this type only, and only into a blank price', () => {
  const dbl = memory.byKey.get('supply & install 13a double socket outlet');
  assert.equal(applyPick({ unitPrice: '' }, dbl, 'HDB').change.unitPrice, '88.00');
  assert.equal(applyPick({ unitPrice: '' }, dbl, 'Commercial').change.unitPrice, undefined);
  assert.equal(applyPick({ unitPrice: '90.00' }, dbl, 'HDB').change.unitPrice, undefined);
  const single = memory.byKey.get('supply & install 13a single socket outlet');
  assert.equal(applyPick({ unitPrice: '' }, single, 'HDB').change.unitPrice, undefined);
});

test('picking an item priced per sqft or ft run turns on Show unit', () => {
  assert.equal(applyPick({ unitPrice: '' }, memory.byKey.get('gypsum board partition wall'), 'HDB').showUnit, true);
  assert.equal(applyPick({ unitPrice: '' }, memory.byKey.get('old socket repair'), 'HDB').showUnit, false);
});

test('price check: blank, higher, lower, same, and no quote for this type', () => {
  const d = 'Supply & install 13A double socket outlet';
  assert.equal(priceCheck(memory, d, '', 'HDB').kind, 'last');
  assert.deepEqual([priceCheck(memory, d, '91.50', 'HDB').kind, priceCheck(memory, d, '91.50', 'HDB').diff], ['higher', 3.5]);
  assert.deepEqual([priceCheck(memory, d, '80', 'HDB').kind, priceCheck(memory, d, '80', 'HDB').diff], ['lower', 8]);
  assert.equal(priceCheck(memory, d, '88.00', 'HDB').kind, 'same');
  const none = priceCheck(memory, 'supply & install 13a single socket outlet', '', 'HDB');
  assert.equal(none.kind, 'none');
  assert.deepEqual(none.others.map(o => [o.label, o.price]), [[IMPORTED_LABEL, 60], ['Condo', 70]]);
  assert.equal(priceCheck(memory, 'something never quoted', '', 'HDB'), null);
});

test('month labels', () => {
  assert.equal(monthLabel('2026-09-14'), 'Sep 2026');
  assert.equal(monthLabel(''), '');
});
