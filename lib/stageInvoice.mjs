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
  stage, stages, contractSum,
}) {
  const list = stages || (stage ? [stage] : []);
  if (!contactId) throw new Error('A Xero ContactID is required');
  if (!list.length) throw new Error('At least one stage is required');
  for (const st of list) {
    if (!(st.amount > 0)) throw new Error(`A stage invoice must be for more than $0.00 (${st.name || 'stage'})`);
  }

  const items = list.flatMap(st => {
    const settling = st.isFinal ? (st.settling || []) : [];
    const line = {
      Description: stageLineDescription({ ...st, contractSum }),
      Quantity:    1,
      UnitAmount:  st.isFinal && settling.length ? st.balance : st.amount,
      AccountCode: accountCode,
    };
    if (trackingOption) line.Tracking = [{ Name: 'Service', Option: trackingOption }];
    // Summary lines like the stage's own: quantity 1, the VO's signed total, no tracking
    return [line, ...settling.map(vo => ({
      Description: voSettlementDescription(vo),
      Quantity:    1,
      UnitAmount:  Number(vo.contractSum),
      AccountCode: accountCode,
    }))];
  });
  const total = items.reduce((acc, l) => acc + cents(l.UnitAmount), 0);
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

/** True when an invoice already in Xero is the one this stage would have created. */
export function matchesStageInvoice(found, { contactId, amount, reference }) {
  if (!found) return false;
  const total = Math.round(Number(found.Total ?? found.total ?? 0) * 100);
  return found.Contact?.ContactID === contactId
    && total === Math.round(Number(amount) * 100)
    && String(found.Reference || '') === String(reference || '')
    && !['VOIDED', 'DELETED'].includes(found.Status);
}
