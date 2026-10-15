'use client';

// Amount formatting shared by every screen. The card this file was named for is gone —
// the project's cost now shows on its Summary tiles and its Costs view — but the
// formatters stayed so their many imports did not have to move.

export function formatAmount(n) {
  return (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A single row's amount. An unreadable cell shows as an em dash, never as 0.00 — a
 * total may legitimately be zero, but a line item that renders zero because its cell
 * could not be parsed is a broken read wearing the costume of a real figure.
 */
export function formatRowAmount(n) {
  return n === null || n === undefined ? '—' : formatAmount(n);
}
