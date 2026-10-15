import { formatAmount } from '@/app/components/TotalsCard';

/** "$1,234.50", "−$80.00", or "—" for a figure that does not exist yet. */
export function money(n) {
  if (n === null || n === undefined) return '—';
  return n < 0 ? `−$${formatAmount(-n)}` : `$${formatAmount(n)}`;
}

/** A 0–1 ratio as a whole percent; "—" when there is no ratio. */
export function percent(r) {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—';
  return `${Math.round(r * 100)}%`;
}

/** Tag palette for each status flag and invoice state, from lib/theme's `tag`. */
export const FLAG_VARIANT = {
  onTrack: 'invoiced', healthy: 'invoiced',
  watch: 'notInvoiced', belowTarget: 'notInvoiced',
  overBudget: 'danger', loss: 'danger',
};

export const INVOICE_STATE = {
  paid:    { label: 'Paid',        variant: 'invoiced'    },
  unpaid:  { label: 'Unpaid',      variant: 'neutral'     },
  chase:   { label: 'Chase',       variant: 'notInvoiced' },
  overdue: { label: 'Overdue',     variant: 'danger'      },
  credit:  { label: 'Credit note', variant: 'receipted'   },
};
