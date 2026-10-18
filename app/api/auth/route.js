// PIN login. Users live in the workbook's System config tab as:
//   PWA_USER_1 = "<name>|<4-digit PIN>|<role>"
// The same rows sign people in to expense-pwa, so a PIN can be right and still have no
// access here: only the roles in lib/roles.mjs get in.

import { getSheetsClient, getSheetId } from '@/lib/google';
import { quoteTab } from '@/lib/sheets';
import { hasAccess } from '@/lib/roles.mjs';

export async function POST(req) {
  try {
    const { pin } = await req.json();

    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return Response.json({ error: 'PIN must be 4 digits' }, { status: 400 });
    }

    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSheetId(),
      range: `${quoteTab('System config')}!A:B`,
    });

    const userRows = (res.data.values || []).filter(r => String(r[0] || '').startsWith('PWA_USER'));

    for (const row of userRows) {
      const [name, userPin, role] = String(row[1] || '').split('|').map(s => s?.trim());
      if (userPin && userPin === pin) {
        if (!hasAccess(role)) {
          return Response.json({ error: 'No access to Projects. Ask an admin.' }, { status: 403 });
        }
        return Response.json({ user: { name, role: role.toLowerCase() } });
      }
    }

    return Response.json({ error: 'Incorrect PIN' }, { status: 401 });

  } catch (err) {
    console.error('Auth error:', err.message);
    return Response.json({ error: 'Could not reach the spreadsheet' }, { status: 500 });
  }
}
