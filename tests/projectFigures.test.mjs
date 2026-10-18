import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSettings, costBucket, costSplit, quotedValue, serviceBreakdown, UNASSIGNED,
  projectFigures, statusFlag, summariseInvoices, invoiceAge, invoicesForProject, possibleDuplicates,
} from '../lib/projectFigures.mjs';

const settings = readSettings();

test('settings fall back to the defaults, never to 0', () => {
  assert.deepEqual(settings, { targetMarginPct: 35, watchLevelPct: 80, overLevelPct: 100, chaseAfterDays: 30, overdueAfterDays: 60 });
  assert.equal(readSettings({ TARGET_MARGIN_PCT: '' }).targetMarginPct, 35);
  assert.equal(readSettings({ TARGET_MARGIN_PCT: 'abc' }).targetMarginPct, 35);
  assert.equal(readSettings({ TARGET_MARGIN_PCT: '30' }).targetMarginPct, 30);
  assert.equal(readSettings({ WATCH_LEVEL_PCT: 0 }).watchLevelPct, 0);
});

test('a cost type decides the bucket, in either ledger', () => {
  assert.equal(costBucket({ costType: 'material' }), 'materials');
  assert.equal(costBucket({ costType: 'labour (external)' }), 'subcon');
  assert.equal(costBucket({ costType: 'labour (internal)' }), 'ownLabour');
  assert.equal(costBucket({ costType: 'transport' }), 'transport');
  assert.equal(costBucket({ receipted: true, costType: 'labour (external)', categoryCode: 'PAINT' }), 'subcon');
});

test('an untyped receipted row is transport for TRANS/VEHIC, materials otherwise', () => {
  assert.equal(costBucket({ receipted: true, costType: '', categoryCode: 'TRANS' }), 'transport');
  assert.equal(costBucket({ receipted: true, costType: '', categoryCode: 'VEHIC' }), 'transport');
  assert.equal(costBucket({ receipted: true, costType: '', categoryCode: 'PLMB' }), 'materials');
  assert.equal(costBucket({ receipted: true, costType: '', categoryCode: '' }), 'materials');
  // A typed row is never overridden by its category
  assert.equal(costBucket({ receipted: true, costType: 'material', categoryCode: 'TRANS' }), 'materials');
});

const lines = [
  { id: 'PC-1', receipted: false, costType: 'material',          categoryCode: 'PAINT', amount: 100.10 },
  { id: 'PC-2', receipted: false, costType: 'labour (external)', categoryCode: 'PAINT', amount: 200.20 },
  { id: 'PC-3', receipted: false, costType: 'transport',         categoryCode: '',      amount: 0.1 },
  { id: 'EX-1', receipted: true,  costType: '',                  categoryCode: 'TRANS', amount: 0.2 },
  { id: 'EX-2', receipted: true,  costType: '',                  categoryCode: 'PLMB',  amount: 55.55 },
  { id: 'EX-3', receipted: true,  costType: 'labour (external)', categoryCode: 'PLMB',  amount: 2080 },
];

test('the split buckets add up to the total, to the cent', () => {
  const split = costSplit(lines);
  assert.equal(split.total, 2436.15);
  assert.equal(split.receipted, 2135.75);
  assert.equal(split.nonReceipted, 300.4);
  const byKey = Object.fromEntries(split.buckets.map(b => [b.key, b.amount]));
  assert.deepEqual(byKey, { materials: 155.65, subcon: 2280.2, ownLabour: 0, transport: 0.3 });
  const cents = split.buckets.reduce((a, b) => a + Math.round(b.amount * 100), 0);
  assert.equal(cents, Math.round(split.total * 100));
  assert.ok(Math.abs(split.buckets.reduce((a, b) => a + b.share, 0) - 1) < 1e-9);
});

test('an empty project splits into zeros with no division by zero', () => {
  const split = costSplit([]);
  assert.equal(split.total, 0);
  assert.ok(split.buckets.every(b => b.amount === 0 && b.share === 0));
});

