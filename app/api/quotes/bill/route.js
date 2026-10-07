// Billing a payment stage.
//
//   GET  /api/quotes/bill?quote=Q-0001&stage=ST-0002  → what would be sent, and any blockers
//   GET  /api/quotes/bill?quote=Q-0007                → the same for a variation order
//   POST /api/quotes/bill { quoteId, stageId?, pin, expected: { amount, quoteVersion } }
//        (no stageId = bill the variation order quoteId in full)
//
// The POST is the only route in the app that writes to Xero, and only through
// lib/xero.js createInvoice(), which honours XERO_DRY_RUN.

import { prepareStageBill, billStage, prepareVoBill, billVo } from '@/lib/billing';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const quoteId = searchParams.get('quote');
    const stageId = searchParams.get('stage');
    if (!quoteId) return Response.json({ error: 'quote is required' }, { status: 400 });
    const prep = stageId ? await prepareStageBill({ quoteId, stageId }) : await prepareVoBill({ quoteId });
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
    const args = {
      quoteId:  String(body.quoteId || ''),
      stageId:  String(body.stageId || ''),
      pin:      String(body.pin || ''),
      expected: body.expected || {},
    };
    const result = args.stageId ? await billStage(args) : await billVo(args);
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
