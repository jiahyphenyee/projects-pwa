import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoicePrefix, nextInvoiceNumber, addDays } from '../lib/invoiceNumbers.mjs';
import { stageLineDescription, buildStageInvoice, matchesStageInvoice } from '../lib/stageInvoice.mjs';

test('prefix uses a two-digit year', () => {
  assert.equal(invoicePrefix('2026-10-07'), 'INV-261007');
  assert.throws(() => invoicePrefix('7 Oct 2026'));
});

test('the first invoice of a date is -01, the next -02', () => {
  assert.equal(nextInvoiceNumber('2026-10-07', []), 'INV-261007-01');
  assert.equal(nextInvoiceNumber('2026-10-07', ['INV-261007-01']), 'INV-261007-02');
});

test('numbers typed by hand in Xero are skipped; other dates and other shapes are ignored', () => {
  const xero = ['INV-261007-01', 'INV-261007-03', 'INV-261006-09', 'INV-261007', 'INV-261007-04a', 'INV-20261007-05'];
  assert.equal(nextInvoiceNumber('2026-10-07', xero), 'INV-261007-04');
});

test('a number Xero rejected is skipped on retry', () => {
  assert.equal(nextInvoiceNumber('2026-10-07', ['INV-261007-01'], ['INV-261007-02']), 'INV-261007-03');
});

test('due date is 14 days on, across a month end', () => {
  assert.equal(addDays('2026-10-20', 14), '2026-11-03');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
});

test('stage line description names the stage, share and contract sum', () => {
  assert.equal(
    stageLineDescription({ name: 'Progress payment 1', sharePct: 20, contractSum: 5070 }),
    'Progress payment 1, 20% of contract sum $5,070.00'
  );
  assert.equal(
    stageLineDescription({ name: 'Deposit', sharePct: 33.33, contractSum: 999.99 }),
    'Deposit, 33.33% of contract sum $999.99'
  );
  assert.equal(
    stageLineDescription({ name: 'Final payment (balance)', isFinal: true, contractSum: 5070 }),
    'Final payment (balance), balance of contract sum $5,070.00'
  );
});

const base = {
  contactId: 'c-1', invoiceNumber: 'INV-261007-01', date: '2026-10-07', dueDate: '2026-10-21',
  reference: '12 Example Road', accountCode: '200', trackingOption: '',
  stage: { name: 'Deposit', sharePct: 30, amount: 1521, isFinal: false }, contractSum: 5070,
};

test('a stage invoice is one approved, untaxed line against the ContactID', () => {
  const inv = buildStageInvoice(base);
  assert.equal(inv.Type, 'ACCREC');
  assert.equal(inv.Status, 'AUTHORISED');
  assert.deepEqual(inv.Contact, { ContactID: 'c-1' });
  assert.equal(inv.Contact.Name, undefined);
  assert.equal(inv.LineAmountTypes, 'NoTax');
  assert.equal(inv.Reference, '12 Example Road');
  assert.equal(inv.LineItems.length, 1);
  assert.deepEqual(inv.LineItems[0], {
    Description: 'Deposit, 30% of contract sum $5,070.00', Quantity: 1, UnitAmount: 1521, AccountCode: '200',
  });
});

test('tracking is added only when an option is configured', () => {
  assert.deepEqual(buildStageInvoice({ ...base, trackingOption: 'General' }).LineItems[0].Tracking, [{ Name: 'Service', Option: 'General' }]);
});

test('no contact or a zero amount is refused', () => {
  assert.throws(() => buildStageInvoice({ ...base, contactId: '' }));
  assert.throws(() => buildStageInvoice({ ...base, stage: { ...base.stage, amount: 0 } }));
});

test('an invoice found in Xero is adopted only if it is this stage\'s', () => {
  const found = { Contact: { ContactID: 'c-1' }, Total: 1521, Reference: '12 Example Road', Status: 'AUTHORISED' };
  const want = { contactId: 'c-1', amount: 1521, reference: '12 Example Road' };
  assert.equal(matchesStageInvoice(found, want), true);
  assert.equal(matchesStageInvoice({ ...found, Total: 1520 }, want), false);
  assert.equal(matchesStageInvoice({ ...found, Contact: { ContactID: 'c-2' } }, want), false);
  assert.equal(matchesStageInvoice({ ...found, Status: 'VOIDED' }, want), false);
  assert.equal(matchesStageInvoice(null, want), false);
});
