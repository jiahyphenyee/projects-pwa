// The client-facing quote PDF, drawn with pdf-lib. Takes a plain model (built by
// lib/quoteDocument.js from the saved quote and System config) and returns PDF bytes.
// `.mjs` and free of app imports so node --test can render it.
//
// Section subtotals are NOT printed (William, 2026-10-06): titles appear as headings only.
// Every figure arrives already computed by lib/quoteMaths.mjs; nothing is summed here.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const MARGIN = 40;
const INK = rgb(0.1, 0.11, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.89);
const BAND = rgb(0.94, 0.95, 0.96);

const money = n => '$' + Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => `${Number(Number(n || 0).toFixed(2))}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/**
 * The standard PDF fonts only cover Windows-1252. Swap the common lookalikes, and replace
 * anything else (Chinese, emoji) with "?" rather than failing the whole document.
 */
export function printable(font, text) {
  const swapped = String(text ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/ /g, ' ').replace(/\t/g, '  ');
  let out = '';
  for (const ch of swapped) {
    // Line breaks are layout, not glyphs: wrap() splits on them, so they pass through
    if (ch === '\n' || ch === '\r') { out += ch; continue; }
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

/** Break text into lines no wider than `width`, keeping its own line breaks. */
export function wrap(font, size, text, width) {
  const lines = [];
  for (const para of printable(font, text).split(/\r?\n/)) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      // A single word wider than the column is cut, not allowed to overflow
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export async function renderQuotePdf(model) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${model.heading} ${model.number}`);
  doc.setAuthor(model.company.name || '');
  doc.setCreator('Projects PWA');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let logo = null;
  if (model.logo?.length) {
    const b = model.logo;
    const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    logo = isPng ? await doc.embedPng(b) : await doc.embedJpg(b);
  }

  const width = A4[0] - MARGIN * 2;
  let page;
  let y;

  const text = (s, x, yy, { size = 9, f = font, color = INK, align = 'left', w = 0 } = {}) => {
    const t = printable(f, s);
    const tw = f.widthOfTextAtSize(t, size);
    const xx = align === 'right' ? x + w - tw : align === 'center' ? x + (w - tw) / 2 : x;
    page.drawText(t, { x: xx, y: yy, size, font: f, color });
  };
  const rule = (yy, color = RULE) => page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: MARGIN + width, y: yy }, thickness: 0.6, color });

  // ── Columns of the line table ─────────────────────────────────────────────────────
  const cols = [];
  const add = (key, label, w, align = 'left') => cols.push({ key, label, w, align });
  add('no', 'No.', 26);
  add('description', 'Description', 0);
  add('qty', 'Qty', 42, 'right');
  if (model.showUnit) add('unit', 'Unit', 50);
  add('unitPrice', 'Unit price', 72, 'right');
  add('amount', 'Amount', 78, 'right');
  const fixed = cols.reduce((a, c) => a + c.w, 0) + (cols.length - 1) * 8;
  cols.find(c => c.key === 'description').w = width - fixed;
  let x = MARGIN;
  for (const c of cols) { c.x = x; x += c.w + 8; }
  const descCol = cols.find(c => c.key === 'description');

  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 16, width, height: 18, color: BAND });
    for (const c of cols) text(c.label.toUpperCase(), c.x, y - 11, { size: 7.5, f: bold, color: MUTED, align: c.align, w: c.w });
    y -= 22;
  };

  const newPage = (withTableHeader) => {
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
    if (doc.getPageCount() > 1) {
      text(`${model.heading} ${model.number} (continued)`, MARGIN, y - 8, { size: 8, color: MUTED });
      y -= 22;
    }
    if (withTableHeader) tableHeader();
  };
  const need = (h, withTableHeader = false) => { if (y - h < MARGIN + 24) newPage(withTableHeader); };

  // ── Letterhead ────────────────────────────────────────────────────────────────────
  newPage(false);
  const headTop = y;
  if (logo) {
    const h = 44;
    const w = Math.min(160, (logo.width / logo.height) * h);
    page.drawImage(logo, { x: MARGIN, y: headTop - h, width: w, height: h });
  }
  const c = model.company;
  let ry = headTop - 10;
  const companyLines = [
    [c.name, bold, 11],
    [c.uen ? `UEN ${c.uen}` : '', font, 8],
    ...String(c.address || '').split(/\r?\n/).map(l => [l, font, 8]),
    [[c.phone, c.email].filter(Boolean).join('  ·  '), font, 8],
  ].filter(([s]) => s);
  for (const [s, f, size] of companyLines) {
    text(s, MARGIN, ry, { size, f, align: 'right', w: width, color: f === bold ? INK : MUTED });
    ry -= size + 3;
  }
  y = Math.min(ry, headTop - (logo ? 52 : 0)) - 14;

  text(model.heading, MARGIN, y - 16, { size: 18, f: bold });
  y -= 30;

  // Who and what, in two columns
  const facts = [
    ['Client', model.client || '-'],
    ['Project', model.project || '-'],
    ['Property type', model.propertyType || '-'],
  ];
  const meta = [
    ['Number', model.number],
    ['Date', formatDate(model.date)],
  ];
  let fy = y;
  for (const [k, v] of facts) {
    text(k.toUpperCase(), MARGIN, fy, { size: 7, f: bold, color: MUTED });
    const lines = wrap(font, 9.5, v, width * 0.6);
    lines.forEach((l, i) => text(l, MARGIN + 80, fy - i * 12, { size: 9.5 }));
    fy -= Math.max(1, lines.length) * 12 + 4;
  }
  let my = y;
  for (const [k, v] of meta) {
    text(k.toUpperCase(), MARGIN + width - 170, my, { size: 7, f: bold, color: MUTED });
    text(v, MARGIN + width - 100, my, { size: 9.5, align: 'right', w: 100 });
    my -= 16;
  }
  y = Math.min(fy, my) - 12;

  // ── Lines ─────────────────────────────────────────────────────────────────────────
  tableHeader();
  let number = 0;
  for (const line of model.lines) {
    if (line.kind === 'title') {
      const lines = wrap(bold, 9, String(line.description || '').toUpperCase(), width);
      need(lines.length * 12 + 10, true);
      y -= 4;
      lines.forEach((l, i) => text(l, MARGIN, y - 8 - i * 12, { size: 9, f: bold }));
      y -= lines.length * 12 + 4;
      rule(y + 2);
      continue;
    }
    number += 1;
    const lines = wrap(font, 9, line.description, descCol.w);
    const h = Math.max(1, lines.length) * 11.5 + 8;
    need(h, true);
    const top = y - 9;
    const cells = {
      no: String(number),
      qty: trimNumber(line.qty),
      unit: line.unit || '',
      unitPrice: line.unitPrice === null || line.unitPrice === undefined ? '' : money(line.unitPrice),
      amount: money(line.amount),
    };
    for (const col of cols) {
      if (col.key === 'description') lines.forEach((l, i) => text(l, col.x, top - i * 11.5, { size: 9, w: col.w }));
      else text(cells[col.key], col.x, top, { size: 9, align: col.align, w: col.w, color: col.key === 'no' ? MUTED : INK, f: col.key === 'amount' ? bold : font });
    }
    y -= h;
    rule(y + 3);
  }

  // ── Totals ────────────────────────────────────────────────────────────────────────
  need(90);
  y -= 10;
  const tx = MARGIN + width - 230;
  const totalRow = (label, value, { strong = false, size = 9.5 } = {}) => {
    text(label, tx, y, { size, f: strong ? bold : font, color: strong ? INK : MUTED });
    text(value, tx, y, { size, f: strong ? bold : font, align: 'right', w: 230 });
    y -= size + 7;
  };
  totalRow('Subtotal', money(model.totals.subtotal));
  if (model.totals.discount > 0) totalRow(model.totals.discountLabel || 'Discount', `-${money(model.totals.discount)}`);
  // The rule sits clear of the 12pt contract sum below it, whose capitals rise ~9pt
  page.drawLine({ start: { x: tx, y: y + 6 }, end: { x: MARGIN + width, y: y + 6 }, thickness: 0.8, color: INK });
  y -= 10;
  totalRow('Contract sum (SGD)', money(model.totals.contractSum), { strong: true, size: 12 });
  text('No GST', tx, y + 3, { size: 8, color: MUTED });
  y -= 14;

  // ── Payment schedule ──────────────────────────────────────────────────────────────
  if (model.schedule?.length) {
    need(40 + model.schedule.length * 16);
    y -= 8;
    text('PAYMENT SCHEDULE', MARGIN, y, { size: 8, f: bold, color: MUTED });
    y -= 8;
    rule(y);
    for (const s of model.schedule) {
      need(18);
      y -= 13;
      text(s.name, MARGIN, y, { size: 9.5 });
      text(s.isFinal ? `Balance (${pct(s.sharePct)})` : pct(s.sharePct), MARGIN + width - 200, y, { size: 9.5, color: MUTED, align: 'right', w: 80 });
      text(money(s.amount), MARGIN + width - 110, y, { size: 9.5, f: bold, align: 'right', w: 110 });
      y -= 5;
      rule(y);
    }
    y -= 6;
  }

  // ── Terms ─────────────────────────────────────────────────────────────────────────
  if (String(model.terms || '').trim()) {
    const lines = wrap(font, 8.5, model.terms, width);
    need(30);
    y -= 12;
    text('TERMS AND CONDITIONS', MARGIN, y, { size: 8, f: bold, color: MUTED });
    y -= 14;
    for (const l of lines) {
      need(12);
      text(l, MARGIN, y, { size: 8.5, color: INK });
      y -= 11;
    }
  }

  // ── Page numbers, once the page count is known ────────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    text(`Page ${i + 1} of ${pages.length}`, MARGIN, MARGIN - 18, { size: 7.5, color: MUTED, align: 'right', w: width });
    text(`${model.heading} ${model.number}`, MARGIN, MARGIN - 18, { size: 7.5, color: MUTED });
  });

  return doc.save();
}

function trimNumber(n) {
  if (n === null || n === undefined || n === '') return '';
  return String(Number(Number(n).toFixed(2)));
}
