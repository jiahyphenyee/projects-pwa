import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion, prunableVersions } from '../lib/quoteVersions.mjs';

test('a save writes above every version on the tab, orphans included', () => {
  assert.equal(nextVersion(0, []), 1);
  assert.equal(nextVersion(3, [2, 3]), 4);
  assert.equal(nextVersion(3, [3, 4]), 5);   // 4 is an orphan from a failed save
});

test('prune deletes only versions below current', () => {
  assert.deepEqual(prunableVersions(5, [3, 4, 5]), [3, 4]);
});

test('prune never touches a save still in flight', () => {
  // The 2026-10-07 race: the prune read current = 17 while save 18 had already appended
  // its lines but not yet flipped the quote row.
  assert.deepEqual(prunableVersions(17, [16, 17, 18]), [16]);
});

test('prune keeps versions a billed stage was invoiced from', () => {
  assert.deepEqual(prunableVersions(6, [2, 3, 4, 5, 6], [3]), [2, 4, 5]);
});
