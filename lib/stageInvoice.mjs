// The Xero invoice for one payment stage, as a plain object. Pure, so exactly what is sent
// to Xero is unit-tested and can be shown on the confirm step before anything is sent.
//
// One line per stage invoice (the quote lines are not repeated): the stage name, its share
// and the contract sum in the description, quantity 1, unit amount = the stage amount.

const money = n => '$' + Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => `${Number(Number(n).toFixed(2))}%`;

/** "Progress payment 1, 20% of contract sum $5,070.00" */
export function stageLineDescription({ name, sharePct, isFinal, contractSum }) {
  if (isFinal) return `${name}, balance of contract sum ${money(contractSum)}`;
  return `${name}, ${pct(sharePct)} of contract sum ${money(contractSum)}`;
}

/**
 * The Invoices payload for Xero's POST /Invoices.
 *   contactId      the client's Xero ContactID — never a name (a name miss creates a contact)
 *   reference      the project's display_address only
 *   trackingOption blank = no Service tracking (William: stage invoices go untagged)
 */
export function buildStageInvoice({
  contactId, invoiceNumber, date, dueDate, reference, accountCode, trackingOption,
  stage, contractSum,
}) {
  if (!contactId) throw new Error('A Xero ContactID is required');
  if (!(stage.amount > 0)) throw new Error('A stage invoice must be for more than $0.00');
  const line = {
    Description: stageLineDescription({ ...stage, contractSum }),
    Quantity:    1,
    UnitAmount:  stage.amount,
    AccountCode: accountCode,
  };
  if (trackingOption) line.Tracking = [{ Name: 'Service', Option: trackingOption }];
  return {
    Type:            'ACCREC',
    Status:          'AUTHORISED',
    Contact:         { ContactID: contactId },
    Date:            date,
    DueDate:         dueDate,
    InvoiceNumber:   invoiceNumber,
    Reference:       reference,
    LineAmountTypes: 'NoTax',
    LineItems:       [line],
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
