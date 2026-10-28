'use client';

// The client's answer to this quote or VO, at the top of the quote screen: Not sent yet /
// Sent / Accepted / Declined, each with its date. No stage or VO can be billed until the
// client has accepted (lib/clientAcceptance.mjs, checked again by lib/billing.js).
//
// Written straight away to Quotes AA:AC through /api/quotes/client; it is not part of the
// quote's Save, so unsaved line edits are never needed to record it.

import { useState } from 'react';
import Tag from '@/app/components/Tag';
import { formatIsoDate, todaySingapore } from '@/lib/dates';
import { CLIENT_STATUS_LABELS, clientAccepted } from '@/lib/clientAcceptance.mjs';
import { button, card, color, dateInput, font, space } from '@/lib/theme';

const VARIANT = { '': 'neutral', sent: 'notInvoiced', accepted: 'invoiced', declined: 'danger' };

/**
 * `quote`: the saved quote or VO row. `billed`: something on it is invoiced, or an invoice
 * attempt may already be in Xero; it can then only be marked accepted.
 * `onChange(fields)`: the new clientStatus/clientSentAt/clientAcceptedAt.
 */
export default function ClientAnswer({ quote, billed, isVo, onChange }) {
  const [date, setDate] = useState(todaySingapore());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const status = quote.clientStatus || '';
  const implicit = !status && billed;   // billed before this step existed
  const shown = implicit ? 'accepted' : status;
  const accepted = clientAccepted(quote, { anyBilled: billed });
  const what = isVo ? 'variation order' : 'quote';

  const meta = [
    quote.clientSentAt && `sent ${formatIsoDate(quote.clientSentAt)}`,
    quote.clientAcceptedAt && `${status === 'declined' ? 'declined' : 'accepted'} ${formatIsoDate(quote.clientAcceptedAt)}`,
    implicit && 'billed before this step existed',
  ].filter(Boolean).join(' · ');

  const choices = [['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined']]
    .filter(([s]) => s !== shown)
    .filter(([s]) => !billed || s === 'accepted')
    .filter(([s]) => !(shown === 'accepted' && s === 'sent'));

  async function save(next) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/quotes/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: quote.id, status: next, date }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save');
      onChange({ clientStatus: body.quote.clientStatus, clientSentAt: body.quote.clientSentAt, clientAcceptedAt: body.quote.clientAcceptedAt });
    } catch (err) {
      setError(err instanceof TypeError ? 'Offline — the answer was not saved.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Client's answer" style={{ ...card, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
        <span style={{ fontSize: font.size.sm, fontWeight: 600 }}>Client</span>
        <Tag variant={VARIANT[shown] || 'neutral'}>{CLIENT_STATUS_LABELS[shown] || CLIENT_STATUS_LABELS['']}</Tag>
        {meta && <span style={{ fontSize: font.size.xs, color: color.muted }}>{meta}</span>}
      </div>
      {!accepted && (
        <span style={{ fontSize: font.size.xs, color: color.accent }}>
          This {what} cannot be billed until the client has accepted it.
        </span>
      )}
      {choices.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
          <label htmlFor={`client-date-${quote.id}`} style={{ fontSize: font.size.xs, color: color.muted }}>Client answered on</label>
          <input
            id={`client-date-${quote.id}`} type="date" value={date} max={todaySingapore()}
            onChange={e => setDate(e.target.value)}
            style={{ ...dateInput, width: 'auto', minWidth: 0, flex: '0 1 170px' }}
          />
          {choices.map(([s, text]) => (
            <button
              key={s} type="button" disabled={busy || !date} onClick={() => save(s)}
              style={{
                ...(s === 'accepted' ? button.primary : button.secondary),
                minHeight: 44, padding: '0 14px', fontSize: font.size.sm, opacity: busy ? 0.6 : 1,
              }}
            >Mark {text.toLowerCase()}</button>
          ))}
        </div>
      )}
      {error && <span role="alert" style={{ fontSize: font.size.xs, color: color.danger }}>{error}</span>}
    </section>
  );
}
