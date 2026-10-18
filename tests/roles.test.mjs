import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, can, hasAccess } from '../lib/roles.mjs';

const { SUMMARY, QUOTES, INVOICES } = PERMISSIONS;

test('admin and boss_man can do everything', () => {
  for (const role of ['admin', 'boss_man']) {
    for (const p of [SUMMARY, QUOTES, INVOICES]) assert.equal(can(role, p), true, `${role} ${p}`);
  }
});

test('office can quote, bill and see Xero invoices, but not the Summary', () => {
  assert.equal(can('office', QUOTES), true);
  assert.equal(can('office', INVOICES), true);
  assert.equal(can('office', SUMMARY), false);
});

test('any other role has no access at all', () => {
  for (const role of ['senior_worker', 'user', '', undefined, null, 'constructor', 'toString']) {
    assert.equal(hasAccess(role), false, String(role));
    assert.equal(can(role, QUOTES), false, String(role));
  }
});

test('roles typed into the sheet are matched ignoring case and spaces', () => {
  assert.equal(hasAccess(' Office '), true);
  assert.equal(can('ADMIN', SUMMARY), true);
});
