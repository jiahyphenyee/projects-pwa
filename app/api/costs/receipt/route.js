// A receipted expense's receipt, from its Xero bill. Read-only; nothing is stored.
//   GET /api/costs/receipt?expense=EXP-0123                → { files: [{ id, name, mime, size }] }
//   GET /api/costs/receipt?expense=EXP-0123&file=<id>      → the file itself, shown inline

import { listReceiptFiles, receiptFile } from '@/lib/receipts';

const SAFE_INLINE = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf'];

export async function GET(req) {
  const sp = new URL(req.url).searchParams;
  const expense = String(sp.get('expense') || '').trim();
  const fileId = sp.get('file');
  try {
    if (fileId === null) {
      const list = await listReceiptFiles(expense);
      if (!list.ok) return Response.json({ error: list.error }, { status: list.status || 400 });
      return Response.json({ files: list.files });
    }
    const got = await receiptFile(expense, String(fileId));
    if (!got.ok) return Response.json({ error: got.error }, { status: got.status || 400 });
    // Only images and PDFs are shown in the page; anything else (an HTML or SVG file
    // someone attached in Xero) is downloaded, sandboxed, and never sniffed into script
    const inline = SAFE_INLINE.includes(got.file.mime.toLowerCase());
    return new Response(got.bytes, {
      headers: {
        'Content-Type': inline ? got.file.mime : 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(got.file.name)}`,
        'X-Content-Type-Options': 'nosniff',
        // Not on PDFs: Chrome will not open its PDF viewer in a sandboxed document
        ...(inline ? {} : { 'Content-Security-Policy': 'sandbox' }),
        // Never kept: not by the browser, not by a shared cache
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Receipt error:', err.message);
    return Response.json({ error: 'Could not get the receipt from Xero. Try again in a minute.' }, { status: 502 });
  }
}
