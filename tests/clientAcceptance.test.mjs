import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientAccepted, acceptanceBlocker, clientStatusChange } from '../lib/clientAcceptance.mjs';
import { settlingBlocker, attemptInFlight } from '../lib/clientAcceptance.mjs';

test('only an accepted quote may be billed', () => {
  assert.equal(clientAccepted({ clientStatus: 'accepted' }), true);
  assert.equal(clientAccepted({ clientStatus: 'Accepted ' }), true);
  assert.equal(clientAccepted({ clientStatus: 'sent' }), false);
  assert.equal(clientAccepted({ clientStatus: '' }), false);
  assert.match(acceptanceBlocker({ clientStatus: 'sent' }), /has not accepted/);
  assert.match(acceptanceBlocker({ clientStatus: 'declined' }, { what: 'variation order' }), /declined this variation order/);
  assert.equal(acceptanceBlocker({ clientStatus: 'accepted' }), null);
});

test('a quote billed before this rule existed keeps billing', () => {
  assert.equal(clientAccepted({ clientStatus: '' }, { anyBilled: true }), true);
  // but an explicit answer always wins
  assert.equal(clientAccepted({ clientStatus: 'declined' }, { anyBilled: true }), false);
});

test('status changes set the right dates', () => {
  const today = '2026-10-27';
  assert.deepEqual(clientStatusChange({}, 'sent', { today }), { clientStatus: 'sent', clientSentAt: today, clientAcceptedAt: '' });
  assert.deepEqual(clientStatusChange({ clientSentAt: '2026-10-20' }, 'accepted', { date: '2026-10-25', today }),
    { clientStatus: 'accepted', clientSentAt: '2026-10-20', clientAcceptedAt: '2026-10-25' });
  assert.deepEqual(clientStatusChange({}, 'accepted', { today }), { clientStatus: 'accepted', clientSentAt: today, clientAcceptedAt: today });
  assert.deepEqual(clientStatusChange({ clientSentAt: '2026-10-20' }, 'declined', { today }),
    { clientStatus: 'declined', clientSentAt: '2026-10-20', clientAcceptedAt: today });
});

test('bad input and billed quotes are refused', () => {
  const today = '2026-10-27';
  assert.ok(clientStatusChange({}, 'maybe', { today }).error);
  assert.ok(clientStatusChange({}, 'sent', { date: '27/10/2026', today }).error);
  assert.ok(clientStatusChange({}, 'accepted', { date: '2026-10-28', today }).error);
  assert.ok(clientStatusChange({}, 'declined', { today, anyBilled: true }).error);
  assert.ok(clientStatusChange({ xeroInvoiceId: 'x' }, 'sent', { today }).error);
  assert.equal(clientStatusChange({ xeroInvoiceId: 'x' }, 'accepted', { today }).clientStatus, 'accepted');
});

test('settlingBlocker: VOs on the final invoice need the client\'s yes', () => {
  assert.equal(settlingBlocker({ voNumber: 1, clientStatus: 'accepted', createdAt: '2026-11-02T10:00:00' }), null);
  assert.match(settlingBlocker({ voNumber: 2, clientStatus: 'declined', createdAt: '2026-01-01' }), /declined VO2/);
  // legacy: blank answer, written before the rule began
  assert.equal(settlingBlocker({ voNumber: 3, clientStatus: '', createdAt: '2026-10-01T09:00:00' }), null);
  assert.equal(settlingBlocker({ voNumber: 3, clientStatus: '', createdAt: 46296 }), null); // serial, 2026-10-01
  // new: blank or only sent, written on/after the rule
  assert.match(settlingBlocker({ voNumber: 4, clientStatus: '', createdAt: '2026-10-28T08:00:00' }), /not accepted VO4/);
  assert.match(settlingBlocker({ voNumber: 5, clientStatus: 'sent', createdAt: '2026-09-01' }), /not accepted VO5/);
  assert.match(settlingBlocker({ voNumber: 6, clientStatus: '', createdAt: '' }), /not accepted VO6/);
});

test('attemptInFlight: a kept number with no invoice is a retry, never blocked', () => {
  assert.equal(attemptInFlight({ xeroInvoiceNumber: 'INV-1', xeroSyncStatus: 'sending' }), true);
  assert.equal(attemptInFlight({ xeroInvoiceNumber: 'INV-1', xeroSyncStatus: 'error' }), true);
  assert.equal(attemptInFlight({ xeroInvoiceNumber: 'INV-1', status: 'error' }), true); // a VO
  assert.equal(attemptInFlight({ xeroInvoiceNumber: 'INV-1', xeroInvoiceId: 'x', xeroSyncStatus: 'sending' }), false);
  assert.equal(attemptInFlight({ xeroInvoiceNumber: '', xeroSyncStatus: 'error' }), false);
  assert.equal(attemptInFlight({ xeroInvoiceNumber: 'INV-1', status: 'draft' }), false);
});
