import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  round2, lineAmount, subtotal, sectionSubtotals, discountAmount, contractSum,
  quoteTotals, stageAmount, scheduleAmounts, sumAmounts,
  voTotal, vosToSettle, adjustedContractSum, finalPaymentDue,
} from '../lib/quoteMaths.mjs';

const item = (qty, unitPrice, id) => ({ id, kind: 'item', qty, unitPrice });
const title = id => ({ id, kind: 'title' });

test('round2 rounds half away from zero and survives float noise', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test('lineAmount multiplies and rounds; blanks are 0', () => {
  assert.equal(lineAmount(4, 88), 352);
  assert.equal(lineAmount(91, 2.55), 232.05);
  assert.equal(lineAmount('3', '9.333'), 28);
  assert.equal(lineAmount('', 10), 0);
  assert.equal(lineAmount('abc', 10), 0);
});

test('lineAmount rounds the true decimal product, not the floating-point one', () => {
  assert.equal(lineAmount(91.5, 6.55), 599.33);     // 599.325 exactly
  assert.equal(lineAmount(3, 1.115), 3.35);         // 3.345 exactly
  assert.equal(lineAmount(0.5, 0.01), 0.01);        // 0.005 rounds up
  assert.equal(lineAmount(-1, 98.33), -98.33);
  assert.equal(lineAmount(99999, 99999.99), 9999899000.01);   // 99999 × 100000 − 999.99
});

test('subtotal sums item rows only, exact to the cent', () => {
  const lines = [title('t1'), item(1, 0.1), item(1, 0.2), item(3, 0.1), title('t2'), item(2, 1.005)];
  // 0.1 + 0.2 + 0.3 + 2.01 — lineAmount(2, 1.005) rounds to 2.01
  assert.equal(subtotal(lines), 2.61);
});

test('sectionSubtotals attributes item rows to the title above them', () => {
  const lines = [item(1, 5, 'a'), title('t1'), item(2, 10, 'b'), item(1, 2.5, 'c'), title('t2'), title('t3'), item(1, 1, 'd')];
  const sec = sectionSubtotals(lines);
  assert.equal(sec.get('t1'), 22.5);
  assert.equal(sec.get('t2'), 0);
  assert.equal(sec.get('t3'), 1);
  assert.equal(sec.has('a'), false);
});

test('discountAmount in $ is capped at the subtotal', () => {
  assert.equal(discountAmount(1000, '$', 50), 50);
  assert.equal(discountAmount(1000, '$', 5000), 1000);
  assert.equal(discountAmount(1000, '$', -5), 0);
  assert.equal(discountAmount(1000, '$', ''), 0);
});

test('discountAmount in % is capped at 100 and rounds', () => {
  assert.equal(discountAmount(1000, '%', 10), 100);
  assert.equal(discountAmount(1000, '%', 150), 1000);
  assert.equal(discountAmount(333.33, '%', 10), 33.33);
  assert.equal(discountAmount(1014.01, '%', 12.5), 126.75);
  assert.equal(discountAmount(1000, 'x', 10), 0);
});

test('contractSum never goes below zero', () => {
  assert.equal(contractSum(1000, 100), 900);
  assert.equal(contractSum(100, 1000), 0);
});

test('quoteTotals ties the three figures together', () => {
  const lines = [item(4, 88), item(6, 45), item(2, 70)];
  assert.deepEqual(quoteTotals(lines, '%', 10), { subtotal: 762, discount: 76.2, contractSum: 685.8 });
  assert.deepEqual(quoteTotals(lines, null, null), { subtotal: 762, discount: 0, contractSum: 762 });
});

test('stageAmount rounds to the cent', () => {
  assert.equal(stageAmount(1014.01, 30), 304.2);
  assert.equal(stageAmount(999.99, 33.33), 333.3);
  assert.equal(stageAmount(1000, ''), 0);
});

test('schedule: stages plus final always equal the contract sum to the cent', () => {
  const contract = 999.99;
  const stages = [{ sharePct: 33.33 }, { sharePct: 33.33 }, { sharePct: 33.33 }];
  const s = scheduleAmounts(contract, stages);
  assert.deepEqual(s.amounts, [333.3, 333.3, 333.3]);
  assert.equal(s.finalAmount, 0.09);
  assert.equal(sumAmounts([...s.amounts, s.finalAmount]), contract);
  assert.equal(s.overAllocated, false);
  assert.equal(s.finalNegative, false);
  assert.equal(s.finalPct, 0.01);
});

test('schedule: a billed stage keeps its invoiced amount when the contract sum changes', () => {
  const stages = [{ sharePct: 30, billedAmount: 300 }, { sharePct: 20 }, { sharePct: 20 }];
  const s = scheduleAmounts(1200, stages);
  assert.deepEqual(s.amounts, [300, 240, 240]);
  assert.equal(s.finalAmount, 420);
  assert.equal(sumAmounts([...s.amounts, s.finalAmount]), 1200);
});

test('schedule: blank shares on a new quote put everything in the final payment', () => {
  const s = scheduleAmounts(5070, [{ sharePct: '' }, { sharePct: '' }, { sharePct: '' }, { sharePct: '' }]);
  assert.deepEqual(s.amounts, [0, 0, 0, 0]);
  assert.equal(s.finalAmount, 5070);
  assert.equal(s.finalPct, 100);
});

test('schedule: flags over-allocation and a contract sum below what was billed', () => {
  const over = scheduleAmounts(1000, [{ sharePct: 60 }, { sharePct: 50 }]);
  assert.equal(over.overAllocated, true);
  assert.equal(over.finalNegative, true);
  assert.equal(over.finalAmount, -100);

  const shrunk = scheduleAmounts(500, [{ sharePct: 30, billedAmount: 600 }]);
  assert.equal(shrunk.overAllocated, false);
  assert.equal(shrunk.finalNegative, true);
  assert.equal(shrunk.finalAmount, -100);
});

test('schedule: a billed final payment is fixed too', () => {
  const s = scheduleAmounts(2000, [{ sharePct: 50, billedAmount: 500 }], 500);
  assert.equal(s.finalAmount, 500);
});

test('sumAmounts has no float drift', () => {
  assert.equal(sumAmounts([0.1, 0.2, 0.3, 0.4]), 1);
  assert.equal(sumAmounts(Array(100).fill(0.01)), 1);
});

// ── Variation orders on the final invoice ────────────────────────────────────────────

test('a VO total is signed: additions positive, omissions negative, exact to the cent', () => {
  assert.equal(voTotal([item(2, 400)], '', null), 800);
  assert.equal(voTotal([item(1, -500)], '', null), -500);
  assert.equal(voTotal([item(-3, 33.33)], '', null), -99.99);
  // Mixed: 0.1 + 0.2 − 0.3 is exactly 0, not 5.5e-17
  assert.equal(voTotal([item(1, 0.1), item(1, 0.2), item(1, -0.3)], '', null), 0);
  // The discount still applies to a net-positive VO, and the quote itself still floors at 0
  assert.equal(voTotal([item(1, 1000), item(1, -200)], '%', 10), 720);
  assert.equal(quoteTotals([item(1, -500)], '', null).contractSum, 0);
  assert.equal(quoteTotals([item(1, -500)], '', null, { signed: true }).contractSum, -500);
});

const vo = (contractSum, extra = {}) => ({ contractSum, xeroInvoiceId: '', ...extra });

test('only VOs without an invoice settle on the final; early-billed and settled ones do not', () => {
  const list = [vo(800), vo(300, { xeroInvoiceId: 'early' }), vo(-500), vo(100, { xeroInvoiceId: 'final', settledOnStageId: 'ST-0005' })];
  assert.deepEqual(vosToSettle(list).map(v => v.contractSum), [800, -500]);
});

test('finalPaymentDue adds the unsettled VOs to the balance, to the cent', () => {
  const due = finalPaymentDue(4000, [vo(800), vo(-500)]);
  assert.deepEqual({ balance: due.balance, adjustment: due.adjustment, due: due.due, negative: due.negative },
    { balance: 4000, adjustment: 300, due: 4300, negative: false });
  // An addition billed early stays off
  assert.equal(finalPaymentDue(4000, [vo(800, { xeroInvoiceId: 'INV' }), vo(-500)]).due, 3500);
  // No VOs: the balance alone, unchanged
  assert.equal(finalPaymentDue(0.09, []).due, 0.09);
  // Float-prone amounts
  assert.equal(finalPaymentDue(0.1, [vo(0.2), vo(-0.3)]).due, 0);
  assert.equal(finalPaymentDue(1014.01, [vo(599.33), vo(-98.33)]).due, 1515.01);
});

test('stages + final due + early-billed VOs = adjusted contract sum', () => {
  const contract = 999.99;
  const vos = [vo(800.55), vo(-123.45), vo(300, { xeroInvoiceId: 'early' })];
  const s = scheduleAmounts(contract, [{ sharePct: 33.33 }, { sharePct: 33.33 }, { sharePct: 33.33 }]);
  const due = finalPaymentDue(s.finalAmount, vos);
  const early = vos.filter(v => v.xeroInvoiceId).map(v => v.contractSum);
  assert.equal(adjustedContractSum(contract, vos), 1977.09);
  assert.equal(sumAmounts([...s.amounts, due.due, ...early]), adjustedContractSum(contract, vos));
});

test('the final is blocked when omissions outweigh the balance, or the balance is already negative', () => {
  assert.equal(finalPaymentDue(400, [vo(-500)]).negative, true);
  assert.equal(finalPaymentDue(400, [vo(-500)]).due, -100);
  assert.equal(finalPaymentDue(-100, [vo(800)]).negative, true);     // billed more than the contract sum
  assert.equal(finalPaymentDue(500, [vo(-500)]).negative, false);    // exactly $0: not negative, but $0 is blocked elsewhere
  assert.equal(finalPaymentDue(500, [vo(-500)]).due, 0);
});
