// Quotes, their lines and their payment stages — the three tabs this feature owns.
//
// Saving is versioned, because Sheets has no transactions. A delete-and-rewrite of a
// quote's lines can fail halfway and leave a quote with half its rows; two overlapping
// saves can delete each other's rows by index. So a save never touches the live lines:
//
//   1. append the new lines as version N+1, in one request;
//   2. flip the quote row's current_version to N+1 — a single write, the commit point;
//   3. only then prune older versions, keeping any a billed stage still refers to.
//
// A failure before step 2 leaves the old version live and the new rows as harmless
// orphans the next prune removes. A failure in step 3 costs nothing but tab space.
//
// Line IDs are `<quote_id>-L<n>` from a per-quote counter that only ever goes up, so a
// deleted line's ID is never handed to a new line. Price history is keyed on that ID.

import {
  getTab, getConfig, readTab, appendRows, updateRange, updateRanges, findRowById,
  deleteRowsByNumbers, assertHeaders, safe, nextId,
} from '@/lib/sheets';
import { projectsTab, PROJECT_COL, updateProjectPropertyType } from '@/lib/projects';
import { QUOTES_COLUMNS, QUOTE_LINES_COLUMNS, PAYMENT_STAGES_COLUMNS } from '@/lib/quoteSchema.mjs';
import { lineAmount, quoteTotals, scheduleAmounts, round2 } from '@/lib/quoteMaths.mjs';
import { nowIsoSingapore } from '@/lib/dates';
import { writePriceHistoryForQuote } from '@/lib/priceHistory';

const QUOTE_ID   = /^Q-\d+$/;
const LINE_ID    = /^Q-\d+-L\d+$/;
const STAGE_ID   = /^ST-/;
const PROJECT_ID = /^(PRJ-|GEN-)/;

export const FINAL_STAGE_NAME = 'Final payment (balance)';

const QCOL = Object.fromEntries(QUOTES_COLUMNS.map(([f], i) => [f, i]));
const LCOL = Object.fromEntries(QUOTE_LINES_COLUMNS.map(([f], i) => [f, i]));
const SCOL = Object.fromEntries(PAYMENT_STAGES_COLUMNS.map(([f], i) => [f, i]));
const QHEADERS = QUOTES_COLUMNS.map(([, h]) => h);
const LHEADERS = QUOTE_LINES_COLUMNS.map(([, h]) => h);
const SHEADERS = PAYMENT_STAGES_COLUMNS.map(([, h]) => h);
const last = headers => String.fromCharCode(64 + headers.length);
const QLAST = last(QHEADERS);   // V
const LLAST = last(LHEADERS);   // K
const SLAST = last(SHEADERS);   // N

async function quotesTab() { const t = await getTab('QUOTES');         await assertHeaders(t, QHEADERS); return t; }
async function linesTab()  { const t = await getTab('QUOTE_LINES');    await assertHeaders(t, LHEADERS); return t; }
async function stagesTab() { const t = await getTab('PAYMENT_STAGES'); await assertHeaders(t, SHEADERS); return t; }

const num  = v => (v === '' || v === null || v === undefined) ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const flag = v => v === true || String(v ?? '').trim().toUpperCase() === 'TRUE';
const text = v => String(v ?? '').trim();

// ── Row ↔ object ─────────────────────────────────────────────────────────────────────

function toQuote({ row, rowNumber }) {
  return {
    id:                row[QCOL.id] || '',
    projectCode:       row[QCOL.projectCode] || '',
    kind:              row[QCOL.kind] || 'quote',
    voNumber:          num(row[QCOL.voNumber]),
    propertyType:      row[QCOL.propertyType] || '',
    showUnit:          flag(row[QCOL.showUnit]),
    discountMode:      row[QCOL.discountMode] || '',
    discountValue:     num(row[QCOL.discountValue]),
    subtotal:          num(row[QCOL.subtotal]) ?? 0,
    contractSum:       num(row[QCOL.contractSum]) ?? 0,
    status:            row[QCOL.status] || 'draft',
    currentVersion:    num(row[QCOL.currentVersion]) ?? 0,
    nextLineNo:        num(row[QCOL.nextLineNo]) ?? 1,
    xeroInvoiceId:     row[QCOL.xeroInvoiceId] || '',
    xeroInvoiceNumber: row[QCOL.xeroInvoiceNumber] || '',
    billedAmount:      num(row[QCOL.billedAmount]),
    billedAt:          row[QCOL.billedAt] || '',
    billedBy:          row[QCOL.billedBy] || '',
    createdAt:         row[QCOL.createdAt] || '',
    createdBy:         row[QCOL.createdBy] || '',
    updatedAt:         row[QCOL.updatedAt] || '',
    updatedBy:         row[QCOL.updatedBy] || '',
    rowNumber,
  };
}

