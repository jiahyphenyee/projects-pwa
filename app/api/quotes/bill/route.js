// Billing a payment stage.
//
//   GET  /api/quotes/bill?quote=Q-0001&stage=ST-0002  → what would be sent, and any blockers
//   POST /api/quotes/bill { quoteId, stageId, pin, expected: { amount, quoteVersion } }
//
// The POST is the only route in the app that writes to Xero, and only through
// lib/xero.js createInvoice(), which honours XERO_DRY_RUN.

import { prepareStageBill, billStage } from '@/lib/billing';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const quoteId = searchParams.get('quote');
    const stageId = searchParams.get('stage');
    if (!quoteId || !stageId) return Response.json({ error: 'quote and stage are required' }, { status: 400 });
    const prep = await prepareStageBill({ quoteId, stageId });
    if (!prep.ok) return Response.json({ error: prep.error }, { status: prep.status });
    return Response.json({ dryRun: prep.dryRun, blockers: prep.blockers, preview: prep.preview, invoice: prep.invoice });
  } catch (err) {
    console.error('Bill preview error:', err.message);
    return Response.json({ error: `Could not prepare the invoice: ${err.message}` }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await billStage({
      quoteId:  String(body.quoteId || ''),
      stageId:  String(body.stageId || ''),
      pin:      String(body.pin || ''),
      expected: body.expected || {},
    });
    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);
  } catch (err) {
    console.error('Bill error:', err.message);
    return Response.json({ error: `Billing failed: ${err.message}. The stage was not marked billed.` }, { status: 500 });
  }
}
