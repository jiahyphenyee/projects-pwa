// Quotes and variation orders: load one, list a project's, or save one.
//
//   GET  /api/quotes?id=Q-0001          → { quote, lines, project, schedule }
//   GET  /api/quotes?project=PRJ-042    → { quotes: [...] }
//   GET  /api/quotes?screen=PRJ-042     → everything the quote screen needs, in one call
//   GET  /api/quotes?screen=PRJ-042&quote=Q-0011 (or quote=new) → the same for one of the project's quotes
//   GET  /api/quotes?screen=PRJ-042&vo=Q-0007 (or vo=new&parent=Q-0011) → the same for a variation order
//   GET  /api/quotes?summary=PRJ-042    → billed and unbilled stages and VOs, for the project screen
//   POST /api/quotes  { ...saveQuote input }
//
// Nothing here talks to Xero. Billing gets its own route in Phase 5.

import { loadQuote, listQuotes, saveQuote, loadQuoteScreen, billingSummary } from '@/lib/quotes';
import { pdfSetupGaps } from '@/lib/quoteDocument';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const project = searchParams.get('project');
    const screen = searchParams.get('screen');
    const summary = searchParams.get('summary');

    if (summary) return Response.json(await billingSummary(summary));

    if (screen) {
      const [found, gaps] = await Promise.all([
        loadQuoteScreen(screen, {
          voId:     searchParams.get('vo') || undefined,
          quoteId:  searchParams.get('quote') || undefined,
          parentId: searchParams.get('parent') || undefined,
        }),
        pdfSetupGaps().catch(() => []),
      ]);
      if (found && !found.notFound) found.pdfGaps = gaps;
      if (!found) return Response.json({ error: `No project with code ${screen}` }, { status: 404 });
      if (found.notFound) return Response.json({ error: found.notFound }, { status: 404 });
      return Response.json(found);
    }
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
