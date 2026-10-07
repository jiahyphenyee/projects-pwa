import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoInvoice, describeWithUnit } from '../lib/voInvoice.mjs';

const lines = [
  { kind: 'title', description: 'Living room' },
  { kind: 'item', description: 'Supply & install 13A socket', service: 'ELEC', qty: 3, unit: 'pcs', unitPrice: 88 },
  { kind: 'item', description: 'Gypsum board partition wall', service: 'CEIL', qty: 91.5, unit: 'sqft', unitPrice: 6.55 },
  { kind: 'title', description: '' },
  { kind: 'item', description: 'Disposal', service: '', qty: 1, unit: '', unitPrice: 120 },
];
const tracking = { ELEC: 'Electrical', CEIL: 'Partition / Ceiling' };
const base = {
  contactId: 'c-1', invoiceNumber: 'INV-261007-02', date: '2026-10-07', dueDate: '2026-10-21',
  reference: '12 Example Road', accountCode: '200', voNumber: 2, lines,
  discountMode: '', discountValue: null, trackingFor: code => tracking[code] || '',
};

test('unit is appended to the description', () => {
  assert.equal(describeWithUnit('Gypsum board partition wall', 'sqft'), 'Gypsum board partition wall (per sqft)');
  assert.equal(describeWithUnit('Disposal', ''), 'Disposal');
});

test('a VO invoice has a VO header, titles as text, one line per item with its Service', () => {
  const { invoice, total, contractSum } = buildVoInvoice(base);
  assert.equal(invoice.Status, 'AUTHORISED');
  assert.equal(invoice.LineAmountTypes, 'NoTax');
  assert.equal(invoice.Reference, '12 Example Road');
  assert.deepEqual(invoice.LineItems.map(l => l.Description), [
    'Variation order VO2',
    'LIVING ROOM',
    'Supply & install 13A socket (per pcs)',
    'Gypsum board partition wall (per sqft)',
    'Disposal',
  ]);
  assert.deepEqual(invoice.LineItems[0], { Description: 'Variation order VO2' });
  assert.deepEqual(invoice.LineItems[1], { Description: 'LIVING ROOM' });
  assert.deepEqual(invoice.LineItems[3].Tracking, [{ Name: 'Service', Option: 'Partition / Ceiling' }]);
  assert.equal(invoice.LineItems[4].Tracking, undefined);
  // 264 + 599.33 (91.5 × 6.55 = 599.325 → 599.33) + 120
  assert.equal(total, 983.33);
  assert.equal(contractSum, 983.33);
});

test('a discount is a final negative line and the total still matches', () => {
  const { invoice, total } = buildVoInvoice({ ...base, discountMode: '%', discountValue: 10 });
  const last = invoice.LineItems.at(-1);
  assert.deepEqual(last, { Description: 'Less: discount', Quantity: 1, UnitAmount: -98.33, AccountCode: '200' });
  assert.equal(total, 885);
  const flat = buildVoInvoice({ ...base, discountMode: '$', discountValue: 83.33 });
  assert.equal(flat.total, 900);
});

test('an empty or zero VO is refused, and so is one with no contact', () => {
  assert.throws(() => buildVoInvoice({ ...base, lines: [{ kind: 'title', description: 'x' }] }));
  assert.throws(() => buildVoInvoice({ ...base, contactId: '' }));
});
