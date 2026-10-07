// Server-side PIN check, for actions that must not rest on the browser's session alone —
// billing creates approved invoices in Xero. Users are `PWA_USER_n = name|PIN|role` rows in
// System config, the same rows /api/auth reads. Returns { name, role } or null.

import { getSheetsClient, getSheetId } from '@/lib/google';
import { quoteTab } from '@/lib/sheets';

export async function verifyPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return null;
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${quoteTab('System config')}!A:B`,
  });
  for (const row of res.data.values || []) {
    if (!/^PWA_USER/.test(String(row[0] || ''))) continue;
    const [name, userPin, role] = String(row[1] || '').split('|').map(s => s?.trim());
    if (userPin && userPin === pin) return { name, role: role || 'user' };
  }
  return null;
}
