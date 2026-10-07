// The quote PDF.
//   GET  /api/quotes/pdf?quote=Q-0001       → download it. Built from the SAVED quote,
//                                            so unsaved edits on screen are not in it.
//   POST /api/quotes/pdf { quoteId, pin }   → attach it to the first stage invoice, if a
//                                            previous attempt failed. Once per quote.

import { buildQuotePdf } from '@/lib/quoteDocument';
import { attachQuotePdfWithPin } from '@/lib/billing';

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await attachQuotePdfWithPin({ quoteId: String(body.quoteId || ''), pin: String(body.pin || '') });
    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);
  } catch (err) {
    console.error('Attach PDF error:', err.message);
    return Response.json({ error: `Could not attach the PDF: ${err.message}` }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const quoteId = new URL(req.url).searchParams.get('quote');
    if (!quoteId) return Response.json({ error: 'quote is required' }, { status: 400 });
    const pdf = await buildQuotePdf(quoteId);
    if (!pdf) return Response.json({ error: `No quote with id ${quoteId}` }, { status: 404 });
    return new Response(pdf.bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Quote PDF error:', err.message);
    return Response.json({ error: `Could not make the PDF: ${err.message}` }, { status: 500 });
  }
}
