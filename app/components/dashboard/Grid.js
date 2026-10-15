'use client';

// Responsive grids for dashboard screens, with no media queries: each column has a
// minimum width, and `min(100%, …)` lets a single column shrink to a phone instead of
// overflowing it. Tiles fall to two per row on a phone; panels fall to one, in source
// order — which is why a dashboard's panels are written in priority order.

import { space } from '@/lib/theme';

const grid = minPx => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minPx}px), 1fr))`,
  gap: space.md,
  minWidth: 0,
});

/** Headline figures. 150px fits two across a 390px phone inside the page padding. */
export function TileGrid({ children }) {
  return <div style={grid(150)}>{children}</div>;
}

/** Panels side by side on a desk, stacked on a phone. */
export function PanelGrid({ children }) {
  return <div style={{ ...grid(440), gap: space.lg, alignItems: 'start' }}>{children}</div>;
}

/** The dashboard page itself: blocks one under another, evenly spaced. */
export function DashboardStack({ children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 }}>{children}</div>;
}