function toLine({ row, rowNumber }) {
  return {
    id:          row[LCOL.id] || '',
    quoteId:     row[LCOL.quoteId] || '',
    version:     num(row[LCOL.version]) ?? 0,
    position:    num(row[LCOL.position]) ?? 0,
    kind:        row[LCOL.kind] || 'item',
    description: row[LCOL.description] || '',
    service:     row[LCOL.service] || '',
    qty:         num(row[LCOL.qty]),
    unit:        row[LCOL.unit] || '',
    unitPrice:   num(row[LCOL.unitPrice]),
    amount:      num(row[LCOL.amount]) ?? 0,
    rowNumber,
  };
}

function toStage({ row, rowNumber }) {
  return {
    id:                row[SCOL.id] || '',
    quoteId:           row[SCOL.quoteId] || '',
    position:          num(row[SCOL.position]) ?? 0,
    name:              row[SCOL.name] || '',
    sharePct:          num(row[SCOL.sharePct]),
    isFinal:           flag(row[SCOL.isFinal]),
    billedAmount:      num(row[SCOL.billedAmount]),
    billedAt:          row[SCOL.billedAt] || '',
    billedBy:          row[SCOL.billedBy] || '',
    xeroInvoiceId:     row[SCOL.xeroInvoiceId] || '',
    xeroInvoiceNumber: row[SCOL.xeroInvoiceNumber] || '',
    xeroSyncStatus:    row[SCOL.xeroSyncStatus] || '',
    quoteVersion:      num(row[SCOL.quoteVersion]),
    updatedAt:         row[SCOL.updatedAt] || '',
    rowNumber,
  };
}

function quoteRow(q) {
  return [
    q.id, q.projectCode, q.kind, q.voNumber ?? '', safe(q.propertyType),
    q.showUnit ? 'TRUE' : 'FALSE', q.discountMode || '', q.discountValue ?? '',
    q.subtotal, q.contractSum, q.status, q.currentVersion, q.nextLineNo,
    q.xeroInvoiceId || '', q.xeroInvoiceNumber || '', q.billedAmount ?? '', q.billedAt || '', safe(q.billedBy || ''),
    q.createdAt, safe(q.createdBy), q.updatedAt, safe(q.updatedBy),
  ];
}

function lineRow(quoteId, version, position, l) {
  return [
    l.id, quoteId, version, position, l.kind, safe(l.description), safe(l.service || ''),
    l.kind === 'item' ? l.qty : '', l.kind === 'item' ? safe(l.unit || '') : '',
    l.kind === 'item' ? l.unitPrice : '', l.kind === 'item' ? l.amount : '',
  ];
}

function stageRow(s) {
  return [
    s.id, s.quoteId, s.position, safe(s.name), s.sharePct ?? '', s.isFinal ? 'TRUE' : 'FALSE',
    s.billedAmount ?? '', s.billedAt || '', safe(s.billedBy || ''), s.xeroInvoiceId || '',
    s.xeroInvoiceNumber || '', s.xeroSyncStatus || '', s.quoteVersion ?? '', s.updatedAt,
  ];
}

// ── Reads ────────────────────────────────────────────────────────────────────────────

async function readProject(projectCode) {
  const tab = await projectsTab();
  const rows = await readTab(tab, 'A:M', PROJECT_ID);
  const hit = rows.find(({ row }) => text(row[PROJECT_COL.code]) === projectCode);
  if (!hit) return null;
  const { row } = hit;
  return {
    code:         row[PROJECT_COL.code],
    address:      row[PROJECT_COL.address] || '',
    clientId:     row[PROJECT_COL.clientId] || '',
    clientName:   row[PROJECT_COL.clientName] || '',
    propertyType: text(row[PROJECT_COL.propertyType]),
  };
}

async function readQuotes() {
  const tab = await quotesTab();
  return (await readTab(tab, `A:${QLAST}`, QUOTE_ID, { raw: true })).map(toQuote);
}

