// Quotes and variation orders: load one, list a project's, or save one.
//
//   GET  /api/quotes?id=Q-0001          → { quote, lines, project, schedule }
//   GET  /api/quotes?project=PRJ-042    → { quotes: [...] }
//   POST /api/quotes  { ...saveQuote input }
//
// Nothing here talks to Xero. Billing gets its own route in Phase 5.

import { loadQuote, listQuotes, saveQuote } from '@/lib/quotes';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const project = searchParams.get('project');

    if (id) {
      const found = await loadQuote(id);
      if (!found) return Response.json({ error: `No quote with id ${id}` }, { status: 404 });
      return Response.json(found);
    }
    if (project) {
      return Response.json({ quotes: await listQuotes(project) });
    }
    return Response.json({ error: 'id or project is required' }, { status: 400 });

  } catch (err) {
    console.error('Quote read error:', err.message);
    return Response.json({ error: 'Could not load the quote' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await saveQuote(body);
    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);

  } catch (err) {
    console.error('Quote save error:', err.message);
    return Response.json({ error: 'Could not save the quote' }, { status: 500 });
  }
}
