// The client's answer to a quote or VO.
//   POST /api/quotes/client { quoteId, status: 'sent'|'accepted'|'declined'|'', date? }
//     → { ok, quote } — writes Quotes AA:AC only. Nothing is written to Xero.

import { setClientStatus } from '@/lib/quotes';

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await setClientStatus({
      quoteId: String(body.quoteId || ''),
      status: String(body.status ?? ''),
      date: body.date ? String(body.date) : '',
    });
    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);
  } catch (err) {
    console.error('Client status error:', err.message);
    return Response.json({ error: 'Could not save the client status' }, { status: 500 });
  }
}