test('no quote means quoted is null, not 0', () => {
  assert.deepEqual(quotedValue([]), { hasQuote: false, quoted: null, quoteSum: null, additions: 0, omissions: 0, byService: {} });
});

test('quoted splits into the quote, additions and omissions, and nets to the adjusted sum', () => {
  const q = quotedValue([
    { kind: 'quote', contractSum: 10000, lines: [{ kind: 'item', service: 'ELEC', amount: 10000 }] },
    { kind: 'vo', contractSum: 800.55, lines: [{ kind: 'item', service: 'ELEC', amount: 800.55 }] },
    { kind: 'vo', contractSum: -500.1, lines: [{ kind: 'item', service: 'CARP', amount: -500.1 }] },
    { kind: 'vo', contractSum: 0.2, lines: [{ kind: 'item', service: 'PLMB', amount: 0.3 }, { kind: 'item', service: 'PLMB', amount: -0.1 }] },
  ]);
  assert.equal(q.quoteSum, 10000);
  assert.equal(q.additions, 800.75);     // a mixed VO counts by its net
  assert.equal(q.omissions, 500.1);
  assert.equal(q.quoted, 10300.65);
  // An omission comes off its service; the services still total the adjusted sum to the cent
  assert.equal(q.byService.CARP, -500.1);
  assert.equal(q.byService.ELEC, 10800.55);
  const cents = Object.values(q.byService).reduce((a, v) => a + Math.round(v * 100), 0);
  assert.equal(cents, Math.round(q.quoted * 100));
});

test('not yet invoiced uses the adjusted quoted sum', () => {
  const f = projectFigures({ cost: 0, quoted: 10300.65, invoices: { invoiced: 4000, collected: 0, outstanding: 4000 }, status: 'active', settings });
  assert.equal(f.notYetInvoiced, 6300.65);
});

test('a discount is spread across services and still totals the contract sum exactly', () => {
  const q = quotedValue([{
    contractSum: 1000,                       // 1,003.33 of lines, 3.33 discount
    lines: [
      { kind: 'title', service: '', amount: 0 },
      { kind: 'item', service: 'ELEC', amount: 333.33 },
      { kind: 'item', service: 'PLMB', amount: 333.33 },
      { kind: 'item', service: 'PAINT', amount: 336.67 },
    ],
  }]);
  assert.equal(q.quoted, 1000);
  const cents = Object.values(q.byService).reduce((a, v) => a + Math.round(v * 100), 0);
  assert.equal(cents, 100000);
});

test('a quote and its variation orders add together, by service', () => {
  const q = quotedValue([
    { contractSum: 500, lines: [{ kind: 'item', service: 'ELEC', amount: 500 }] },
    { contractSum: 120, lines: [{ kind: 'item', service: '', amount: 120 }] },
  ]);
  assert.equal(q.quoted, 620);
  assert.deepEqual(q.byService, { ELEC: 500, [UNASSIGNED]: 120 });
});

test('a quote with no item amounts keeps its whole sum, unassigned', () => {
  const q = quotedValue([{ contractSum: 800, lines: [{ kind: 'title', service: '', amount: 0 }] }]);
  assert.deepEqual(q.byService, { [UNASSIGNED]: 800 });
});

test('service rows add up to the project totals, unassigned row last', () => {
  const { rows, totals } = serviceBreakdown(lines, { PAINT: 1000, ELEC: 400 });
  assert.deepEqual(rows.map(r => r.code), ['PLMB', 'PAINT', 'ELEC', 'TRANS', UNASSIGNED]);
  for (const key of ['quoted', 'materials', 'subcon', 'ownLabour', 'transport', 'total']) {
    const sum = rows.reduce((a, r) => a + Math.round((r[key] ?? 0) * 100), 0);
    assert.equal(sum, Math.round(totals[key] * 100), key);
  }
  assert.equal(totals.total, costSplit(lines).total);
  assert.equal(totals.quoted, 1400);
  const paint = rows.find(r => r.code === 'PAINT');
  assert.equal(paint.total, 300.3);
  assert.ok(Math.abs(paint.pctOfQuote - 0.3003) < 1e-9);
  assert.equal(rows.find(r => r.code === 'ELEC').total, 0);
});

