// PIN login. Users live in the workbook's System config tab as:
//   PWA_USER_1 = "<name>|<4-digit PIN>|<role>"

import { getSheetsClient, getSheetId } from '@/lib/google';
import { quoteTab } from '@/lib/sheets';

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
        return Response.json({ user: { name, role: role || 'user' } });
      }
    }

    return Response.json({ error: 'Incorrect PIN' }, { status: 401 });

  } catch (err) {
    console.error('Auth error:', err.message);
    return Response.json({ error: 'Could not reach the spreadsheet' }, { status: 500 });
  }
}
