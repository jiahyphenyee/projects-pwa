// How a cost was billed, stored as invoiced + invoice_ref (no new columns):
//   invoiced FALSE                 not billed yet
//   invoiced TRUE, invoice_ref ''  billed in the project's invoices (the tick)
//   invoiced TRUE, invoice_ref X   billed direct to the client on Xero invoice X
// Pure, so the rule is tested.

/**
 * What to write to invoice_ref for a change: the given ref when ticked with one (billed
 * direct), '' when unticked, undefined (leave it as it is) for a plain tick.
 */
export function refToWrite(invoiced, invoiceRef) {
  if (!invoiced) return '';
  return invoiceRef === undefined ? undefined : String(invoiceRef || '').trim();
}

/** 'none' | 'project' | 'direct' */
export function billingMode(line) {
  if (!line?.invoiced) return 'none';
  return line.invoiceRef ? 'direct' : 'project';
}
