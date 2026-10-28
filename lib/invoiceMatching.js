// Everything needed to decide which project each Xero sales document belongs to, read in
// one parallel wave: the documents, every project's address, the manual links and this
// app's own billing record. The decision itself is pure, in lib/projectFigures.mjs.
//
// Matching needs every project, not just the one on screen: an address shared by two
// projects is only ambiguous because both are in the list.

import { readTab } from '@/lib/sheets';
import { projectsTab, PROJECT_COL } from '@/lib/projects';
import { billedInvoiceIndex } from '@/lib/quotes';
import { listSalesDocuments } from '@/lib/projectInvoices';
import { readXeroLinks } from '@/lib/xeroLinks';

const PROJECT_ID = /^(PRJ-|GEN-)/;

export async function projectAddresses() {
  const tab = await projectsTab();
  const rows = await readTab(tab, 'A:D', PROJECT_ID);
  return rows.map(({ row }) => ({
    code: row[PROJECT_COL.code] || '',
    address: row[PROJECT_COL.address] || '',
    clientName: row[PROJECT_COL.clientName] || '',
  }));
}

/**
 * { docs, creditNotesRead, xeroFetchedAt, projects, links, billed }.
 * The billing record failing to read is not fatal: matching falls back to links and
 * Reference, exactly as before this record was used, and says so in the server log.
 */
export async function loadMatching() {
  const [sales, projects, links, billed] = await Promise.all([
    listSalesDocuments(),
    projectAddresses(),
    readXeroLinks(),
    billedInvoiceIndex().catch(err => {
      console.error('Billed invoice index unreadable, matching by Reference only:', err.message);
      return [];
    }),
  ]);
  return {
    docs: sales.docs, creditNotesRead: sales.creditNotesRead, xeroFetchedAt: sales.fetchedAt,
    projects, links, billed,
  };
}
