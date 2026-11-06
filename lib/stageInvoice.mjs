// The Xero invoice for one payment stage, as a plain object. Pure, so exactly what is sent
// to Xero is unit-tested and can be shown on the confirm step before anything is sent.
//
// One line per stage (the quote lines are not repeated); stages billed together get one each: the stage name, its share
// and the contract sum in the description, quantity 1, unit amount = the stage amount.
//
// The final payment is the exception: after its balance line it carries one signed line per
// variation order still to settle — "Add: VO1 – …" or "Less: VO2 – …" — so additions and
// omissions are settled on the one invoice. Xero accepts a negative line; only a negative
// total is refused, and that is blocked before anything is built.
//
// When the caller passes `itemise` (lib/billing.js does, for a final payment billed on its
// own once every other stage is billed or $0), the balance line is replaced by the quote's own
// lines, so the client sees what they are paying for:
//   - one line per item (qty × unit price, its Service option; the unit when the quote shows units)
//   - title rows as description-only lines
//   - "Less: discount" if the quote has one
//   - "Less: <stage> (INV-…)" for every stage already billed
// then the VO lines as before. The lines must still add up to the amount due, or nothing is built.

import { lineAmount, quoteTotals, sumAmounts } from './quoteMaths.mjs';

const money = n => '$' + Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => `${Number(Number(n).toFixed(2))}%`;

/** "Progress payment 1, 20% of contract sum $5,070.00" */
export function stageLineDescription({ name, sharePct, isFinal, contractSum }) {
  if (isFinal) return `${name}, balance of contract sum ${money(contractSum)}`;
  return `${name}, ${pct(sharePct)} of contract sum ${money(contractSum)}`;
}

/** "Add: VO1 – Extra socket points" / "Less: VO2 – Omit feature wall". No title → the number alone. */
export function voSettlementDescription({ voNumber, title, contractSum }) {
  const label = `VO${voNumber}${title ? ` – ${title}` : ''}`;
  return `${Number(contractSum) < 0 ? 'Less' : 'Add'}: ${label}`;
}

const cents = n => Math.round(Number(n) * 100);

/** "Gypsum board partition" + sqft → "Gypsum board partition (per sqft)"; no unit → as is. */
const withUnit = (description, unit) => (unit ? `${description} (per ${unit})` : description);

/**
 * The quote's lines as invoice lines, less the discount and the stages already billed.
 *   lines      the quote's live lines { kind, description, qty, unit, unitPrice, service }
 *   showUnit   the quote's "Show unit": units go on the invoice only if the client saw them
 *   trackingFor(code) → the Xero Service option for a Categories code, '' for none
 *   earlier    stages billed before: { name, amount, invoiceNumber }
 */
export function quoteLineItems({ lines, discountMode, discountValue, showUnit, trackingFor = () => '', earlier = [], accountCode }) {
  const items = [];
  for (const l of lines) {
    if (l.kind === 'title') {
      if (l.description) items.push({ Description: String(l.description).toUpperCase() });
      continue;
    }
    const line = {
      Description: showUnit ? withUnit(l.description, l.unit) : l.description,
      Quantity:    l.qty ?? 1,
      UnitAmount:  l.unitPrice ?? 0,
      AccountCode: accountCode,
    };
    const option = trackingFor(l.service);
    if (option) line.Tracking = [{ Name: 'Service', Option: option }];
    items.push(line);
  }
  const totals = quoteTotals(
    lines.map(l => ({ kind: l.kind, qty: l.qty ?? 1, unitPrice: l.unitPrice ?? 0 })),
    discountMode, discountValue,
  );
  if (totals.discount > 0) items.push({ Description: 'Less: discount', Quantity: 1, UnitAmount: -totals.discount, AccountCode: accountCode });
  for (const st of earlier) {
    items.push({
      Description: `Less: ${st.name}${st.invoiceNumber ? ` (${st.invoiceNumber})` : ''}`,
      Quantity:    1,
      UnitAmount:  -Number(st.amount),
      AccountCode: accountCode,
    });
  }
  return { items, contractSum: totals.contractSum };
}

/**
 * Whether the final payment invoice lists the quote's lines (lib/stageInvoice.mjs `itemise`),
 * and with what. Only when the final is billed on its own and every other stage is billed or
 * $0 — then the quote's lines less the billed stages are exactly the balance. Otherwise null:
 * the one-line invoice as before.
 * `{ problem }` when it should itemise but cannot safely: the saved lines do not add up to the
 * saved contract sum, or a line has no description (Xero refuses it). The caller blocks the
 * bill with that message rather than quietly sending one line.
 */
