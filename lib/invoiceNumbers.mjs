// Invoice numbers: INV-YYMMDD-XX, where the date is the invoice date in Singapore and XX
// counts up from 01 within that date. Pure; the caller supplies every number already in
// use for the date — from this app's own records AND from Xero — so a number William typed
// by hand in Xero is never reused.
//
// The two-digit year is William's own hand-typed format (INV-261005-01); the spec's
// four-digit year was changed on 2026-10-06.

/** "2026-10-07" → "INV-261007" */
export function invoicePrefix(isoDate) {
  const m = /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) throw new Error(`Invoice date must be YYYY-MM-DD, got "${isoDate}"`);
  return `INV-${m[1]}${m[2]}${m[3]}`;
}

/**
 * The next free number for a date. Only numbers of the exact form PREFIX-NN count towards
 * the sequence: a bare "INV-261007" typed by hand cannot clash with "INV-261007-01", and
 * "INV-261007-03a" is not a sequence number. `skip` adds numbers to avoid on top of those,
 * used after Xero rejects one as a duplicate.
 */
export function nextInvoiceNumber(isoDate, existingNumbers, skip = []) {
  const prefix = invoicePrefix(isoDate);
  const pattern = new RegExp(`^${prefix}-(\\d{2,})$`, 'i');
  let max = 0;
  for (const n of [...existingNumbers, ...skip]) {
    const m = pattern.exec(String(n || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

/** Add days to an ISO date without touching time zones. */
export function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + Number(days)));
  return t.toISOString().slice(0, 10);
}
