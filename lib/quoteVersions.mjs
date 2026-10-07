// Which line versions a save writes and which a prune may delete. Pure, because getting
// either wrong loses a quote's lines: on 2026-10-07 a prune that deleted "every version but
// current" ran while the next save was mid-commit, saw that save's new lines as old, and
// deleted them a moment before they became current.

/** The version a new save writes: above every version on the tab, orphans included. */
export function nextVersion(currentVersion, lineVersions) {
  return Math.max(currentVersion, ...lineVersions) + 1;
}

/**
 * The versions a prune may delete: strictly below current, and not one a billed stage was
 * invoiced from. Anything above current belongs to a save still in flight (or an orphan
 * that a later save will pass), so it is never touched.
 */
export function prunableVersions(currentVersion, lineVersions, billedVersions = []) {
  const billed = new Set(billedVersions);
  return [...new Set(lineVersions)].filter(v => v < currentVersion && !billed.has(v)).sort((a, b) => a - b);
}
