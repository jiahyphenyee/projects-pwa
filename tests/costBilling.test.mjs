import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refToWrite, billingMode } from '../lib/costBilling.mjs';

test('invoice_ref: kept on a plain tick, set when billed direct, cleared on untick', () => {
  assert.equal(refToWrite(true, undefined), undefined);
  assert.equal(refToWrite(true, ' INV-2610-004 '), 'INV-2610-004');
  assert.equal(refToWrite(true, ''), '');
  assert.equal(refToWrite(false, 'INV-2610-004'), '');
});

test('billing mode from the stored pair', () => {
  assert.equal(billingMode({ invoiced: false, invoiceRef: 'X' }), 'none');
  assert.equal(billingMode({ invoiced: true, invoiceRef: '' }), 'project');
  assert.equal(billingMode({ invoiced: true, invoiceRef: 'INV-1' }), 'direct');
});
