import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costQuoteId, quoteTable } from '../lib/quoteCosting.mjs';

const quotes = [
  { quoteId: 'Q-0011', title: 'Electrical', trade: 'ELEC', contractSum: 6446, declined: false, items: [] },
  { quoteId: 'Q-0012', title: 'Hacking', trade: 'HACK', contractSum: 5370, declined: false,
    items: [{ kind: 'stage', amount: 1000 }, { kind: 'vo', amount: 1210 }] },
  { quoteId: 'Q-0013', title: 'Painting', trade: 'PAINT', contractSum: 2270, declined: false, items: [] },
  { quoteId: 'Q-0014', title: 'Painting again', trade: 'PAINT', contractSum: 500, declined: false, items: [] },
  { quoteId: 'Q-0015', title: 'Aircon', trade: 'AIRCON', contractSum: 8000, declined: true, items: [] },
];
const lines = [
  { id: 'PC-1', categoryCode: 'PAINT', amount: 150 },
  { id: 'PC-2', categoryCode: 'PAINT', amount: 95, quoteId: 'Q-0014' },   // picked
  { id: 'PC-3', categoryCode: 'HACK', amount: 746.24 },
  { id: 'PC-4', categoryCode: 'CEIL', amount: 850 },                      // no quote has this trade
  { id: 'EXP-1', categoryCode: 'ELEC', amount: 575.37, receipted: true },
  { id: 'PC-5', categoryCode: 'AIRCON', amount: 40 },                     // only quote with it is declined
  { id: 'PC-6', categoryCode: 'ELEC', amount: 10, quoteId: 'Q-9999' },    // picked id not on this project
];
const docs = [
  { id: 'a', kind: 'invoice', status: 'PAID', total: 6446, due: 0, date: '2026-05-20', quoteId: 'Q-0011' },
  { id: 'b', kind: 'invoice', status: 'AUTHORISED', total: 2270, due: 2270, date: '2026-07-03', quoteId: 'Q-0013' },
  { id: 'c', kind: 'invoice', status: 'AUTHORISED', total: 400, due: 400, date: '2026-08-15' },            // hand-made
  { id: 'd', kind: 'invoice', status: 'DRAFT', total: 999, due: 999, date: '2026-08-16', quoteId: 'Q-0013' },
  { id: 'e', kind: 'invoice', status: 'PAID', total: 1000, due: 0, date: '2026-06-29', quoteId: 'Q-0012' },
];

test('a cost goes to its picked quote, else the first live quote with its trade, else none', () => {
  assert.equal(costQuoteId(lines[0], quotes), 'Q-0013');
  assert.equal(costQuoteId(lines[1], quotes), 'Q-0014');
  assert.equal(costQuoteId(lines[2], quotes), 'Q-0012');
  assert.equal(costQuoteId(lines[3], quotes), '');
  assert.equal(costQuoteId(lines[5], quotes), '');        // declined quotes take nothing automatically
  assert.equal(costQuoteId(lines[6], quotes), 'Q-0011');  // an unknown pick falls back to the trade
  assert.equal(costQuoteId({ categoryCode: '' }, quotes), '');
  assert.equal(costQuoteId({ categoryCode: 'AIRCON', quoteId: 'Q-0015' }, quotes), 'Q-0015'); // picked explicitly
});

test('per-quote rows: quoted, VOs, cost, margin, invoiced, paid, outstanding', () => {
  const t = quoteTable({ quotes, lines, docs, today: '2026-11-08' });
  const row = id => t.rows.find(r => r.quoteId === id);
  assert.deepEqual(
    (({ quoted, vos, cost, invoiced, paid, outstanding }) => ({ quoted, vos, cost, invoiced, paid, outstanding }))(row('Q-0012')),
    { quoted: 5370, vos: 1210, cost: 746.24, invoiced: 1000, paid: 1000, outstanding: 0 },
  );
  assert.equal(Math.round(row('Q-0012').margin * 1000), Math.round((6580 - 746.24) / 6580 * 1000));
  assert.equal(row('Q-0013').cost, 150);
  assert.equal(row('Q-0013').invoiced, 2270);      // the draft is not counted
  assert.equal(row('Q-0013').outstanding, 2270);
  assert.equal(row('Q-0011').cost, 585.37);
  assert.equal(row('Q-0015').margin, null);        // declined: no margin
});

test('"Not on a quote" holds what has no home; totals add up and leave declined quotes out', () => {
  const t = quoteTable({ quotes, lines, docs, today: '2026-11-08' });
  const rest = t.rows.at(-1);
  assert.equal(rest.quoteId, '');
  assert.deepEqual(rest.costLines.map(l => l.id), ['PC-4', 'PC-5']);
  assert.equal(rest.invoiced, 400);
  assert.equal(t.totals.cost, 2466.61);
  assert.equal(t.totals.quoted, 6446 + 5370 + 2270 + 500);
  assert.equal(t.totals.invoiced, 6446 + 2270 + 400 + 1000);
});

test('no left-over row when everything has a home', () => {
  const t = quoteTable({ quotes, lines: lines.slice(0, 3), docs: docs.filter(d => d.quoteId), today: '2026-11-08' });
  assert.equal(t.rows.some(r => r.quoteId === ''), false);
});
