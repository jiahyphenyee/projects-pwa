// The project screen's figures beyond its costs: quoted value (total and by service),
// the Xero invoices matched to the project, and the thresholds behind the status flag.
//
//   GET /api/dashboard?project=PRJ-090
//     → { quote, invoices, settings, fetchedAt }
//
// Costs are deliberately not here: they stay on /api/costs, so Xero being slow or down
// can never stop a project's costs from loading. For the same reason each part settles
// on its own — a failed part comes back as `{ error }` and the others still render.
//
// The arithmetic (profit, margin, flags, ageing) runs on the client from these inputs
// and the cached costs, through lib/projectFigures.mjs, so a cached copy still ages
// correctly offline.

import { readTab, getConfig } from '@/lib/sheets';
import { projectsTab, PROJECT_COL } from '@/lib/projects';
import { projectQuoteFigures } from '@/lib/quotes';
import { listSalesDocuments } from '@/lib/projectInvoices';
import { DASHBOARD_SETTINGS, readSettings, invoicesForProject } from '@/lib/projectFigures.mjs';

const PROJECT_ID = /^(PRJ-|GEN-)/;

async function projectAddresses() {
  const tab = await projectsTab();
  const rows = await readTab(tab, 'A:B', PROJECT_ID);
  return rows.map(({ row }) => ({ code: row[PROJECT_COL.code] || '', address: row[PROJECT_COL.address] || '' }));
}

async function projectInvoices(projectCode) {
  const [{ docs, creditNotesRead, fetchedAt }, projects] = await Promise.all([listSalesDocuments(), projectAddresses()]);
  const { matched, ambiguous } = invoicesForProject(docs, projects, projectCode);
  return { docs: matched, ambiguous, creditNotesRead, xeroFetchedAt: fetchedAt };
}

async function settings() {
  const entries = await Promise.all(
    Object.values(DASHBOARD_SETTINGS).map(async ({ key }) => [key, await getConfig(key)])
  );
  return readSettings(Object.fromEntries(entries));
}

const settled = (result, label) => {
  if (result.status === 'fulfilled') return result.value;
  console.error(`Dashboard ${label} error:`, result.reason?.message);
  return { error: `Could not load ${label}` };
};

export async function GET(req) {
  const projectCode = new URL(req.url).searchParams.get('project') || '';
  if (!projectCode) return Response.json({ error: 'project is required' }, { status: 400 });

  const [quote, invoices, config] = await Promise.allSettled([
    projectQuoteFigures(projectCode),
    projectInvoices(projectCode),
    settings(),
  ]);

  return Response.json({
    quote:    settled(quote, 'the quote'),
    invoices: settled(invoices, 'Xero invoices'),
    // Settings never fail the screen: the defaults are the spec's own numbers
    settings: config.status === 'fulfilled' ? config.value : readSettings(),
    fetchedAt: Date.now(),
  });
}
