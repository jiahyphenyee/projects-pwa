import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimFigures, mainBilledBefore, lastPct, buildClaimInvoice, claimLineDescription, claimCounts } from '../lib/progressClaims.mjs';

test('the proposal example: claim 2 at 70% with two VOs', () => {
  const claims = [{ pctDone: 40, mainAmount: 20000, xeroInvoiceId: 'x' }];
  const f = claimFigures({
    contractSum: 50000, pct: 70, billedBefore: mainBilledBefore([], claims), previousPct: lastPct(claims),
    vos: [{ voNumber: 1, title: 'Extra power points', contractSum: 3000 }, { voNumber: 2, title: 'Remove one cabinet', contractSum: -1000 }],
  });
  assert.deepEqual([f.gross, f.billedBefore, f.main, f.voAmount, f.total], [35000, 20000, 15000, 2000, 17000]);
  assert.deepEqual(f.problems, []);
});

test('stage invoices count as already billed; the final stage and cancelled claims do not', () => {
  const stages = [{ isFinal: false, xeroInvoiceId: 'a', billedAmount: 10000 }, { isFinal: false }, { isFinal: true }];
  const claims = [{ mainAmount: 5000, xeroSyncStatus: 'cancelled' }, { mainAmount: 7000, xeroInvoiceNumber: 'INV-3', xeroSyncStatus: 'error' }];
  assert.equal(mainBilledBefore(stages, claims), 17000);   // the error claim may be in Xero: counted
  assert.equal(claimCounts(claims[0]), false);
});

test('a claim must move forward and cannot go below what is billed', () => {
  assert.match(claimFigures({ contractSum: 1000, pct: 40, previousPct: 40 }).problems[0], /more than that/);
  assert.match(claimFigures({ contractSum: 1000, pct: 101 }).problems[0], /at most 100/);
  assert.match(claimFigures({ contractSum: 1000, pct: 30, billedBefore: 500 }).problems[0], /already billed/);
  assert.match(claimFigures({ contractSum: 1000, pct: 50, billedBefore: 500 }).problems[0], /\$0\.00 or less/);
  assert.deepEqual(claimFigures({ contractSum: 1000, pct: 50, billedBefore: 500, vos: [{ contractSum: 100 }] }).problems, []);
});

test('the claim invoice: one claim line, then each VO at its full amount', () => {
  const figures = claimFigures({ contractSum: 50000, pct: 70, billedBefore: 20000, vos: [{ contractSum: 3000 }] });
  const inv = buildClaimInvoice({
    contactId: 'C', invoiceNumber: 'INV-1', date: '2026-10-27', dueDate: '2026-11-10', reference: '1 Lane', accountCode: '200',
    trackingOption: '', claimNo: 2, contractSum: 50000, figures, vos: [{ voNumber: 1, title: 'Extra power points', contractSum: 3000 }],
  });
  assert.equal(inv.Status, 'AUTHORISED');
  assert.deepEqual(inv.LineItems.map(l => [l.Description, l.UnitAmount]), [
    ['Progress claim 2: 70% of contract sum $50,000.00 = $35,000.00, less $20,000.00 already billed', 15000],
    ['Add: VO1 – Extra power points', 3000],
  ]);
  assert.equal(claimLineDescription({ claimNo: 1, pct: 40, contractSum: 50000, gross: 20000, billedBefore: 0 }), 'Progress claim 1: 40% of contract sum $50,000.00');
});
