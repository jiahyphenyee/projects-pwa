'use client';

// The newest few costs, read-only, with the way into the full list. The same CostRow as
// the Costs view — a cost looks the same wherever it appears — minus the invoiced tick,
// because a dashboard never edits in place.

import Panel from '@/app/components/dashboard/Panel';
import { color, font } from '@/lib/theme';
import CostRow from './CostRow';

const SHOWN = 6;

export default function LatestCostsPanel({ code, lines, duplicates }) {
  const latest = lines.slice(0, SHOWN);
  return (
    <Panel
      title="Latest costs"
      subtitle={lines.length > SHOWN ? `Newest ${SHOWN} of ${lines.length}` : null}
      action={{ href: `/projects/${encodeURIComponent(code)}/costs`, label: lines.length ? 'All costs' : 'Add a cost' }}
    >
      {!lines.length && (
        <p style={{ margin: 0, fontSize: font.size.sm, color: color.muted }}>No costs recorded yet.</p>
      )}
      {latest.map((line, i) => (
        <CostRow key={line.id} line={line} first={i === 0} duplicateOf={duplicates[line.id]} />
      ))}
    </Panel>
  );
}
