import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStageIds, selectStages, retryGroup, stagesLabel } from '../lib/stageSelection.mjs';
import { buildStageInvoice } from '../lib/stageInvoice.mjs';

const S = (id, name, extra = {}) => ({ id, name, amount: 1000, ...extra });
const schedule = [S('ST-1', 'Deposit', { xeroInvoiceId: 'x1', xeroInvoiceNumber: 'INV-1' }), S('ST-2', 'Progress payment 1'), S('ST-3', 'Progress payment 2'), S('ST-4', 'Final payment', { isFinal: true })];

test('parseStageIds takes an array or a comma list, without repeats', () => {
  assert.deepEqual(parseStageIds('ST-2, ST-3,ST-2'), ['ST-2', 'ST-3']);
  assert.deepEqual(parseStageIds(['ST-3']), ['ST-3']);
  assert.deepEqual(parseStageIds(''), []);
});

test('selectStages keeps schedule order and names what is missing', () => {
  const r = selectStages(schedule, ['ST-3', 'ST-2']);
  assert.deepEqual(r.stages.map(s => s.id), ['ST-2', 'ST-3']);
  assert.equal(r.problem, '');
  assert.equal(stagesLabel(r.stages), 'Progress payment 1 + Progress payment 2');
  assert.deepEqual(selectStages(schedule, ['ST-9']).missing, ['ST-9']);
});

test('an unfinished attempt must be retried with exactly its own stages', () => {
  const sched = schedule.map(s => (['ST-2', 'ST-3'].includes(s.id) ? { ...s, xeroInvoiceNumber: 'INV-7', xeroSyncStatus: 'error' } : s));
  const ok = selectStages(sched, ['ST-2', 'ST-3']);
  assert.equal(ok.retryNumber, 'INV-7');
  assert.equal(ok.problem, '');
  assert.match(selectStages(sched, ['ST-3']).problem, /Progress payment 1 \+ Progress payment 2 have an unfinished attempt as INV-7/);
  assert.match(selectStages(sched, ['ST-2', 'ST-3', 'ST-4']).problem, /unfinished attempt/);
  assert.deepEqual(retryGroup(sched, sched[2]).map(s => s.id), ['ST-2', 'ST-3']);
  assert.deepEqual(retryGroup(sched, sched[3]).map(s => s.id), ['ST-4']);
});

test('two separate unfinished attempts cannot be merged', () => {
  const sched = schedule.map(s => (s.id === 'ST-2' ? { ...s, xeroInvoiceNumber: 'INV-7', xeroSyncStatus: 'error' }
    : s.id === 'ST-3' ? { ...s, xeroInvoiceNumber: 'INV-8', xeroSyncStatus: 'sending' } : s));
  assert.match(selectStages(sched, ['ST-2', 'ST-3']).problem, /separate unfinished attempts/);
});

test('stages billed together: one line each, and the final keeps its VO lines', () => {
  const base = { contactId: 'C', invoiceNumber: 'INV-9', date: '2026-10-27', dueDate: '2026-11-10', reference: '1 Lane', accountCode: '200', trackingOption: '', contractSum: 10000 };
  const inv = buildStageInvoice({ ...base, stages: [
    { name: 'Progress payment 2', sharePct: 30, amount: 3000 },
    { name: 'Final payment', isFinal: true, amount: 2500, balance: 2000, settling: [{ voNumber: 1, title: 'Sockets', contractSum: 500 }] },
  ] });
  assert.deepEqual(inv.LineItems.map(l => l.UnitAmount), [3000, 2000, 500]);
  assert.equal(inv.LineItems[0].Description, 'Progress payment 2, 30% of contract sum $10,000.00');
  assert.equal(inv.LineItems[2].Description, 'Add: VO1 – Sockets');
  assert.throws(() => buildStageInvoice({ ...base, stages: [{ name: 'A', sharePct: 10, amount: 1000 }, { name: 'B', sharePct: 0, amount: 0 }] }), /more than \$0\.00 \(B\)/);
});

test('an invoice found by number is adopted only if its lines are this attempt\'s', async () => {
  const { matchesStageInvoice } = await import('../lib/stageInvoice.mjs');
  const mine = [{ Description: 'Progress payment 2, 30% of contract sum $10,000.00', Quantity: 1, UnitAmount: 3000 }];
  const found = l => ({ Contact: { ContactID: 'C' }, Total: 3000, Reference: '1 Lane', Status: 'AUTHORISED', LineItems: l });
  const want = { contactId: 'C', amount: 3000, reference: '1 Lane', lines: mine };
  assert.equal(matchesStageInvoice(found(mine), want), true);
  // another stage's invoice with the same total is not ours
  assert.equal(matchesStageInvoice(found([{ ...mine[0], Description: 'Progress payment 1, 30% of contract sum $10,000.00' }]), want), false);
  assert.equal(matchesStageInvoice(found([]), want), false);
  // without lines to compare, the old check still applies
  assert.equal(matchesStageInvoice(found([]), { ...want, lines: undefined }), true);
});

test('a claim token still counts as an attempt in flight', async () => {
  const { attemptInFlight } = await import('../lib/clientAcceptance.mjs');
  assert.equal(attemptInFlight({ xeroInvoiceNumber: 'INV-1', xeroSyncStatus: 'sending:ab12cd34' }), true);
  assert.equal(attemptInFlight({ xeroInvoiceNumber: '', xeroSyncStatus: 'error' }), false);
});

test('a VO invoice with title lines and rounded prices is still recognised as its own', async () => {
  const { matchesStageInvoice } = await import('../lib/stageInvoice.mjs');
  const mine = [{ Description: 'Variation order VO1' }, { Description: 'Extra sockets', Quantity: 3, UnitAmount: 12.345 }];
  const echoed = { Contact: { ContactID: 'C' }, Total: 37.04, Reference: '1 Lane', Status: 'AUTHORISED',
    LineItems: [{ Description: 'Variation order VO1', Quantity: 0, UnitAmount: 0, LineAmount: 0 }, { Description: 'Extra  sockets ', Quantity: 3, UnitAmount: 12.35, LineAmount: 37.05 }] };
  assert.equal(matchesStageInvoice(echoed, { contactId: 'C', amount: 37.04, reference: '1 Lane', lines: mine }), true);
});