test('with no quote the breakdown has no quoted column values', () => {
  const { rows, totals } = serviceBreakdown(lines, null);
  assert.ok(rows.every(r => r.quoted === null && r.pctOfQuote === null));
  assert.equal(totals.quoted, null);
});

test('ongoing job: profit against the quote, budget at the target margin', () => {
  const f = projectFigures({ cost: 5200, quoted: 10000, invoices: { invoiced: 4000, collected: 3000, outstanding: 1000 }, status: 'active', settings });
  assert.equal(f.completed, false);
  assert.equal(f.profit, 4800);
  assert.equal(f.margin, 0.48);
  assert.equal(f.budget, 6500);
  assert.equal(f.budgetUsed, 0.8);
  assert.equal(f.flag, 'watch');
  assert.equal(f.notYetInvoiced, 6000);
  assert.equal(f.outstanding, 1000);
});

test('ongoing job with no quote: no profit, no margin, no flag', () => {
  const f = projectFigures({ cost: 5200, quoted: null, invoices: { invoiced: 4000, collected: 4000, outstanding: 0 }, status: 'active', settings });
  assert.equal(f.profit, null);
  assert.equal(f.margin, null);
  assert.equal(f.budgetUsed, null);
  assert.equal(f.flag, null);
  assert.equal(f.invoiced, 4000);
});

test('completed job: profit against what was invoiced, even with no quote', () => {
  const f = projectFigures({ cost: 7657.81, quoted: null, invoices: { invoiced: 10000, collected: 10000, outstanding: 0 }, status: 'closed', settings });
  assert.equal(f.completed, true);
  assert.equal(f.profit, 2342.19);
  assert.ok(Math.abs(f.margin - 0.234219) < 1e-9);
  assert.equal(f.flag, 'belowTarget');
});

test('completed job with Xero unreadable has no profit rather than a wrong one', () => {
  const f = projectFigures({ cost: 100, quoted: 500, invoices: null, status: 'closed', settings });
  assert.equal(f.profit, null);
  assert.equal(f.invoiced, null);
  assert.equal(f.outstanding, null);
  assert.equal(f.flag, null);
});

test('flag boundaries follow the spec exactly', () => {
  const ongoing = u => statusFlag({ completed: false, budgetUsed: u, settings });
  assert.equal(ongoing(0.79), 'onTrack');
  assert.equal(ongoing(0.8), 'watch');            // at the Watch level
  assert.equal(ongoing(1), 'watch');              // at, not above, the Over level
  assert.equal(ongoing(1.0001), 'overBudget');
  const done = m => statusFlag({ completed: true, margin: m, settings });
  assert.equal(done(0.35), 'healthy');            // at the target
  assert.equal(done(0.3499), 'belowTarget');
  assert.equal(done(0), 'belowTarget');
  assert.equal(done(-0.01), 'loss');
});

test('invoice ageing: paid, unpaid, chase after 30 days, overdue after 60', () => {
  const inv = (date, due) => ({ kind: 'invoice', date, due, total: 100 });
  assert.deepEqual(invoiceAge(inv('2026-01-01', 0), '2026-10-15', settings), { state: 'paid', ageDays: null });
  assert.deepEqual(invoiceAge(inv('2026-09-15', 100), '2026-10-15', settings), { state: 'unpaid', ageDays: 30 });
  assert.deepEqual(invoiceAge(inv('2026-09-14', 100), '2026-10-15', settings), { state: 'chase', ageDays: 31 });
  assert.deepEqual(invoiceAge(inv('2026-08-16', 100), '2026-10-15', settings), { state: 'chase', ageDays: 60 });
  assert.deepEqual(invoiceAge(inv('2026-08-15', 100), '2026-10-15', settings), { state: 'overdue', ageDays: 61 });
});

