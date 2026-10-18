// The Xero invoice for a variation order: every line of the VO, billed in full. Pure, so
// what is sent is unit-tested and shown on the confirm step first.
//
//   - a description-only first line "Variation order VO1" (Reference stays the address)
//   - one line per item row: unit appended to the description, the row's Service option
//   - title rows as description-only lines
//   - any discount as a final negative line "Less: discount"
// and a check that the lines add up to the VO's contract sum before anything is sent.

import { lineAmount, quoteTotals, sumAmounts } from './quoteMaths.mjs';

/** "Gypsum board partition wall" + sqft → "Gypsum board partition wall (per sqft)" */
export function describeWithUnit(description, unit) {
  return unit ? `${description} (per ${unit})` : description;
}

const descriptionOnly = Description => ({ Description });

/**
 * `trackingFor(code)` → the Xero Service option for a Categories code, or '' for none.
 * Returns { invoice, total, contractSum } or throws if the lines would not add up.
 */
export function buildVoInvoice({
  contactId, invoiceNumber, date, dueDate, reference, accountCode, voNumber,
  lines, discountMode, discountValue, trackingFor = () => '',
}) {
  if (!contactId) throw new Error('A Xero ContactID is required');
  const totals = quoteTotals(
    lines.map(l => ({ kind: l.kind, qty: l.qty ?? 1, unitPrice: l.unitPrice ?? 0 })),
    discountMode, discountValue,
  );
  // Lines may be negative (an omission), but an invoice on its own must come to more than $0.
  // A VO that nets to zero or less settles on the final payment invoice instead.
  if (!(totals.contractSum > 0)) throw new Error('A variation order billed on its own must be for more than $0.00. An omission settles on the final invoice.');

  const items = [descriptionOnly(`Variation order VO${voNumber}`)];
  const amounts = [];
  for (const l of lines) {
    if (l.kind === 'title') {
      if (l.description) items.push(descriptionOnly(String(l.description).toUpperCase()));
      continue;
    }
    const qty = l.qty ?? 1;
    const price = l.unitPrice ?? 0;
    const line = {
      Description: describeWithUnit(l.description, l.unit),
      Quantity:    qty,
      UnitAmount:  price,
      AccountCode: accountCode,
    };
    const option = trackingFor(l.service);
    if (option) line.Tracking = [{ Name: 'Service', Option: option }];
    items.push(line);
    amounts.push(lineAmount(qty, price));
  }
  if (totals.discount > 0) {
    items.push({ Description: 'Less: discount', Quantity: 1, UnitAmount: -totals.discount, AccountCode: accountCode });
    amounts.push(-totals.discount);
  }

  // What Xero will total, line by line, against the VO's own contract sum
  const total = sumAmounts(amounts);
  if (Math.round(total * 100) !== Math.round(totals.contractSum * 100)) {
    throw new Error(`The invoice lines add up to $${total.toFixed(2)} but the variation order is $${totals.contractSum.toFixed(2)}. Nothing was sent.`);
  }

  return {
    total,
    contractSum: totals.contractSum,
    invoice: {
      Type:            'ACCREC',
      Status:          'AUTHORISED',
      Contact:         { ContactID: contactId },
      Date:            date,
      DueDate:         dueDate,
      InvoiceNumber:   invoiceNumber,
      Reference:       reference,
      LineAmountTypes: 'NoTax',
      LineItems:       items,
    },
  };
}
