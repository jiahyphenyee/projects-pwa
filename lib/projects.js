// Server-side project writes.
//
// The Projects tab cannot be plain-appended to. Column C (client_id) holds a formula
// that derives the ID *from* client_name in column D:
//
//   =IFERROR(INDEX(Contacts!A:A, MATCH(D42, Contacts!B:B, 0)), "")
//
// It references its own row number, so it has to be written per row. Appending a row
// of plain values would leave column C blank and silently break the client link — the
// project would look fine in this app while reporting nothing to the client.

import { getSheetsClient, getSheetId } from '@/lib/google';
import { getTab, range, readTab, appendRow, updateRange, safe, nextId } from '@/lib/sheets';

const PROJECT_ID = /^(PRJ-|GEN-)/;
const CONTACT_ID = /^CON-/;

const COL = { code: 0, address: 1, clientId: 2, clientName: 3, projectName: 4, startDate: 5, status: 7 };

/** Compare addresses ignoring case, spacing and punctuation — "#09-90" vs "#09 - 90". */
function normaliseAddress(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Row number out of an append response range like "Projects!A42:B42". */
function rowNumberFromRange(updatedRange) {
  const match = /![A-Z]+(\d+)/.exec(updatedRange || '');
  if (!match) throw new Error(`Could not determine written row from range: ${updatedRange}`);
  return parseInt(match[1], 10);
}

export async function createProject({ displayAddress, clientName, startDate, force = false }) {
  const address = String(displayAddress || '').trim();
  if (!address) {
    return { ok: false, status: 400, error: 'Address is required' };
  }

  const [projectsTab, contactsTab] = await Promise.all([getTab('PROJECTS'), getTab('CONTACTS')]);
  const existing = await readTab(projectsTab, 'A:H', PROJECT_ID);

  // Duplicate addresses are legitimate (same address, different client), so this warns
  // rather than blocks — but an accidental double-submit shouldn't create a twin.
  if (!force) {
    const target = normaliseAddress(address);
    const clash = existing.find(({ row }) => normaliseAddress(row[COL.address]) === target);
    if (clash) {
      return {
        ok: false,
        status: 409,
        error: 'A project with this address already exists',
        duplicate: {
          code:       clash.row[COL.code],
          address:    clash.row[COL.address],
          clientName: clash.row[COL.clientName] || '',
        },
      };
    }
  }

  // The formula matches on company_name, so an unknown name would resolve to blank
  let resolvedClientName = '';
  if (String(clientName || '').trim()) {
    const contacts = await readTab(contactsTab, 'A:G', CONTACT_ID);
    const wanted = String(clientName).trim().toLowerCase();
    const match = contacts.find(({ row }) => String(row[1] || '').trim().toLowerCase() === wanted);
    if (!match) {
      return { ok: false, status: 400, error: `Unknown client: ${clientName}` };
    }
    resolvedClientName = match.row[1];
  }

  const code = nextId(existing.map(({ row }) => row[COL.code]), 'PRJ-', 3);
  const date = String(startDate || '').trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, status: 400, error: 'Start date must be YYYY-MM-DD' };
  }

  const warnings = [];

  // Column C is a protected range in this workbook ("autofilled"), so the write is
  // split to never touch it: append A:B to claim a row, then fill D:K. Letting the
  // API pick the row server-side also removes any chance of two writers colliding.
  const updatedRange = await appendRow(projectsTab, 'A:B', [
    code,           // A project_code
    safe(address),  // B display_address
  ]);
  const rowNumber = rowNumberFromRange(updatedRange);

  await updateRange(projectsTab, `D${rowNumber}:K${rowNumber}`, [
    safe(resolvedClientName), // D client_name
    safe(address),            // E project_name — a copy of the address, by design
    date,                     // F start_date — ISO parses unambiguously in any locale
    '',                       // G end_date
    'active',                 // H status
    '',                       // I closed_date
    '',                       // J drive_folder_url
    '',                       // K notes
  ]);

  // Column C (client_id) is deliberately NOT written. The sheet auto-fills it with
  // =IFERROR(INDEX(Contacts!A:A, MATCH(D<row>, Contacts!B:B, 0)), "") as soon as the
  // row has data, which is why it is a protected range named "autofilled". Writing it
  // is both unnecessary and blocked. The readback below confirms it resolved.

  // Read back what actually landed, so a silently-broken formula surfaces immediately
  const sheets = await getSheetsClient();
  const check = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: range(projectsTab, `A${rowNumber}:K${rowNumber}`),
  });
  const written = (check.data.values || [])[0] || [];

  if (written[COL.code] !== code) {
    warnings.push(`Row ${rowNumber} holds ${written[COL.code] || 'nothing'}, expected ${code}`);
  }
  if (resolvedClientName && !written[COL.clientId]) {
    warnings.push(
      `client_id did not populate in C${rowNumber}. The column normally auto-fills from ` +
      `client_name — check that the "autofilled" formula still covers this row.`
    );
  }

  // Two people creating at the same moment could both land on the same code
  const after = await readTab(projectsTab, 'A:A', PROJECT_ID);
  if (after.filter(({ row }) => row[COL.code] === code).length > 1) {
    warnings.push(`Duplicate project code ${code} — another project was created at the same time`);
  }

  return {
    ok: true,
    project: {
      code,
      address,
      clientId:    written[COL.clientId] || '',
      clientName:  resolvedClientName,
      projectName: address,
      startDate:   written[COL.startDate] || date,
      status:      'active',
      rowNumber,
    },
    warnings,
  };
}
