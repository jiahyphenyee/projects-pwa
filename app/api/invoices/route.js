// The Invoices screen: a project's Xero invoices, and the ones nobody has claimed.
//
//   GET  /api/invoices?project=PRJ-166
//     → { matched, ambiguous, unassigned, fetchedAt }
//        matched:    this project's documents (each with matchedBy and stage)
//        ambiguous:  documents whose Reference fits this project and another
//        unassigned: every other invoice that could be moved here, newest first, for the
//                    "find an invoice" search: unclaimed or ambiguous ones, and ones placed
//                    on another project by Reference alone (`currentProject` says which) —
//                    two projects at one address can be typed slightly differently, so a
//                    Reference match can land on the wrong customer's job. Invoices placed
//                    by a manual link or by this app's billing record are not offered.
//   POST /api/invoices { xeroId, xeroNumber, projectCode, by }
//     → link the invoice to the project. projectCode '' unlinks it.
//
// Only the `Xero links` tab is written. Nothing is written to Xero.

import { loadMatching } from '@/lib/invoiceMatching';
import { setXeroLink } from '@/lib/xeroLinks';
import { invoicesForProject, assignDocuments, isDraft } from '@/lib/projectFigures.mjs';

const brief = d => ({
  id: d.id, kind: d.kind, number: d.number, reference: d.reference, contact: d.contact,
  status: d.status, draft: isDraft(d), date: d.date, total: d.total, due: d.due,
  ...(d.candidates ? { candidates: d.candidates } : {}),
  ...(d.currentProject ? { currentProject: d.currentProject } : {}),
  ...(d.matchedBy ? { matchedBy: d.matchedBy, stage: d.stage, stageAuto: d.stageAuto } : {}),
});

export async function GET(req) {
  const projectCode = new URL(req.url).searchParams.get('project') || '';
  if (!projectCode) return Response.json({ error: 'project is required' }, { status: 400 });
  try {
    const { docs, projects, links, billed, xeroFetchedAt } = await loadMatching();
    const { matched, ambiguous } = invoicesForProject(docs, projects, projectCode, { links, billed });
    const ambiguousIds = new Set(ambiguous.map(d => d.id));
    const assigned = assignDocuments(docs, projects, { links, billed });
    const unassigned = docs
      .filter(d => d.kind === 'invoice' && !ambiguousIds.has(d.id))
      .map(d => ({ doc: d, ...assigned.get(d) }))
      .filter(({ codes, how }) => codes.length !== 1 || ((how === 'exact' || how === 'unit') && codes[0] !== projectCode))
      .map(({ doc, codes }) => ({ ...doc, candidates: codes, currentProject: codes.length === 1 ? codes[0] : '' }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const linkedHere = new Set(links.filter(l => l.projectCode === projectCode).map(l => l.xeroId));
    return Response.json({
      matched: matched.map(d => ({ ...brief(d), unlinkable: linkedHere.has(d.id) })),
      ambiguous: ambiguous.map(brief),
      unassigned: unassigned.map(brief),
      projects: projects.map(p => ({ code: p.code, address: p.address, clientName: p.clientName })),
      fetchedAt: xeroFetchedAt,
    });
  } catch (err) {
    console.error('Invoices read error:', err.message);
    return Response.json({ error: 'Could not load Xero invoices' }, { status: 502 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await setXeroLink({
      xeroId: String(body.xeroId || ''),
      xeroNumber: String(body.xeroNumber || ''),
      projectCode: String(body.projectCode || ''),
      by: String(body.by || ''),
    });
    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);
  } catch (err) {
    console.error('Invoice link error:', err.message);
    return Response.json({ error: 'Could not save the link' }, { status: 500 });
  }
}
