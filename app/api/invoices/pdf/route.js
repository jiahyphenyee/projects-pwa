// A Xero sales invoice as a PDF, drafts included.
//   GET /api/invoices/pdf?id=<Xero InvoiceID>   → download it.
// A read from Xero: nothing is written, so dry run does not apply. Only invoices in the
// organisation's sales list are served.

import { invoicePdf } from '@/lib/projectInvoices';

const XERO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!XERO_ID.test(id)) return Response.json({ error: 'A valid invoice id is required' }, { status: 400 });
  try {
    const pdf = await invoicePdf(id);
    if (!pdf) return Response.json({ error: 'No such sales invoice in Xero' }, { status: 404 });
    return new Response(pdf.bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Invoice PDF error:', err.message);
    return Response.json({ error: `Could not get the PDF from Xero: ${err.message}` }, { status: 502 });
  }
}
