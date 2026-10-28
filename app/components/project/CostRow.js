'use client';

import LineRow from '@/app/components/LineRow';
import Tag from '@/app/components/Tag';
import { formatRowAmount } from '@/app/components/TotalsCard';
import { formatIsoDate } from '@/lib/dates';
import { color, radius } from '@/lib/theme';

// Identical on every row, so every amount's right edge lands in the same place. Wider than
// the 44px tap target inside it only so the word "Invoiced" fits in the column header —
// without that header the tick box has nothing to say what it means.
export const ACTION_WIDTH = 58;

/**
 * One cost line, of either kind.
 *
 * Deliberately one component rather than two: the lists are merged, so any difference in
 * how they render reads as a difference in what they mean. Only three things actually
 * differ — the word "Receipted", the payee, and whether the label opens the editor.
 *
 * Exactly one tag, the category code. Everything else that merely describes the row —
 * where it came from, when, who was paid — is quiet grey text next to the date, because a
 * pill is a claim on the eye and only the trade earns one. The code, not the name, so a
 * trade reads identically whichever tab the row came from: `Project costs` joins a display
 * name from `Categories` and the Expenses tab has only the code, and "Electrical" sitting
 * above "ELEC" looks like two different things.
 *
 * The cost type (material / labour / transport) is not shown here; it drives the cost
 * split on the Summary instead.
 *
 * Without `onToggle` the row has no invoiced tick — the Summary's "Latest costs" shows
 * the same rows read-only, because a dashboard never edits in place.
 */
export default function CostRow({ line, first, busy, duplicateOf, onToggle, onEdit, onOpen }) {
  // Description is what identifies the cost to a human. Falling back to the category, use
  // the readable name rather than the code — a bare "ELEC" as a whole row label is worse
  // than "Electrical", even though the tag itself is the code.
  const label = line.description || line.categoryName || line.id;

  // Reads as one quiet clause: what it is, when, and who was paid.
  const meta = [
    line.receipted ? (line.xeroBillId ? 'Receipted 📎' : 'Receipted') : null,
    formatIsoDate(line.date),
    line.payeeName || null,
    // Same amount in the other ledger. Quiet text, not a tag: often it is a genuine second
    // purchase, and nothing is excluded from any total because of it.
    duplicateOf?.length ? `possible duplicate of ${duplicateOf.join(', ')}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <LineRow
      first={first}
      dimmed={busy}
      onLabelClick={onOpen || onEdit}
      labelVerb={onOpen ? 'Open' : 'Edit'}
      clampLines={2}
      label={label}
      amount={formatRowAmount(line.amount)}
      meta={meta}
      tags={
        <>
          {line.categoryCode && <Tag variant="neutral">{line.categoryCode}</Tag>}
          {line.status === 'pending' && <Tag variant="notInvoiced">Pending review</Tag>}
          {line.invoiced && line.invoiceRef && <Tag variant="invoiced">Billed direct · {line.invoiceRef}</Tag>}
        </>
      }
      action={onToggle && (
        // The box alone, with no word beside it. The words were a second block of text on
        // the row competing with the label for the eye, and 118px wide — on a phone that
        // is a third of the row spent restating what a tick already says. The state is
        // still named, in the accessible name and by the Show filter above the list.
        //
        // The button is a full 44px tap target with a 26px box drawn inside it, so the
        // target never shrinks below what a thumb needs. Fixed width, like every other
        // row's, which is what keeps the amounts aligned down the page.
        <button
          onClick={onToggle}
          disabled={busy}
          role="switch"
          aria-checked={line.invoiced}
          aria-label={`${label}, ${formatRowAmount(line.amount)} — ${line.invoiced ? 'invoiced' : 'not invoiced'}`}
          className="ghost-button"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: ACTION_WIDTH, height: 44, flexShrink: 0,
            background: 'transparent', border: 'none', borderRadius: radius.md,
            cursor: busy ? 'wait' : 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span aria-hidden style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            border: `1.5px solid ${line.invoiced ? color.primary : color.subtle}`,
            background: line.invoiced ? color.primary : 'transparent',
            color: '#fff', fontSize: 15, lineHeight: 1, fontWeight: 700,
          }}>{line.invoiced ? '✓' : ''}</span>
        </button>
      )}
    />
  );
}
