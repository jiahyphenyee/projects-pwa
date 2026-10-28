// A receipted expense's receipt, from its Xero bill. Read-only; nothing is stored.
//   GET /api/costs/receipt?expense=EXP-0123                → { files: [{ id, name, mime, size }] }
//   GET /api/costs/receipt?expense=EXP-0123&file=<id>      → the file itself, shown inline

import { listReceiptFiles, receiptFile } from '@/lib/receipts';

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
    return new Response(got.bytes, {
      headers: {
        'Content-Type': got.file.mime,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(got.file.name)}`,
        // Kept by this browser for a few minutes only; never by a shared cache
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('Receipt error:', err.message);
    return Response.json({ error: `Could not get the receipt from Xero: ${err.message}` }, { status: 502 });
  }
}
