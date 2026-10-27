// The client's answer to a quote or variation order, and what it allows.
//
// `Quotes.client_status` (AA) is blank, sent, accepted or declined. It is the client's side
// of the quote; `Quotes.status` stays our billing state (draft / sending / billed / error).
//
// No invoice before the client accepts (William, 27 Oct 2026). One exception keeps jobs
// already under way moving: a quote with a blank client status that has already been
// billed counts as accepted, since it was billed before this rule existed. Pure, tested.

export const CLIENT_STATUSES = ['sent', 'accepted', 'declined'];

// The day this rule began. A VO written before it has no client answer on record, so a
// blank one is let through onto the final invoice; one written after must be accepted.
export const ACCEPTANCE_RULE_FROM = '2026-10-28';

export const CLIENT_STATUS_LABELS = {
  '':       'Not sent',
  sent:     'Sent to client',
  accepted: 'Client accepted',
  declined: 'Client declined',
};

const norm = s => String(s || '').trim().toLowerCase();

/** True when the client has accepted, or the quote was billed before this rule existed. */
export function clientAccepted(quote, { anyBilled = false } = {}) {
  const s = norm(quote?.clientStatus);
  return s === 'accepted' || (!s && anyBilled);
}

/** The reason billing must wait for the client, in words for the confirm step; null when it need not. */
export function acceptanceBlocker(quote, { anyBilled = false, what = 'quote' } = {}) {
  if (clientAccepted(quote, { anyBilled })) return null;
  return norm(quote?.clientStatus) === 'declined'
    ? `The client declined this ${what}. If they have since agreed, mark it accepted on the Quotes page first.`
    : `The client has not accepted this ${what} yet. Mark it accepted on the Quotes page first.`;
}

/**
 * The checked change for one client-status update, or { error }.
 * `date` is the day it happened (YYYY-MM-DD), defaulting to today.
 *   sent     → client_sent_at = date (accepted date untouched)
 *   accepted → client_accepted_at = date, client_sent_at filled if blank
 *   declined → client_accepted_at = date (the day of the answer)
 * A quote or VO with anything billed cannot be marked declined or un-sent.
 */
export function clientStatusChange(quote, status, { date, today, anyBilled = false } = {}) {
  const next = norm(status);
  if (next && !CLIENT_STATUSES.includes(next)) return { error: `Status must be one of: ${CLIENT_STATUSES.join(', ')}` };
  const day = date || today;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Date must be YYYY-MM-DD' };
  if (day && today && day > today) return { error: 'The date cannot be in the future' };
  const billed = anyBilled || !!quote?.xeroInvoiceId;
  if (billed && next !== 'accepted') return { error: 'This has been invoiced, or an invoice for it is being created, so it can only be marked accepted.' };

  if (next === 'sent')     return { clientStatus: 'sent', clientSentAt: day, clientAcceptedAt: quote?.clientAcceptedAt || '' };
  if (next === 'accepted') return { clientStatus: 'accepted', clientSentAt: quote?.clientSentAt || day, clientAcceptedAt: day };
  if (next === 'declined') return { clientStatus: 'declined', clientSentAt: quote?.clientSentAt || '', clientAcceptedAt: day };
  return { clientStatus: '', clientSentAt: '', clientAcceptedAt: '' };
}

/**
 * True while an earlier billing attempt may have reached Xero: a number is stored but no
 * invoice is recorded (`sending`, or `error` after a timeout). Its retry must never be
 * blocked, since the retry is what finds that invoice. `row` is a stage or a VO.
 */
export function attemptInFlight(row) {
  if (!row || row.xeroInvoiceId || !row.xeroInvoiceNumber) return false;
  const state = norm(row.xeroSyncStatus ?? row.status);
  return state === 'sending' || state === 'error';
}

/**
 * The reason one VO may not go onto the final payment invoice, or null. Declined never
 * may. A blank answer may only on a VO written before the rule began (`createdAt`, ISO).
 */
export function settlingBlocker(vo) {
  const s = norm(vo?.clientStatus);
  const name = `VO${vo?.voNumber ?? ''}`;
  if (s === 'accepted') return null;
  if (s === 'declined') return `The client declined ${name}. Mark it accepted on the Quotes page, or remove its lines, before the final invoice.`;
  // createdAt is ISO text, but a sheet may hand back a date serial number
  const raw = vo?.createdAt;
  const created = typeof raw === 'number'
    ? new Date(Math.round((raw - 25569) * 86400000)).toISOString().slice(0, 10)
    : String(raw || '').slice(0, 10);
  if (!s && created && created < ACCEPTANCE_RULE_FROM) return null;
  return `The client has not accepted ${name} yet. Mark it accepted on the Quotes page before the final invoice.`;
}
