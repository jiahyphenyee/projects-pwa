// The quote's client-facing version (v1, v2…), printed on its PDF and in the file name.
//
//   POST /api/quotes/version { quoteId, from }  → start version from + 1. Refused if the
//                                                 quote is no longer on `from`.

import { startIssueVersion } from '@/lib/quotes';

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await startIssueVersion(String(body.quoteId || ''), body.from);
    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);
  } catch (err) {
    console.error('Quote version error:', err.message);
    return Response.json({ error: 'Could not start a new version' }, { status: 500 });
  }
}
