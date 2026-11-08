// What a billed stage, variation order or progress claim is worth NOW, from the invoice as
// it stands in Xero, rather than the figure stored when it was billed.
//
// William edits an unpaid invoice in Xero after talking to the client (a $50 goodwill cut,
// an agreed extra). The Sheet still holds the amount the app sent, so the final payment
// and the Summary come out wrong. This module overlays the Sheet rows with the invoice's
// current total before any figure is computed from them. Pure: the server wrapper in
// lib/quotes.js reads Xero and passes the invoices in. The overlaid rows are for reading
// only and are never written back to the Sheet.
//
// What the Sheet stores per invoice (lib/billing.js recordBilled, lib/claimBilling.js):
//   - a stage: billed_amount = the stage's amount. A final's amount already INCLUDES the
//     VOs it settled, and each of those VOs also stores billed_amount = its own sum.
//   - a claim: main_amount = the main quote's part; its VOs store their own sums; the
//     invoice total = main_amount + the VOs.
//
// Rules, per Xero invoice id:
//   - the rows add up to the invoice total → nothing changes
//   - one stage alone, or a final / a claim with its VOs, total differs → the stage, final
//     or claim's main part takes the difference (the VOs are the client's accepted prices
//     and stay); the Sheet figure is kept as `sheetAmount` so the screen can say so
//   - several stages on one invoice ("billed together"), total differs → nothing is
//     guessed: every row is flagged `liveMismatch` with both totals; the Sheet figures stand
//   - no such live invoice (voided or deleted in Xero) → the rows become UNBILLED again:
//     invoice id and number cleared, `voided` = { invoiceId, invoiceNumber, amount } of the
//     old invoice (lib/billing.js claimStages needs them to re-bill the row), so the stage
//     can be billed afresh and the final takes the whole balance. The caller must confirm the
//     invoice is really absent (not just missing from a cached list) before passing it here.
// Rows with an attempt still in flight, or no invoice id, are left alone.

import { sumAmounts } from './quoteMaths.mjs';
import { attemptInFlight } from './clientAcceptance.mjs';

const cents = n => Math.round(Number(n || 0) * 100);

/** Which field holds a row's billed figure. Claims carry the main quote's part in mainAmount. */
const amountField = kind => (kind === 'claim' ? 'mainAmount' : 'billedAmount');

const billedRow = r => r && r.xeroInvoiceId && !attemptInFlight(r);

/**
 * `data`: { stages, vos, claims } — any may be omitted. `invoicesById`: Map of Xero
 * InvoiceID → { total, number, status } for every live sales invoice (drafts included,
 * voided and deleted absent). Returns new arrays; the inputs are not changed.
 */
export function overlayLiveBilled({ stages = [], vos = [], claims = [] }, invoicesById) {
  const groups = new Map();   // invoice id → [{ kind, index }]
  const add = (kind, list) => list.forEach((r, index) => {
    if (!billedRow(r)) return;
    if (!groups.has(r.xeroInvoiceId)) groups.set(r.xeroInvoiceId, []);
    groups.get(r.xeroInvoiceId).push({ kind, index });
  });
  add('stage', stages); add('vo', vos); add('claim', claims);

  const out = { stages: stages.map(r => ({ ...r })), vos: vos.map(r => ({ ...r })), claims: claims.map(r => ({ ...r })) };
  const listOf = kind => (kind === 'stage' ? out.stages : kind === 'vo' ? out.vos : out.claims);

  for (const [invoiceId, members] of groups) {
    const rows = members.map(m => ({ kind: m.kind, row: listOf(m.kind)[m.index], field: amountField(m.kind) }));
    const doc = invoicesById.get(invoiceId);
    if (!doc) {
      for (const { row, field } of rows) {
        row.voided = { invoiceId: row.xeroInvoiceId, invoiceNumber: row.xeroInvoiceNumber || '', amount: row[field] };
        row.sheetAmount = row[field];
        row[field] = null;
        row.xeroInvoiceId = '';
        row.xeroInvoiceNumber = '';
      }
      continue;
    }

    // The one row that absorbs a change, if the group has one: a stage on its own, a final
    // (its figure already covers the VOs with it), or a claim (its main part + the VOs)
    const stagesHere = rows.filter(r => r.kind === 'stage');
    const claimsHere = rows.filter(r => r.kind === 'claim');
    const voRows     = rows.filter(r => r.kind === 'vo');
    const hasFinal   = stagesHere.some(r => r.row.isFinal);
    const primary    = stagesHere.length === 1 && !claimsHere.length ? stagesHere[0]
      : claimsHere.length === 1 && !stagesHere.length ? claimsHere[0]
      : null;
    const voSum = sumAmounts(voRows.map(({ row }) => row.billedAmount ?? 0));
    // A final's stored figure already covers the VOs with it (billed alone or together)
    const sheetTotal = hasFinal ? sumAmounts(stagesHere.map(({ row }) => row.billedAmount ?? 0))
      : sumAmounts(rows.map(({ row, field }) => row[field] ?? 0));
    if (cents(sheetTotal) === cents(doc.total)) continue;

    if (primary) {
      const { row, field, kind } = primary;
      row.sheetAmount = row[field];
      row[field] = kind === 'claim' ? sumAmounts([Number(doc.total), -voSum]) : Number(doc.total);
      continue;
    }
    for (const { row } of rows) {
      row.liveMismatch = { invoiceNumber: doc.number || row.xeroInvoiceNumber || '', xeroTotal: Number(doc.total), sheetTotal };
    }
  }
  return out;
}

/** Whether any row's invoice is absent from the map: the caller then re-reads Xero before trusting it. */
export function anyMissing({ stages = [], vos = [], claims = [] }, invoicesById) {
  return [...stages, ...vos, ...claims].some(r => billedRow(r) && !invoicesById.has(r.xeroInvoiceId));
}

/** The invoice map overlayLiveBilled wants, from lib/projectInvoices.js listSalesDocuments() docs. */
export function invoiceMap(docs) {
  return new Map(docs.filter(d => d.kind === 'invoice').map(d => [d.id, { total: d.total, number: d.number, status: d.status }]));
}
