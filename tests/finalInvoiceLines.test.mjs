import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStageInvoice, finalItemisation, quoteLineItems, matchesStageInvoice } from '../lib/stageInvoice.mjs';
import { lineAmount, sumAmounts } from '../lib/quoteMaths.mjs';

const xeroTotal = inv => sumAmounts(inv.LineItems.map(l => (l.Quantity === undefined ? 0 : lineAmount(l.Quantity, l.UnitAmount))));

// The PRJ-192 quote (Q-0011, $298, 6 Nov 2026), anonymised client
const lines = [
  { kind: 'item', description: 'To supply material and labour to install LED and LED strip', service: 'ELEC', qty: 2, unit: 'nos', unitPrice: 40 },
  { kind: 'item', description: 'To supply labour to replace the ceiling light driver in Kitchen', service: 'ELEC', qty: 1, unit: '', unitPrice: 0 },
  { kind: 'item', description: 'To supply material and labour to replace window handle', service: 'GEN', qty: 1, unit: '', unitPrice: 25 },
  { kind: 'item', description: 'To supply labour to replace kitchen drying rack', service: 'GEN', qty: 1, unit: '', unitPrice: 0 },
  { kind: 'item', description: 'To supply labour to install paintings on wall', service: 'ELEC', qty: 4, unit: '', unitPrice: 12 },
  { kind: 'item', description: 'Purchase on behalf: LED Driver 150W 24V', service: 'ELEC', qty: 2, unit: '', unitPrice: 30 },
  { kind: 'item', description: 'Purchase on behalf: LED Strip 3000K', service: 'ELEC', qty: 5, unit: 'm', unitPrice: 12 },
  { kind: 'item', description: 'Purchase on behalf: Kitchen ceiling light driver', service: 'ELEC', qty: 1, unit: '', unitPrice: 25 },
];
const categories = [{ code: 'ELEC', xeroOption: 'Electrical' }, { code: 'GEN', xeroOption: 'General' }];
const quote = { contractSum: 298, discountMode: '', discountValue: null, showUnit: false };
const finalStage = (over = {}) => ({ id: 'ST-9', name: 'Final payment (balance)', isFinal: true, amount: 298, balance: 298, settling: [], ...over });
const zeroStages = ['Deposit', 'Progress payment 1', 'Progress payment 2', 'Progress payment 3']
  .map((name, i) => ({ id: `ST-${i}`, name, isFinal: false, amount: 0, xeroInvoiceId: '' }));
const base = { contactId: 'c-1', invoiceNumber: 'INV-261106-01', date: '2026-11-06', dueDate: '2026-11-20', reference: '293C Example St', accountCode: '200', trackingOption: '', contractSum: 298 };

test('a final billed alone, other stages $0: the invoice lists every quote line and totals the balance', () => {
  const st = finalStage();
  const itemise = finalItemisation({ quote, stages: [st], schedule: { stages: [...zeroStages, st] }, lines, categories });
  assert.ok(itemise);
  const inv = buildStageInvoice({ ...base, stages: [st], itemise });
  assert.equal(inv.LineItems.length, 8);
  assert.deepEqual(inv.LineItems[0], {
    Description: 'To supply material and labour to install LED and LED strip', Quantity: 2, UnitAmount: 40, AccountCode: '200',
    Tracking: [{ Name: 'Service', Option: 'Electrical' }],
  });
  assert.equal(inv.LineItems[2].Tracking[0].Option, 'General');
  assert.equal(inv.LineItems[1].UnitAmount, 0);          // $0 lines are kept, as on the quote
  assert.equal(xeroTotal(inv), 298);
  assert.equal(inv.Status, 'AUTHORISED');
  assert.equal(inv.Reference, '293C Example St');
});

test('units are shown only when the quote shows them', () => {
  const st = finalStage();
  const on = finalItemisation({ quote: { ...quote, showUnit: true }, stages: [st], schedule: { stages: [st] }, lines, categories });
  const inv = buildStageInvoice({ ...base, stages: [st], itemise: on });
  assert.equal(inv.LineItems[6].Description, 'Purchase on behalf: LED Strip 3000K (per m)');
  assert.equal(inv.LineItems[1].Description, 'To supply labour to replace the ceiling light driver in Kitchen');
});