async function readLines(quoteId, version) {
  const tab = await linesTab();
  return (await readTab(tab, `A:${LLAST}`, LINE_ID, { raw: true }))
    .map(toLine)
    .filter(l => l.quoteId === quoteId && (version === undefined || l.version === version))
    .sort((a, b) => a.position - b.position);
}

async function readStages(quoteId) {
  const tab = await stagesTab();
  return (await readTab(tab, `A:${SLAST}`, STAGE_ID, { raw: true }))
    .map(toStage)
    .filter(s => s.quoteId === quoteId)
    .sort((a, b) => a.position - b.position);
}

/** Stages with their computed amounts, plus the schedule-level flags, from the pure maths. */
export function describeSchedule(quote, stages) {
  const others = stages.filter(s => !s.isFinal);
  const final  = stages.find(s => s.isFinal) || null;
  const s = scheduleAmounts(quote.contractSum, others, final?.billedAmount ?? null);
  const withAmounts = others.map((st, i) => ({ ...st, amount: s.amounts[i], billed: !!st.xeroInvoiceId }));
  if (final) {
    withAmounts.push({ ...final, sharePct: s.finalPct, amount: s.finalAmount, billed: !!final.xeroInvoiceId });
  }
  return {
    stages:        withAmounts,
    sharesTotal:   s.sharesTotal,
    overAllocated: s.overAllocated,
    finalNegative: s.finalNegative,
  };
}

/** A quote with its live lines and its schedule. Null if there is no such quote. */
export async function loadQuote(quoteId) {
  const quotes = await readQuotes();
  const quote = quotes.find(q => q.id === quoteId);
  if (!quote) return null;
  const [lines, stages, project] = await Promise.all([
    readLines(quoteId, quote.currentVersion),
    quote.kind === 'vo' ? [] : readStages(quoteId),
    readProject(quote.projectCode),
  ]);
  return { quote, lines, project, schedule: describeSchedule(quote, stages) };
}

/** Every quote and VO on a project, the quote first then VOs by number. */
export async function listQuotes(projectCode) {
  const quotes = (await readQuotes()).filter(q => q.projectCode === projectCode);
  return quotes.sort((a, b) => (a.kind === b.kind ? (a.voNumber ?? 0) - (b.voNumber ?? 0) : a.kind === 'quote' ? -1 : 1));
}

/** The stages a brand-new quote starts with. Shares are blank for William to fill in. */
export function defaultStages() {
  return [
    { name: 'Deposit',            sharePct: null, isFinal: false },
    { name: 'Progress payment 1', sharePct: null, isFinal: false },
    { name: 'Progress payment 2', sharePct: null, isFinal: false },
    { name: 'Progress payment 3', sharePct: null, isFinal: false },
    { name: FINAL_STAGE_NAME,     sharePct: null, isFinal: true  },
  ];
}

// ── Validation ───────────────────────────────────────────────────────────────────────

const fail = (status, error) => ({ ok: false, status, error });

/** Unit prices are capped at 2 decimals so the app's amounts always agree with Xero's. */
function cleanLines(input, quoteId, nextLineNo) {
  if (!Array.isArray(input) || !input.length) return fail(400, 'A quote needs at least one line');
  const lines = [];
  const ids = new Set();
  let next = nextLineNo;
  const ownId = new RegExp(`^${quoteId}-L(\\d+)$`);

  for (const raw of input) {
    const kind = raw.kind === 'title' ? 'title' : 'item';
    let id = text(raw.id);
    const m = ownId.exec(id);
    // Keep an ID only if this quote issued it and it is not already in this save
    if (!m || Number(m[1]) >= next || ids.has(id)) id = `${quoteId}-L${next++}`;
    ids.add(id);

    const description = text(raw.description);
    if (kind === 'title') {
      lines.push({ id, kind, description, service: '', qty: null, unit: '', unitPrice: null, amount: 0 });
      continue;
    }
    const qty = raw.qty === '' || raw.qty === null || raw.qty === undefined ? 1 : Number(raw.qty);
    if (!Number.isFinite(qty) || qty < 0) return fail(400, `Line "${description || id}": quantity must be a number`);
    const priceIn = raw.unitPrice === '' || raw.unitPrice === null || raw.unitPrice === undefined ? null : Number(raw.unitPrice);
    if (priceIn !== null && (!Number.isFinite(priceIn) || priceIn < 0)) return fail(400, `Line "${description || id}": unit price must be a number`);
    const unitPrice = priceIn === null ? null : round2(priceIn);
    lines.push({
      id, kind, description,
      service:   text(raw.service),
      qty,
      unit:      text(raw.unit),
      unitPrice,
      amount:    lineAmount(qty, unitPrice ?? 0),
    });
  }
  return { ok: true, lines, nextLineNo: next };
}