test('credit notes reduce invoiced; applied credit is already out of AmountDue', () => {
  const s = summariseInvoices([
    { kind: 'invoice', number: 'INV-1', date: '2026-01-01', total: 1000, due: 0 },
    { kind: 'invoice', number: 'INV-2', date: '2026-02-01', total: 500,  due: 300 },   // 200 credited
    { kind: 'credit',  number: 'CN-1',  date: '2026-02-05', total: 200,  due: 0 },     // fully applied
  ], '2026-02-10', settings);
  assert.equal(s.invoiced, 1300);
  assert.equal(s.outstanding, 300);
  assert.equal(s.collected, 1000);
  assert.deepEqual(s.items.map(i => i.number), ['CN-1', 'INV-2', 'INV-1']);
});

test('unapplied credit reduces what is outstanding', () => {
  const s = summariseInvoices([
    { kind: 'invoice', number: 'INV-1', date: '2026-01-01', total: 1000, due: 1000 },
    { kind: 'credit',  number: 'CN-1',  date: '2026-01-05', total: 100,  due: 100 },
  ], '2026-01-10', settings);
  assert.equal(s.invoiced, 900);
  assert.equal(s.outstanding, 900);
  assert.equal(s.collected, 0);
});

const projects = [
  { code: 'PRJ-001', address: '297 Tampines St 22 #11-576' },
  { code: 'PRJ-090', address: '27 Robin Road, #09-04' },
  { code: 'PRJ-100', address: '88 Mackenzie Rd, #03-11' },
  { code: 'PRJ-101', address: '88 Kent Ridge, #03-11' },
];
const doc = (number, reference) => ({ kind: 'invoice', number, reference, total: 100, due: 0, date: '2026-01-01' });

test('invoices match on the exact address, ignoring case and spacing', () => {
  const { matched } = invoicesForProject([doc('A', '27 Robin Road, #09-04'), doc('B', '27  robin road, #09-04 ')], projects, 'PRJ-090');
  assert.deepEqual(matched.map(m => [m.number, m.matchedBy]), [['A', 'exact'], ['B', 'exact']]);
});

test('invoices fall back to block and unit, ignoring "Blk" and the postcode', () => {
  const { matched } = invoicesForProject([doc('A', 'Blk 297 Tampines St 22 S520297, #11-576')], projects, 'PRJ-001');
  assert.deepEqual(matched.map(m => [m.number, m.matchedBy]), [['A', 'unit']]);
});

test('a unit number alone never matches a different building', () => {
  const { matched, ambiguous } = invoicesForProject([doc('A', '5 Other Street #09-04')], projects, 'PRJ-090');
  assert.equal(matched.length, 0);
  assert.equal(ambiguous.length, 0);
});

test('the same block and unit on another street is not a match', () => {
  const { matched } = invoicesForProject([doc('A', 'Blk 88 Mackenzie Road S123456 #03-11')], projects, 'PRJ-100');
  assert.deepEqual(matched.map(m => [m.number, m.matchedBy]), [['A', 'unit']]);
  assert.equal(invoicesForProject([doc('A', 'Blk 88 Mackenzie Road #03-11')], projects, 'PRJ-101').matched.length, 0);
});

test('a reference fitting two projects is ambiguous, not guessed', () => {
  const dupes = [...projects, { code: 'PRJ-102', address: '88 Mackenzie Road #03-11' }];
  const { matched, ambiguous } = invoicesForProject([doc('A', 'Blk 88 Mackenzie Rd #03-11 S123456')], dupes, 'PRJ-100');
  assert.equal(matched.length, 0);
  assert.deepEqual(ambiguous[0].candidates, ['PRJ-100', 'PRJ-102']);
});

test('possible duplicates pair across the two ledgers only', () => {
  const dupes = possibleDuplicates([
    { id: 'PC-1', receipted: false, amount: 2080 },
    { id: 'EX-1', receipted: true,  amount: 2080 },
    { id: 'PC-2', receipted: false, amount: 50 },
    { id: 'PC-3', receipted: false, amount: 50 },
    { id: 'EX-2', receipted: true,  amount: 0 },
    { id: 'PC-4', receipted: false, amount: 0 },
  ]);
  assert.deepEqual(dupes, { 'PC-1': ['EX-1'], 'EX-1': ['PC-1'] });
});
