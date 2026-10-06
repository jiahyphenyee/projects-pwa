import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  round2, lineAmount, subtotal, sectionSubtotals, discountAmount, contractSum,
  quoteTotals, stageAmount, scheduleAmounts, sumAmounts,
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
