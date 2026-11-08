import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayLiveBilled, anyMissing, invoiceMap } from '../lib/liveBilled.mjs';

const docs = [
  { kind: 'invoice', id: 'x-dep', number: 'INV-261101-01', status: 'AUTHORISED', total: 450 },   // edited in Xero: was 500
  { kind: 'invoice', id: 'x-pp',  number: 'INV-261105-01', status: 'PAID',       total: 1000 },  // unchanged
  { kind: 'invoice', id: 'x-two', number: 'INV-261106-01', status: 'AUTHORISED', total: 1180 },  // two stages, was 1200
  { kind: 'invoice', id: 'x-fin', number: 'INV-261107-01', status: 'AUTHORISED', total: 2050 },  // final 2050 incl. VO 50, unchanged
  { kind: 'invoice', id: 'x-fin2', number: 'INV-261107-02', status: 'AUTHORISED', total: 1900 }, // final 2050 incl. VO 50, cut by 150
  { kind: 'invoice', id: 'x-clm', number: 'INV-261108-01', status: 'AUTHORISED', total: 830 },   // claim 800 + VO 50, cut by 20
  { kind: 'credit',  id: 'c-1',   number: 'CN-0001',       status: 'AUTHORISED', total: 100 },
];
const byId = invoiceMap(docs);

const stages = [
  { id: 'ST-1', name: 'Deposit', isFinal: false, billedAmount: 500, xeroInvoiceId: 'x-dep', xeroInvoiceNumber: 'INV-261101-01' },
  { id: 'ST-2', name: 'Progress payment 1', isFinal: false, billedAmount: 1000, xeroInvoiceId: 'x-pp', xeroInvoiceNumber: 'INV-261105-01' },
  { id: 'ST-3', name: 'Progress payment 2', isFinal: false, billedAmount: 700, xeroInvoiceId: 'x-two', xeroInvoiceNumber: 'INV-261106-01' },
  { id: 'ST-4', name: 'Progress payment 3', isFinal: false, billedAmount: 500, xeroInvoiceId: 'x-two', xeroInvoiceNumber: 'INV-261106-01' },
  // A billed final stores the total due, VOs included (lib/billing.js recordBilled)
  { id: 'ST-5', name: 'Final payment (balance)', isFinal: true, billedAmount: 2050, xeroInvoiceId: 'x-fin', xeroInvoiceNumber: 'INV-261107-01' },
  { id: 'ST-6', name: 'Unbilled', isFinal: false, billedAmount: null, xeroInvoiceId: '' },
  { id: 'ST-7', name: 'In flight', isFinal: false, billedAmount: null, xeroInvoiceId: '', xeroInvoiceNumber: 'INV-261108-09', xeroSyncStatus: 'sending:abc' },
];
const vos = [
  { id: 'Q-0005', kind: 'vo', contractSum: 50, billedAmount: 50, xeroInvoiceId: 'x-fin', xeroInvoiceNumber: 'INV-261107-01' },
  { id: 'Q-0006', kind: 'vo', contractSum: 300, billedAmount: 300, xeroInvoiceId: 'x-gone', xeroInvoiceNumber: 'INV-261020-01', xeroSyncStatus: 'billed' },
];

test('a single-row invoice edited in Xero takes the Xero total; the Sheet figure is kept aside', () => {
  const out = overlayLiveBilled({ stages, vos }, byId);
  const dep = out.stages[0];
  assert.equal(dep.billedAmount, 450);
  assert.equal(dep.sheetAmount, 500);
  assert.equal(dep.voided, undefined);
  assert.equal(stages[0].billedAmount, 500);   // input untouched
});

test('an unchanged invoice leaves the row alone', () => {
  const out = overlayLiveBilled({ stages, vos }, byId);
  assert.equal(out.stages[1].billedAmount, 1000);
  assert.equal(out.stages[1].sheetAmount, undefined);
});

test('several stages on one changed invoice are flagged, never split by guesswork', () => {
  const out = overlayLiveBilled({ stages, vos }, byId);
  for (const r of [out.stages[2], out.stages[3]]) {
    assert.equal(r.billedAmount, r.id === 'ST-3' ? 700 : 500);
    assert.deepEqual(r.liveMismatch, { invoiceNumber: 'INV-261106-01', xeroTotal: 1180, sheetTotal: 1200 });
  }
});

