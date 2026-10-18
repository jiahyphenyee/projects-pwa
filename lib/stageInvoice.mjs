// The Xero invoice for one payment stage, as a plain object. Pure, so exactly what is sent
// to Xero is unit-tested and can be shown on the confirm step before anything is sent.
//
// One line per stage invoice (the quote lines are not repeated): the stage name, its share
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
 *   stage          { name, sharePct, isFinal, amount, balance?, settling? } from describeSchedule.
 *                  On the final stage `amount` is the total due and `balance` the %-based
 *                  part; `settling` are the VOs going onto this invoice.
 */
export function buildStageInvoice({
  contactId, invoiceNumber, date, dueDate, reference, accountCode, trackingOption,
  stage, contractSum,
}) {
  if (!contactId) throw new Error('A Xero ContactID is required');
  if (!(stage.amount > 0)) throw new Error('A stage invoice must be for more than $0.00');
  const settling = stage.isFinal ? (stage.settling || []) : [];
  const balance = stage.isFinal && settling.length ? stage.balance : stage.amount;
  const line = {
    Description: stageLineDescription({ ...stage, contractSum }),
    Quantity:    1,
    UnitAmount:  balance,
    AccountCode: accountCode,
  };
  if (trackingOption) line.Tracking = [{ Name: 'Service', Option: trackingOption }];

  // Summary lines like the stage's own: quantity 1, the VO's signed total, no tracking
  const items = [line, ...settling.map(vo => ({
    Description: voSettlementDescription(vo),
    Quantity:    1,
    UnitAmount:  Number(vo.contractSum),
    AccountCode: accountCode,
  }))];
  const total = items.reduce((acc, l) => acc + cents(l.UnitAmount), 0);
  if (total !== cents(stage.amount)) {
    throw new Error(`The invoice lines add up to ${money(total / 100)} but the stage is ${money(stage.amount)}. Nothing was sent.`);
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