function cleanStages(input, existing) {
  const billed = existing.filter(s => s.xeroInvoiceId);
  const given = Array.isArray(input) && input.length ? input : null;
  const source = given || (existing.length ? existing : defaultStages());

  const stages = [];
  for (const raw of source) {
    const id = text(raw.id);
    const stored = id ? existing.find(s => s.id === id) : null;
    if (stored?.xeroInvoiceId) { stages.push({ ...stored }); continue; }   // locked: input ignored

    const name = text(raw.name);
    if (!name) return fail(400, 'Every stage needs a name');
    const pct = raw.sharePct === '' || raw.sharePct === null || raw.sharePct === undefined ? null : Number(raw.sharePct);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return fail(400, `Stage "${name}": share must be between 0 and 100`);
    stages.push({ ...(stored || {}), id, name, sharePct: raw.isFinal ? null : pct, isFinal: !!raw.isFinal });
  }

  for (const b of billed) {
    if (!stages.some(s => s.id === b.id)) return fail(409, `"${b.name}" has been invoiced (${b.xeroInvoiceNumber || b.xeroInvoiceId}) and cannot be removed. Void the invoice in Xero first.`);
  }
  const finals = stages.filter(s => s.isFinal);
  if (finals.length !== 1) return fail(400, 'A schedule needs exactly one final payment stage');
  // The final payment is always last
  const ordered = [...stages.filter(s => !s.isFinal), finals[0]];
  return { ok: true, stages: ordered };
}

// ── Save ─────────────────────────────────────────────────────────────────────────────

/**
 * Create or update a quote or VO. See the file header for why this is versioned.
 *
 * input: { id?, projectCode, kind?, propertyType?, lines, stages?, showUnit?, discountMode?,
 *          discountValue?, user }
 * Returns { ok, quote, lines, schedule, warnings } or { ok: false, status, error }.
 */