test('a final with the VO it settled: the final already includes the VO, so nothing is touched when the total matches', () => {
  const out = overlayLiveBilled({ stages, vos }, byId);
  assert.equal(out.stages[4].billedAmount, 2050);
  assert.equal(out.vos[0].billedAmount, 50);
  assert.equal(out.stages[4].liveMismatch, undefined);
  assert.equal(out.vos[0].liveMismatch, undefined);
});

test('a final with its VO, edited in Xero: the final takes the new total, the VO keeps its accepted price', () => {
  const st = [{ ...stages[4], xeroInvoiceId: 'x-fin2', xeroInvoiceNumber: 'INV-261107-02' }];
  const vo = [{ ...vos[0], xeroInvoiceId: 'x-fin2', xeroInvoiceNumber: 'INV-261107-02' }];
  const out = overlayLiveBilled({ stages: st, vos: vo }, byId);
  assert.equal(out.stages[0].billedAmount, 1900);
  assert.equal(out.stages[0].sheetAmount, 2050);
  assert.equal(out.vos[0].billedAmount, 50);
});

test('a final billed together with another stage, plus its VO: the VO does not count twice', () => {
  const st = [
    { id: 'ST-1', name: 'Deposit', isFinal: false, billedAmount: 500, xeroInvoiceId: 'x-fin', xeroInvoiceNumber: 'INV-261107-01' },
    { id: 'ST-5', name: 'Final payment (balance)', isFinal: true, billedAmount: 1550, xeroInvoiceId: 'x-fin', xeroInvoiceNumber: 'INV-261107-01' },
  ];
  const out = overlayLiveBilled({ stages: st, vos: vos.slice(0, 1) }, byId);   // Xero total 2050 = 500 + 1550
  assert.equal(out.stages[0].liveMismatch, undefined);
  assert.equal(out.stages[1].liveMismatch, undefined);
});

test('a claim with its VO, edited in Xero: the main part takes the difference', () => {
  const claims = [{ id: 'CLM-1', mainAmount: 800, voIds: ['Q-0005'], xeroInvoiceId: 'x-clm', xeroInvoiceNumber: 'INV-261108-01' }];
  const vo = [{ ...vos[0], xeroInvoiceId: 'x-clm', xeroInvoiceNumber: 'INV-261108-01' }];
  const out = overlayLiveBilled({ claims, vos: vo }, byId);
  assert.equal(out.claims[0].mainAmount, 780);
  assert.equal(out.claims[0].sheetAmount, 800);
  assert.equal(out.vos[0].billedAmount, 50);
});

test('a voided or deleted invoice makes its rows unbilled again, remembering the old number', () => {
  const out = overlayLiveBilled({ stages, vos }, byId);
  const v = out.vos[1];
  assert.equal(v.xeroInvoiceId, '');
  assert.equal(v.xeroInvoiceNumber, '');
  assert.equal(v.billedAmount, null);
  assert.equal(v.sheetAmount, 300);
  assert.deepEqual(v.voided, { invoiceId: 'x-gone', invoiceNumber: 'INV-261020-01', amount: 300 });
});

test('anyMissing says when a fresh read is needed', () => {
  assert.equal(anyMissing({ stages, vos }, byId), true);
  assert.equal(anyMissing({ stages: stages.slice(0, 5), vos: vos.slice(0, 1) }, byId), false);
  assert.equal(anyMissing({ stages: stages.slice(5) }, byId), false);   // unbilled and in flight do not count
});

test('unbilled and in-flight rows are left alone', () => {
  const out = overlayLiveBilled({ stages: stages.slice(5) }, byId);
  assert.equal(out.stages[0].billedAmount, null);
  assert.equal(out.stages[1].voided, undefined);
  assert.equal(out.stages[1].xeroInvoiceNumber, 'INV-261108-09');
});

test('credit notes are not invoices', () => {
  assert.equal(byId.has('c-1'), false);
  assert.equal(byId.size, 6);
});
