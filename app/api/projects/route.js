// Reads every project. The list is small (tens of rows), so it ships whole and the
// client searches and pages it locally — no per-keystroke round trips.

import { readTab } from '@/lib/sheets';
import { createProject, updateProjectLockCode, projectsTab, PROJECT_COL } from '@/lib/projects';

// Column map and header check both live in lib/projects.js — one definition, so the
// route and the writer can never disagree about where a field is.
const COL = PROJECT_COL;

// Matches real project rows only — the tab has an "ℹ" note row at row 2
const PROJECT_ID = /^(PRJ-|GEN-)/;

export async function GET() {
  try {
    const tab  = await projectsTab();
    const rows = await readTab(tab, 'A:M', PROJECT_ID);

    // Sheet order is creation order (rows are appended), so the tail is newest.
    const projects = rows.map(({ row, rowNumber }) => ({
      code:        row[COL.code]        || '',
      address:     row[COL.address]     || '',
      clientId:    row[COL.clientId]    || '',
      clientName:  row[COL.clientName]  || '',
      startDate:   row[COL.startDate]   || '',
      endDate:     row[COL.endDate]     || '',
      status:      row[COL.status]      || '',
      closedDate:  row[COL.closedDate]  || '',
      lockCode:    row[COL.lockCode]    || '',
      propertyType: row[COL.propertyType] || '',
      rowNumber,
    }));

    return Response.json({ projects, fetchedAt: Date.now() });

  } catch (err) {
    console.error('Projects read error:', err.message);
    return Response.json({ error: 'Could not load projects' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body   = await req.json();
    const result = await createProject({
      displayAddress: body.displayAddress,
      clientName:     body.clientName,
      startDate:      body.startDate,
      lockCode:       body.lockCode,
      force:          body.force === true,
    });

    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);

  } catch (err) {
    console.error('Project create error:', err.message);
    return Response.json({ error: 'Could not create the project' }, { status: 500 });
  }
}

// Only the lock code is editable from the app. The address and client are joined
// against by other tabs, and the status is driven from the workbook, so neither
// belongs behind a phone-sized form.
export async function PATCH(req) {
  try {
    const body   = await req.json();
    const result = await updateProjectLockCode({ code: body.code, lockCode: body.lockCode });

    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);

  } catch (err) {
    console.error('Project update error:', err.message);
    return Response.json({ error: 'Could not save the lock code' }, { status: 500 });
  }
}