export async function saveQuote(input) {
  const projectCode = text(input.projectCode);
  const user = text(input.user) || 'unknown';
  const warnings = [];

  const project = await readProject(projectCode);
  if (!project) return fail(404, `No project with code ${projectCode}`);

  // Property type lives on the project; a quote may set it the first time if it is blank
  if (!project.propertyType) {
    const wanted = text(input.propertyType);
    if (!wanted) return fail(400, 'Set the project\'s property type (HDB, Condo or Commercial) before saving a quote');
    const allowed = await propertyTypes();
    const set = await updateProjectPropertyType({ code: projectCode, propertyType: wanted, allowed });
    if (!set.ok) return set;
    project.propertyType = wanted;
  }

  const quotes = await readQuotes();
  const now = nowIsoSingapore();
  let quote;
  const requestedId = text(input.id);

  if (requestedId) {
    quote = quotes.find(q => q.id === requestedId);
    if (!quote) return fail(404, `No quote with id ${requestedId}`);
    if (quote.projectCode !== projectCode) return fail(400, `${requestedId} belongs to ${quote.projectCode}, not ${projectCode}`);
    if (quote.xeroInvoiceId) return fail(409, `${requestedId} has been invoiced (${quote.xeroInvoiceNumber || quote.xeroInvoiceId}) and is locked`);
  } else {
    const kind = input.kind === 'vo' ? 'vo' : 'quote';
    const mine = quotes.filter(q => q.projectCode === projectCode);
    if (kind === 'quote' && mine.some(q => q.kind === 'quote')) {
      return fail(409, `${projectCode} already has a quote (${mine.find(q => q.kind === 'quote').id}); open it instead`);
    }
    quote = {
      id: nextId(quotes.map(q => q.id), 'Q-', 4),
      projectCode, kind,
      voNumber: kind === 'vo' ? Math.max(0, ...mine.filter(q => q.kind === 'vo').map(q => q.voNumber || 0)) + 1 : null,
      status: 'draft', currentVersion: 0, nextLineNo: 1,
      xeroInvoiceId: '', xeroInvoiceNumber: '', billedAmount: null, billedAt: '', billedBy: '',
      createdAt: now, createdBy: user,
      rowNumber: null,
    };
  }

  const cleaned = cleanLines(input.lines, quote.id, quote.nextLineNo);
  if (!cleaned.ok) return cleaned;
  const { lines } = cleaned;

  const discountMode  = input.discountMode === '%' || input.discountMode === '$' ? input.discountMode : '';
  const discountValue = discountMode ? num(input.discountValue) : null;
  const totals = quoteTotals(lines, discountMode, discountValue);

  let stages = [];
  if (quote.kind !== 'vo') {
    const existing = quote.rowNumber ? await readStages(quote.id) : [];
    const cs = cleanStages(input.stages, existing);
    if (!cs.ok) return cs;
    stages = cs.stages;
  }

  // 1. New version of the lines, as one block
  const version = quote.currentVersion + 1;
  const lTab = await linesTab();
  await appendRows(lTab, 'A:A', lines.map((l, i) => lineRow(quote.id, version, i + 1, l)));

  // 2. The commit point: the quote row now names the new version
  const next = {
    ...quote,
    propertyType:   project.propertyType,
    showUnit:       !!input.showUnit,
    discountMode, discountValue,
    subtotal:       totals.subtotal,
    contractSum:    totals.contractSum,
    currentVersion: version,
    nextLineNo:     cleaned.nextLineNo,
    updatedAt:      now,
    updatedBy:      user,
  };
  const qTab = await quotesTab();
  if (next.rowNumber) {
    await updateRange(qTab, `A${next.rowNumber}:${QLAST}${next.rowNumber}`, quoteRow(next));
  } else {
    await appendRows(qTab, 'A:A', [quoteRow(next)]);
    next.rowNumber = await findRowById(qTab, next.id);
  }

  // 3. Stages: rewrite unbilled rows in place, add new ones, drop removed ones
  if (quote.kind !== 'vo') {
    const sTab = await stagesTab();
    const existing = await readStages(quote.id);
    const allStageIds = (await readTab(sTab, 'A:A', STAGE_ID)).map(({ row }) => row[0]);
    const updates = [];
    const inserts = [];
    stages.forEach((s, i) => {
      const row = { ...s, quoteId: quote.id, position: i + 1, updatedAt: now };
      const stored = existing.find(e => e.id === s.id);
      if (stored) {
        if (!stored.xeroInvoiceId) updates.push({ a1: `A${stored.rowNumber}:${SLAST}${stored.rowNumber}`, values: stageRow(row) });
      } else {
        row.id = nextId(allStageIds, 'ST-', 4);
        allStageIds.push(row.id);
        inserts.push(stageRow(row));
      }
    });
    const keep = new Set(stages.map(s => s.id));
    const stale = existing.filter(e => !keep.has(e.id) && !e.xeroInvoiceId).map(e => e.rowNumber);
    if (updates.length) await updateRanges(sTab, updates);
    if (inserts.length) await appendRows(sTab, 'A:A', inserts);
    if (stale.length) await deleteRowsByNumbers(sTab, stale);
  }

  // 4. Prune older line versions nobody refers to any more
  try {
    const billedVersions = new Set(
      (quote.kind === 'vo' ? [] : await readStages(quote.id))
        .filter(s => s.xeroInvoiceId && s.quoteVersion !== null)
        .map(s => s.quoteVersion)
    );
    const old = (await readLines(quote.id)).filter(l => l.version !== version && !billedVersions.has(l.version));
    if (old.length) await deleteRowsByNumbers(lTab, old.map(l => l.rowNumber));
  } catch (err) {
    warnings.push(`Saved, but older line versions could not be pruned: ${err.message}`);
  }

  // 5. Price history mirrors the saved item rows
  try {
    await writePriceHistoryForQuote({
      quoteId: quote.id, kind: quote.kind, propertyType: project.propertyType,
      clientName: project.clientName, lines,
    });
  } catch (err) {
    warnings.push(`Saved, but price history was not updated: ${err.message}`);
  }

  const loaded = await loadQuote(quote.id);
  return { ok: true, ...loaded, warnings };
}

async function propertyTypes() {
  const raw = await getConfig('QUOTE_PROPERTY_TYPES');
  const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : ['HDB', 'Condo', 'Commercial'];
}