test('stages billed earlier and the discount come off as Less lines; VOs follow; total = amount due', () => {
  // Quote $1,000 less $100 discount = $900; deposit 30% = $270 billed; VO +$50 to settle
  const qLines = [
    { kind: 'title', description: 'Living room' },
    { kind: 'item', description: 'Power points', service: 'ELEC', qty: 10, unitPrice: 60 },
    { kind: 'item', description: 'Ceiling lights', service: 'ELEC', qty: 4, unitPrice: 100 },
  ];
  const q = { contractSum: 900, discountMode: '$', discountValue: 100, showUnit: false };
  const deposit = { id: 'ST-1', name: 'Deposit', isFinal: false, amount: 270, xeroInvoiceId: 'x-1', xeroInvoiceNumber: 'INV-261101-01' };
  const st = finalStage({ amount: 680, balance: 630, settling: [{ id: 'Q-2', voNumber: 1, title: 'Extra socket', contractSum: 50 }] });
  const itemise = finalItemisation({ quote: q, stages: [st], schedule: { stages: [deposit, st] }, lines: qLines, categories });
  const inv = buildStageInvoice({ ...base, stages: [st], itemise, contractSum: 900 });
  assert.deepEqual(inv.LineItems.map(l => l.Description), [
    'LIVING ROOM', 'Power points', 'Ceiling lights', 'Less: discount', 'Less: Deposit (INV-261101-01)', 'Add: VO1 – Extra socket',
  ]);
  assert.equal(inv.LineItems[0].Quantity, undefined);   // title row: description only
  assert.equal(xeroTotal(inv), 680);
});

test('keeps the one balance line when itemising does not apply', () => {
  const st = finalStage();
  const unbilled = { id: 'ST-1', name: 'Deposit', isFinal: false, amount: 50, xeroInvoiceId: '' };
  // another stage still unbilled with an amount
  assert.equal(finalItemisation({ quote, stages: [st], schedule: { stages: [unbilled, st] }, lines, categories }), null);
  // billed together with another stage
  assert.equal(finalItemisation({ quote, stages: [unbilled, st], schedule: { stages: [unbilled, st] }, lines, categories }), null);
  // not the final
  assert.equal(finalItemisation({ quote, stages: [unbilled], schedule: { stages: [unbilled, st] }, lines, categories }), null);
  // no itemise → the old single line, unchanged
  const inv = buildStageInvoice({ ...base, stages: [st] });
  assert.equal(inv.LineItems.length, 1);
  assert.equal(inv.LineItems[0].Description, 'Final payment (balance), balance of contract sum $298.00');
});

test('lines that do not add up to the amount due are refused, not sent', () => {
  const st = finalStage({ amount: 297 });
  const itemise = finalItemisation({ quote, stages: [st], schedule: { stages: [st] }, lines, categories });
  assert.throws(() => buildStageInvoice({ ...base, stages: [st], itemise }), /add up to \$298\.00/);
});

test('decimal quantities total the way Xero rounds them', () => {
  const l = [{ kind: 'item', description: 'Skim coat', service: '', qty: 91.5, unitPrice: 6.55 }];
  const { items } = quoteLineItems({ lines: l, accountCode: '200' });
  assert.equal(lineAmount(items[0].Quantity, items[0].UnitAmount), 599.33);
});

test('the itemised invoice is adopted on retry by its own lines', () => {
  const st = finalStage();
  const itemise = finalItemisation({ quote, stages: [st], schedule: { stages: [st] }, lines, categories });
  const inv = buildStageInvoice({ ...base, stages: [st], itemise });
  const found = { ...inv, Total: 298, Contact: { ContactID: 'c-1' } };
  assert.equal(matchesStageInvoice(found, { contactId: 'c-1', amount: 298, reference: '293C Example St', lines: inv.LineItems }), true);
  const oneLine = buildStageInvoice({ ...base, stages: [st] });
  assert.equal(matchesStageInvoice(found, { contactId: 'c-1', amount: 298, reference: '293C Example St', lines: oneLine.LineItems }), false);
});

test('lines that do not match the contract sum, or a blank description, block the bill with a message', () => {
  const st = finalStage();
  const off = finalItemisation({ quote: { ...quote, contractSum: 300 }, stages: [st], schedule: { stages: [st] }, lines, categories });
  assert.match(off.problem, /add up to \$298\.00 but the saved contract sum is \$300\.00/);
  const blank = lines.map((l, i) => (i === 3 ? { ...l, description: '  ' } : l));
  const b = finalItemisation({ quote, stages: [st], schedule: { stages: [st] }, lines: blank, categories });
  assert.match(b.problem, /Quote line 4 has no description/);
});
