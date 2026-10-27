// Quotes made in Xero, for a project's Quotes page. Read-only.
//   GET /api/quotes/xero?project=PRJ-166      → { quotes, ambiguous, noPermission, fetchedAt }
//   GET /api/quotes/xero?pdf=<Xero QuoteID>   → the quote as a PDF

import { listXeroQuotes, xeroQuotePdf } from '@/lib/xeroQuotes';
import { projectAddresses } from '@/lib/invoiceMatching';
import { invoicesForProject } from '@/lib/projectFigures.mjs';

const XERO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const pdfId = params.get('pdf');
  try {
    if (pdfId !== null) {
      if (!XERO_ID.test(pdfId)) return Response.json({ error: 'A valid quote id is required' }, { status: 400 });
      const pdf = await xeroQuotePdf(pdfId);
      if (!pdf) return Response.json({ error: 'No such quote in Xero' }, { status: 404 });
      return new Response(pdf.bytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const projectCode = params.get('project') || '';
    if (!projectCode) return Response.json({ error: 'project is required' }, { status: 400 });
    const [{ quotes, noPermission, fetchedAt }, projects] = await Promise.all([listXeroQuotes(), projectAddresses()]);
    // Quotes are matched by Reference only: no billing record or manual link points at them.
    const { matched, ambiguous } = invoicesForProject(quotes, projects, projectCode);
    const strip = ({ stage, stageAuto, ...q }) => q;
    return Response.json({ quotes: matched.map(strip), ambiguous: ambiguous.map(strip), noPermission, fetchedAt });
  } catch (err) {
    console.error('Xero quotes error:', err.message);
    return Response.json({ error: `Could not read quotes from Xero: ${err.message}` }, { status: 502 });
  }
}
