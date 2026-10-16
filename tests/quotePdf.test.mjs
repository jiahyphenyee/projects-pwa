import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { renderQuotePdf, wrap, printable, formatDate, quoteFileName } from '../lib/quotePdf.mjs';

const model = (overrides = {}) => ({
  heading: 'QUOTATION', version: 'v2', date: '2026-10-07',
  company: { name: 'Heng Fa Construction Pte Ltd', uen: '201912345A', phone: '6123 4567', email: 'hello@example.com' },
  client: 'TEST – Heng Fa internal', project: 'TEST - quote and billing',
  showUnit: true,
  lines: [
    { kind: 'title', description: 'Living room' },
    { kind: 'item', description: 'Supply & install 13A double socket outlet', qty: 4, unit: 'pcs', unitPrice: 88, amount: 352 },
    { kind: 'item', description: 'To supply labour and materials to:\n(1) Construct false ceiling\n(2) Paint with Nippon “Vinilex” 5000 — 2 coats', qty: 1, unit: 'lot', unitPrice: 1200, amount: 1200 },
  ],
  totals: { subtotal: 1552, discount: 52, discountLabel: 'Discount', contractSum: 1500 },
  schedule: [
    { name: 'Deposit', sharePct: 30, amount: 450 },
    { name: 'Final payment (balance)', sharePct: 70, amount: 1050, isFinal: true },
  ],
  terms: 'Validity: 30 days.\nPayment within 14 days of invoice.',
  logo: null,
  ...overrides,
});

test('dates print as 7 Oct 2026', () => {
  assert.equal(formatDate('2026-10-07'), '7 Oct 2026');
});

test('characters the PDF fonts cannot draw are swapped or replaced, never fatal', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  assert.equal(printable(font, 'It’s “fine” – 10×'), 'It\'s "fine" – 10×');
  assert.equal(printable(font, '水电 works'), '?? works');
});

test('wrap keeps line breaks and fits the width', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrap(font, 9, 'one two three four five six seven eight nine ten\nsecond paragraph', 80);
  assert.ok(lines.length > 2);
  assert.ok(lines.every(l => font.widthOfTextAtSize(l, 9) <= 80));
  assert.ok(lines.includes('second paragraph'));
  assert.ok(wrap(font, 9, 'x'.repeat(200), 50).every(l => font.widthOfTextAtSize(l, 9) <= 50));
});

test('renders a one-page PDF that opens', async () => {
  const bytes = await renderQuotePdf(model());
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getTitle(), 'QUOTATION v2');
});

test('a variation order is named by its VO number alone', async () => {
  const doc = await PDFDocument.load(await renderQuotePdf(model({ heading: 'VARIATION ORDER VO1', version: '', schedule: null })));
  assert.equal(doc.getTitle(), 'VARIATION ORDER VO1');
});

test('file names: HFCQuote_v<n>_<address>, HFCVO<n>_<address>', () => {
  const address = 'Blk 123 Ang Mo Kio Ave 3 #05-12';
  assert.equal(quoteFileName({ kind: 'quote', issueVersion: 2, address }), 'HFCQuote_v2_Blk 123 Ang Mo Kio Ave 3 05-12.pdf');
  assert.equal(quoteFileName({ kind: 'quote', issueVersion: null, address }), 'HFCQuote_v1_Blk 123 Ang Mo Kio Ave 3 05-12.pdf');
  assert.equal(quoteFileName({ kind: 'vo', voNumber: 3, address }), 'HFCVO3_Blk 123 Ang Mo Kio Ave 3 05-12.pdf');
  assert.equal(quoteFileName({ kind: 'quote', issueVersion: 1, address: '12 A/B Road: unit "7"' }), 'HFCQuote_v1_12 A-B Road- unit -7-.pdf');
  assert.equal(quoteFileName({ prefix: 'XYZ', kind: 'quote', issueVersion: 1, address: '' }), 'XYZQuote_v1.pdf');
});

test('validity prints only when set', async () => {
  const withIt = await PDFDocument.load(await renderQuotePdf(model({ validityDays: 30 })));
  assert.equal(withIt.getPageCount(), 1);
  const without = await PDFDocument.load(await renderQuotePdf(model({ validityDays: 0 })));
  assert.equal(without.getPageCount(), 1);
});

test('a long quote runs onto more pages; no title, unit, discount or schedule still renders', async () => {
  const lines = Array.from({ length: 90 }, (_, i) => ({ kind: 'item', description: `Line ${i + 1} with a fairly long description to wrap`, qty: 1, unit: '', unitPrice: 10, amount: 10 }));
  const doc = await PDFDocument.load(await renderQuotePdf(model({
    lines, showUnit: false, totals: { subtotal: 900, discount: 0, contractSum: 900 }, schedule: null, terms: '',
    company: { name: 'Heng Fa Construction Pte Ltd' },
  })));
  assert.ok(doc.getPageCount() >= 3);
});
