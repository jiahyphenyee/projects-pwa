// Reads every project. The list is small (tens of rows), so it ships whole and the
// client searches and pages it locally — no per-keystroke round trips.

import { getTab, readTab } from '@/lib/sheets';

// Projects tab column order
const COL = {
  code:        0,  // A project_code
  address:     1,  // B display_address
  clientId:    2,  // C client_id  — FORMULA, derived from client_name. Never write directly.
  clientName:  3,  // D client_name
  projectName: 4,  // E project_name
  startDate:   5,  // F start_date
  endDate:     6,  // G end_date
  status:      7,  // H status
  closedDate:  8,  // I closed_date
};

// Matches real project rows only — the tab has an "ℹ" note row at row 2
const PROJECT_ID = /^(PRJ-|GEN-)/;

export async function GET() {
  try {
    const tab  = await getTab('PROJECTS');
    const rows = await readTab(tab, 'A:K', PROJECT_ID);

    // Sheet order is creation order (rows are appended), so the tail is newest.
    const projects = rows.map(({ row, rowNumber }) => ({
      code:        row[COL.code]        || '',
      address:     row[COL.address]     || '',
      clientId:    row[COL.clientId]    || '',
      clientName:  row[COL.clientName]  || '',
      projectName: row[COL.projectName] || '',
      startDate:   row[COL.startDate]   || '',
      endDate:     row[COL.endDate]     || '',
      status:      row[COL.status]      || '',
      closedDate:  row[COL.closedDate]  || '',
      rowNumber,
    }));

    return Response.json({ projects, fetchedAt: Date.now() });

  } catch (err) {
    console.error('Projects read error:', err.message);
    return Response.json({ error: 'Could not load projects' }, { status: 500 });
  }
}
