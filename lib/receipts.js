// Receipts for receipted expenses, read straight from Xero: the expense app attaches each
// receipt to the expense's Xero bill (draft while pending review, approved after), and
// this app streams that attachment to the screen. Nothing is stored here — not in the
// sheet, not on disk (JY, 2026-10-28).
//
// The browser only ever names an expense (EXP-…); the bill id is looked up server-side,
// so this can never be pointed at an arbitrary Xero document.

import { getXero } from '@/lib/xero';
import { findReceiptedExpense } from '@/lib/expenses';

const XERO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The expense and its bill, or { error, status }. */
async function billOf(expenseId) {
  if (!/^EXP-/.test(expenseId)) return { status: 400, error: 'A valid expense id is required' };
  const exp = await findReceiptedExpense(expenseId);
  if (!exp) return { status: 404, error: `No receipted expense ${expenseId}` };
  if (!XERO_ID.test(exp.xeroBillId)) return { status: 404, error: 'This expense is not in Xero yet, so there is no receipt to show.' };
  return { exp };
}

/** The receipt files on the expense's Xero bill: [{ id, name, mime, size }]. */
export async function listReceiptFiles(expenseId) {
  const b = await billOf(expenseId);
  if (b.error) return { ok: false, ...b };
  const data = await getXero().get(`/Invoices/${b.exp.xeroBillId}/Attachments`);
  const files = (data?.Attachments || []).map(a => ({
    id: a.AttachmentID, name: a.FileName || 'receipt', mime: a.MimeType || 'application/octet-stream', size: Number(a.ContentLength) || 0,
  }));
  return { ok: true, files };
}

/** One receipt file's bytes, only if it is attached to this expense's bill. */
export async function receiptFile(expenseId, attachmentId) {
  const list = await listReceiptFiles(expenseId);
  if (!list.ok) return list;
  const file = list.files.find(f => f.id === attachmentId);
  if (!file) return { ok: false, status: 404, error: 'No such receipt on this expense' };
  const bill = (await findReceiptedExpense(expenseId)).xeroBillId;
  const bytes = await getXero().get(`/Invoices/${bill}/Attachments/${file.id}`, { binary: true, headers: { Accept: file.mime } });
  return { ok: true, file, bytes };
}
