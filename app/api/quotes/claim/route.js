// Progress claims (bill by % of work done).
//
//   GET  /api/quotes/claim?quote=Q-0001&pct=70&vos=Q-0003,Q-0004  → what would be sent, and any blockers
//   GET  /api/quotes/claim?quote=Q-0001&claim=CLM-…                → the same for a retry
//   POST /api/quotes/claim { quoteId, pct, voIds } | { quoteId, claimId }, plus { pin, expected: { amount, quoteVersion } }
//
// Writes to Xero only through lib/xero.js createInvoice(), which honours XERO_DRY_RUN.

import { prepareClaim, billClaim } from '@/lib/claimBilling';

const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const quoteId = sp.get('quote');
    if (!quoteId) return Response.json({ error: 'quote is required' }, { status: 400 });
    const prep = await prepareClaim({ quoteId, pct: sp.get('pct'), voIds: list(sp.get('vos')), claimId: sp.get('claim') || '' });
    if (!prep.ok) return Response.json({ error: prep.error }, { status: prep.status });
    if (prep.alreadyBilled) return Response.json({ blockers: [`Already billed as ${prep.claim.xeroInvoiceNumber}.`] });
    return Response.json({ dryRun: prep.dryRun, blockers: prep.blockers, preview: prep.preview, invoice: prep.invoice });
  } catch (err) {
    console.error('Claim preview error:', err.message);
    return Response.json({ error: `Could not prepare the claim: ${err.message}` }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await billClaim({
      quoteId:  String(body.quoteId || ''),
      pct:      body.pct,
      voIds:    Array.isArray(body.voIds) ? body.voIds.map(String) : [],
      claimId:  String(body.claimId || ''),
      pin:      String(body.pin || ''),
      expected: body.expected || {},
    });
    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);
  } catch (err) {
    console.error('Claim error:', err.message);
    return Response.json({ error: `The claim failed: ${err.message}. Nothing was marked billed.` }, { status: 500 });
  }
}
