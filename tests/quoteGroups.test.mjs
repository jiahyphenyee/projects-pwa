import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectQuotes, firstQuote, parentOf, vosOf, quoteLabel } from '../lib/quoteGroups.mjs';

const quotes = [
  { id: 'Q-0012', projectCode: 'PRJ-114', kind: 'quote', title: 'Painting' },
  { id: 'Q-0009', projectCode: 'PRJ-114', kind: 'quote', title: '' },              // the first, from before
  { id: 'Q-0010', projectCode: 'PRJ-114', kind: 'vo', voNumber: 1, parentQuoteId: '' },        // legacy VO
  { id: 'Q-0013', projectCode: 'PRJ-114', kind: 'vo', voNumber: 2, parentQuoteId: 'Q-0012' },
  { id: 'Q-0014', projectCode: 'PRJ-114', kind: 'vo', voNumber: 3, parentQuoteId: 'Q-0099' },  // dangling → first
  { id: 'Q-0100', projectCode: 'PRJ-200', kind: 'quote', title: 'Electrical' },
  { id: 'Q-0101', projectCode: 'PRJ-200', kind: 'vo', voNumber: 1, parentQuoteId: 'Q-0012' },  // another project's id → its own first
];

test('a project lists its quotes oldest first, VOs and other projects left out', () => {
  assert.deepEqual(projectQuotes(quotes, 'PRJ-114').map(q => q.id), ['Q-0009', 'Q-0012']);
  assert.equal(firstQuote(quotes, 'PRJ-114').id, 'Q-0009');
  assert.equal(firstQuote(quotes, 'PRJ-999'), null);
});

test('a VO belongs to its parent quote; legacy and dangling VOs to the first quote', () => {
  assert.equal(parentOf(quotes[2], quotes).id, 'Q-0009');
  assert.equal(parentOf(quotes[3], quotes).id, 'Q-0012');
  assert.equal(parentOf(quotes[4], quotes).id, 'Q-0009');
  assert.equal(parentOf(quotes[6], quotes).id, 'Q-0100');
});

test('each quote gets only its own VOs, by number', () => {
  assert.deepEqual(vosOf(quotes, quotes[1]).map(v => v.id), ['Q-0010', 'Q-0014']);
  assert.deepEqual(vosOf(quotes, quotes[0]).map(v => v.id), ['Q-0013']);
  assert.deepEqual(vosOf(quotes, quotes[5]).map(v => v.id), ['Q-0101']);
  assert.deepEqual(vosOf(quotes, null), []);
});

test('a quote with no title is named by its id', () => {
  assert.equal(quoteLabel(quotes[0]), 'Painting');
  assert.equal(quoteLabel(quotes[1]), 'Quote Q-0009');
});