export function finalItemisation({ quote, stages, schedule, lines, categories }) {
  if (stages.length !== 1 || !stages[0].isFinal) return null;
  const others = schedule.stages.filter(s => !s.isFinal);
  if (others.some(s => !s.xeroInvoiceId && s.amount > 0)) return null;
  if (!lines.some(l => l.kind === 'item')) return null;
  // Xero refuses a line with no description
  const blank = lines.findIndex(l => l.kind === 'item' && !String(l.description || '').trim());
  if (blank >= 0) {
    const n = lines.slice(0, blank + 1).filter(l => l.kind === 'item').length;
    return { problem: `Quote line ${n} has no description, and Xero needs one on every line. Fill it in and save the quote, then bill.` };
  }
  const items = lines.filter(l => l.kind === 'item').map(l => ({ kind: 'item', qty: l.qty ?? 1, unitPrice: l.unitPrice ?? 0 }));
  const fromLines = quoteTotals(items, quote.discountMode, quote.discountValue).contractSum;
  if (Math.round(fromLines * 100) !== Math.round(quote.contractSum * 100)) {
    return { problem: `The quote lines add up to ${money(fromLines)} but the saved contract sum is ${money(quote.contractSum)}. Open the quote, check the lines and save it again, then bill.` };
  }
  const optionByCode = new Map(categories.map(c => [c.code, c.xeroOption]));
  return {
    lines, showUnit: !!quote.showUnit,
    discountMode: quote.discountMode, discountValue: quote.discountValue,
    trackingFor: code => optionByCode.get(code) || '',
    earlier: others.filter(s => s.xeroInvoiceId && s.amount > 0)
      .map(s => ({ name: s.name, amount: s.amount, invoiceNumber: s.xeroInvoiceNumber || '' })),
  };
}

/** What Xero totals: each line's qty × unit price, rounded per line; description-only lines are 0. */
const linesTotal = items => sumAmounts(items.map(l => (l.Quantity === undefined ? 0 : lineAmount(l.Quantity, l.UnitAmount))));

/**
 * The Invoices payload for Xero's POST /Invoices.
 *   contactId      the client's Xero ContactID — never a name (a name miss creates a contact)
 *   reference      the project's display_address only
 *   trackingOption blank = no Service tracking (William: stage invoices go untagged)
 *   stages         one or more { name, sharePct, isFinal, amount, balance?, settling? } from
 *                  describeSchedule, in schedule order: several when billed together, one
 *                  line each. On the final stage `amount` is the total due and `balance` the
 *                  %-based part; `settling` are the VOs going onto this invoice.
 *   stage          the same, for one stage (kept for callers billing one)
 */
export function buildStageInvoice({
  contactId, invoiceNumber, date, dueDate, reference, accountCode, trackingOption,
  stage, stages, contractSum, itemise = null,
}) {
  const list = stages || (stage ? [stage] : []);
  if (!contactId) throw new Error('A Xero ContactID is required');
  if (!list.length) throw new Error('At least one stage is required');
  for (const st of list) {
    if (!(st.amount > 0)) throw new Error(`A stage invoice must be for more than $0.00 (${st.name || 'stage'})`);
  }

  const items = list.flatMap(st => {
    const settling = st.isFinal ? (st.settling || []) : [];
    const vosLines = settling.map(vo => ({
      Description: voSettlementDescription(vo),
      Quantity:    1,
      UnitAmount:  Number(vo.contractSum),
      AccountCode: accountCode,
    }));
    // A final payment billed alone, with the quote's lines in place of the balance line
    if (st.isFinal && itemise && list.length === 1) {
      return [...quoteLineItems({ ...itemise, accountCode }).items, ...vosLines];
    }
    const line = {
      Description: stageLineDescription({ ...st, contractSum }),
      Quantity:    1,
      UnitAmount:  st.isFinal && settling.length ? st.balance : st.amount,
      AccountCode: accountCode,
    };
    if (trackingOption) line.Tracking = [{ Name: 'Service', Option: trackingOption }];
    // Summary lines like the stage's own: quantity 1, the VO's signed total, no tracking
    return [line, ...vosLines];
  });
  const total = cents(linesTotal(items));
  const due = list.reduce((acc, st) => acc + cents(st.amount), 0);
  if (total !== due) {
    throw new Error(`The invoice lines add up to ${money(total / 100)} but the ${list.length > 1 ? 'stages come' : 'stage is'} to ${money(due / 100)}. Nothing was sent.`.replace('stage is to', 'stage is'));
  }

  return {
    Type:            'ACCREC',
    Status:          'AUTHORISED',
    Contact:         { ContactID: contactId },
    Date:            date,
    DueDate:         dueDate,
    InvoiceNumber:   invoiceNumber,
    Reference:       reference,
    LineAmountTypes: 'NoTax',
    LineItems:       items,
  };
}

/**
 * True when an invoice already in Xero is the one this attempt would have created: same
 * contact, total and reference, not voided, and, when `lines` are given, the same line
 * descriptions in order. Stage lines name the stage, its share and the contract sum, so
 * another stage's invoice with an equal total is not mistaken for this one. Amounts are
 * checked by the total only: Xero rounds unit prices, so per-line sums can differ by a cent.
 */
export function matchesStageInvoice(found, { contactId, amount, reference, lines }) {
  if (!found) return false;
  const total = Math.round(Number(found.Total ?? found.total ?? 0) * 100);
  const basic = found.Contact?.ContactID === contactId
    && total === Math.round(Number(amount) * 100)
    && String(found.Reference || '') === String(reference || '')
    && !['VOIDED', 'DELETED'].includes(found.Status);
  if (!basic || !lines) return basic;
  const squash = t => String(t || '').replace(/\s+/g, ' ').trim();
  const theirs = found.LineItems || [];
  return theirs.length === lines.length && lines.every((l, i) => squash(theirs[i].Description) === squash(l.Description));
}
