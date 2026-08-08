// Date helpers. The workbook is now on Asia/Singapore, but Vercel functions run in UTC,
// so server-side timestamps are formatted explicitly rather than relying on the runtime.

const TZ = 'Asia/Singapore';

/** Today as YYYY-MM-DD in the device's own timezone. Client-side only. */
export function todayLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Current time as ISO 8601 with the Singapore offset, e.g. 2026-08-09T14:32:10+08:00.
 * Written to created_at / updated_at. The offset stops Sheets parsing it as a date, so
 * it stays readable text, and a human reading the sheet sees local time rather than UTC.
 */
export function nowIsoSingapore() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
}

/** Today as YYYY-MM-DD in Singapore. Server-side default when the client sends no date. */
export function todaySingapore() {
  return nowIsoSingapore().slice(0, 10);
}

/**
 * Google Sheets stores dates as a serial number of days since 1899-12-30.
 * Converts one to YYYY-MM-DD. Passes through strings that already look like ISO dates,
 * so a hand-typed cell still works.
 */
export function sheetDateToIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  return isIsoDate(text) ? text : text;
}

/** Render YYYY-MM-DD as "9 Aug 2026", matching the workbook's display format. */
export function formatIsoDate(iso) {
  if (!isIsoDate(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** True for a well-formed YYYY-MM-DD that is also a real calendar date. */
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
