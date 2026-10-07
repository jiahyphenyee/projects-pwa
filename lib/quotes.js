// Quotes, their lines and their payment stages — the three tabs this feature owns.
//
// Saving is versioned, because Sheets has no transactions. A delete-and-rewrite of a
// quote's lines can fail halfway and leave a quote with half its rows; two overlapping
// saves can delete each other's rows by index. So a save never touches the live lines:
//
//   1. append the new lines as version N+1, in one request;
//   2. flip the quote row's current_version to N+1 — a single write, the commit point;
//   3. after the response is sent, prune older versions, keeping any a billed stage
//      still refers to (pruneOldVersions).
//
// A failure before step 2 leaves the old version live and the new rows as harmless
// orphans the next prune removes. A failure in step 3 costs nothing but tab space.
//
// A save is shaped for speed: one parallel wave of reads, the two ordered commit writes,
// one parallel wave of follow-up writes. About four round trips, not fifteen.
//
// Line IDs are `<quote_id>-L<n>` from a per-quote counter that only ever goes up, so a
// deleted line's ID is never handed to a new line. Price history is keyed on that ID.

import {
  getTab, getConfig, readTab, appendRows, updateRange, updateRanges,
  deleteRowsByNumbers, assertHeaders, safe, nextId,
} from '@/lib/sheets';
import { projectsTab, PROJECT_COL } from '@/lib/projects';
import { QUOTES_COLUMNS, QUOTE_LINES_COLUMNS, PAYMENT_STAGES_COLUMNS } from '@/lib/quoteSchema.mjs';
import { lineAmount, quoteTotals, scheduleAmounts, round2 } from '@/lib/quoteMaths.mjs';
import { after } from 'next/server';
import { nextVersion, prunableVersions } from '@/lib/quoteVersions.mjs';
import { nowIsoSingapore } from '@/lib/dates';
import { writePriceHistoryForQuote, listPriceHistory } from '@/lib/priceHistory';

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
  const { row, rowNumber } = hit;
  return {
    code:         row[PROJECT_COL.code],
    address:      row[PROJECT_COL.address] || '',
    clientId:     row[PROJECT_COL.clientId] || '',
    clientName:   row[PROJECT_COL.clientName] || '',
    propertyType: text(row[PROJECT_COL.propertyType]),
    rowNumber,
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

  // ── Wave 1: every read the save needs, in parallel ──────────────────────────────────
  // Each Sheets call costs ~400ms (seconds on a bad day), so a save is shaped as one wave
  // of reads, then the two ordered writes that make up the commit, then one wave of tidy-up
  // writes. Nothing is read twice and nothing is re-read to build the response.
  const [lTab, qTab, sTab] = await Promise.all([linesTab(), quotesTab(), stagesTab()]);
  const [project, quotes, allLines, allStages, history, allowedTypes] = await Promise.all([
    readProject(projectCode),
    readQuotes(),
    readTab(lTab, `A:${LLAST}`, LINE_ID, { raw: true }).then(rows => rows.map(toLine)),
    readTab(sTab, `A:${SLAST}`, STAGE_ID, { raw: true }).then(rows => rows.map(toStage)),
    listPriceHistory(),
    propertyTypes(),
  ]);
  if (!project) return fail(404, `No project with code ${projectCode}`);

  // Property type lives on the project (one per address). The editor's buttons set it;
  // saving writes it back to Projects.M when it is new or has changed.
  const wantedType = text(input.propertyType);
  const typeChanged = wantedType && wantedType !== project.propertyType;
  if (typeChanged && !allowedTypes.includes(wantedType)) {
    return fail(400, `Property type must be one of: ${allowedTypes.join(', ')}`);
  }
  const propertyType = typeChanged ? wantedType : project.propertyType;
  if (!propertyType) return fail(400, 'Choose the property type (HDB, Condo or Commercial) before saving');

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

  const existingStages = quote.kind === 'vo' ? [] : allStages.filter(s => s.quoteId === quote.id);

  // An invoice attempt whose outcome is unknown (the call went out, no answer came back)
  // must be finished before anything changes: if it did reach Xero, a retry finds it by
  // number and amount, and an edited amount would stop it matching — and bill twice.
  const unfinished = quote.status === 'sending' ? quote.xeroInvoiceNumber
    : existingStages.find(s => s.xeroSyncStatus === 'sending')?.xeroInvoiceNumber;
  if (unfinished) {
    return fail(409, `Invoice ${unfinished} was being created when the connection dropped. Press its Bill now / Retry bill first so the app can check Xero, then edit.`);
  }
  let stages = [];
  if (quote.kind !== 'vo') {
    const cs = cleanStages(input.stages, existingStages);
    if (!cs.ok) return cs;
    stages = cs.stages;
  }

  // ── Commit: lines first, then the quote row that points at them ─────────────────────
  // Above every version already on the tab, not just above current: a failed earlier save
  // can leave orphan rows at current + 1, and reusing that number would merge them in.
  const version = nextVersion(quote.currentVersion, allLines.filter(l => l.quoteId === quote.id).map(l => l.version));
  const lineRows = lines.map((l, i) => ({ ...l, quoteId: quote.id, version, position: i + 1 }));
  await appendRows(lTab, 'A:A', lineRows.map(l => lineRow(quote.id, version, l.position, l)));

  const next = {
    ...quote,
    propertyType,
    showUnit:       !!input.showUnit,
    discountMode, discountValue,
    subtotal:       totals.subtotal,
    contractSum:    totals.contractSum,
    currentVersion: version,
    nextLineNo:     cleaned.nextLineNo,
    updatedAt:      now,
    updatedBy:      user,
  };
  if (next.rowNumber) {
    await updateRange(qTab, `A${next.rowNumber}:${QLAST}${next.rowNumber}`, quoteRow(next));
  } else {
    await appendRows(qTab, 'A:A', [quoteRow(next)]);
  }

  // ── Wave 2: everything after the commit, one chain per tab, chains in parallel ──────
  // Within a tab the order is update → append → delete, because deleting shifts the row
  // numbers the updates are addressed to. Different tabs cannot affect each other.
  const savedStages = [];
  const stageIds = allStages.map(s => s.id);
  const stageUpdates = [];
  const stageInserts = [];
  stages.forEach((s, i) => {
    const row = { ...s, quoteId: quote.id, position: i + 1, updatedAt: now };
    const stored = existingStages.find(e => e.id === s.id);
    if (stored?.xeroInvoiceId) {
      savedStages.push({ ...stored, position: i + 1 });
    } else if (stored) {
      stageUpdates.push({ a1: `A${stored.rowNumber}:${SLAST}${stored.rowNumber}`, values: stageRow(row) });
      savedStages.push(row);
    } else {
      row.id = nextId(stageIds, 'ST-', 4);
      stageIds.push(row.id);
      stageInserts.push(stageRow(row));
      savedStages.push(row);
    }
  });
  const keepStages = new Set(savedStages.map(s => s.id));
  const staleStages = existingStages.filter(e => !keepStages.has(e.id) && !e.xeroInvoiceId).map(e => e.rowNumber);

  const projectsTabName = typeChanged ? await projectsTab() : null;

  const results = await Promise.allSettled([
    // Stages
    (async () => {
      if (stageUpdates.length) await updateRanges(sTab, stageUpdates);
      if (stageInserts.length) await appendRows(sTab, 'A:A', stageInserts);
      if (staleStages.length) await deleteRowsByNumbers(sTab, staleStages);
    })(),
    // Price history mirrors the saved item rows
    writePriceHistoryForQuote({
      quoteId: quote.id, kind: quote.kind, propertyType,
      clientName: project.clientName, lines, existing: history,
    }),
    // Property type back to the project, column M only
    typeChanged ? updateRange(projectsTabName, `M${project.rowNumber}:M${project.rowNumber}`, [safe(propertyType)]) : null,
  ]);

  const [stagesResult, historyResult, typeResult] = results;
  if (stagesResult.status === 'rejected') warnings.push(`The quote saved, but the payment stages did not: ${stagesResult.reason?.message}`);
  if (historyResult.status === 'rejected') warnings.push(`Saved, but price history was not updated: ${historyResult.reason?.message}`);
  if (typeResult.status === 'rejected') warnings.push(`Saved, but the project's property type was not updated: ${typeResult.reason?.message}`);

  // Old line versions are tidied away after the response is sent. Deleting rows is a
  // structural change and the slowest call Sheets has; nobody should wait for it, and if it
  // fails the next save tidies up instead.
  if (allLines.some(l => l.quoteId === quote.id && l.version !== version)) {
    after(() => pruneOldVersions(quote.id).catch(err => console.error(`[quotes] prune ${quote.id} failed:`, err.message)));
  }

  // Built from what was written rather than read back: one fewer round of calls, and the
  // writes above either succeeded or are reported in `warnings`.
  return {
    ok: true,
    quote:    next,
    lines:    lineRows,
    project:  { ...project, propertyType: typeResult.status === 'fulfilled' ? propertyType : project.propertyType },
    schedule: quote.kind === 'vo' ? null : describeSchedule(next, savedStages),
    warnings,
  };
}

// Prunes run one at a time in this process. Row numbers are read fresh inside each run,
// immediately before the delete, so two prunes can never act on each other's stale numbers.
// Across server instances the window is the same one deleteRowById accepts.
let pruneChain = Promise.resolve();

/**
 * Delete every line row of a quote that is neither its current version nor a version a
 * billed stage was invoiced from. Reads everything it needs fresh.
 */
export function pruneOldVersions(quoteId) {
  const run = pruneChain.then(async () => {
    const [lTab, sTab] = await Promise.all([linesTab(), stagesTab()]);
    const [quotes, lines, stages] = await Promise.all([
      readQuotes(),
      readTab(lTab, `A:${LLAST}`, LINE_ID, { raw: true }).then(rows => rows.map(toLine)),
      readTab(sTab, `A:${SLAST}`, STAGE_ID, { raw: true }).then(rows => rows.map(toStage)),
    ]);
    const quote = quotes.find(q => q.id === quoteId);
    if (!quote) return 0;
    const billed = stages.filter(s => s.quoteId === quoteId && s.xeroInvoiceId && s.quoteVersion !== null).map(s => s.quoteVersion);
    // Strictly OLDER than the current version only. A version above current belongs to a
    // save still in flight — its lines are appended before its quote row is flipped — and
    // deleting it would delete that save's lines the moment it commits. Orphans left by a
    // failed save are above current too; they are pruned once a later save passes them.
    const mine = lines.filter(l => l.quoteId === quoteId);
    const drop = new Set(prunableVersions(quote.currentVersion, mine.map(l => l.version), billed));
    const old = mine.filter(l => drop.has(l.version));
    if (!old.length) return 0;
    return deleteRowsByNumbers(lTab, old.map(l => l.rowNumber));
  });
  pruneChain = run.catch(() => {});
  return run;
}

/** Values for a comma-separated System config list, e.g. QUOTE_UNITS. */
async function configList(key, fallback) {
  const raw = await getConfig(key);
  const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

/** Every category, active or not, with its Xero option. Inactive ones stay readable on old lines. */
async function readCategoryList() {
  const tab = await getTab('CATEGORIES');
  const rows = await readTab(tab, 'A:E', /^[A-Z]{3,6}$/);
  return rows.map(({ row }) => ({
    code:       text(row[0]),
    name:       text(row[1]) || text(row[0]),
    active:     text(row[2]).toUpperCase() === 'TRUE',
    xeroOption: text(row[4]),   // Categories.E — the Service tracking option on VO invoice lines
  }));
}

/**
 * Everything the quote screen needs in one round trip: the project, its quote (or null
 * for a new one), the service and unit lists, and the property types.
 */
/**
 * `voId`: omit for the project's quote; a VO's quote_id to open that variation order;
 * 'new' for a blank variation order not yet saved.
 */
export async function loadQuoteScreen(projectCode, { voId } = {}) {
  // One parallel wave of reads, rather than finding the quote first and then loading it:
  // each Sheets call is ~400ms, so chaining them is what makes a screen feel slow.
  const [project, allQuotes, allLines, allStages, categories, units, types, history] = await Promise.all([
    readProject(projectCode),
    readQuotes(),
    linesTab().then(tab => readTab(tab, `A:${LLAST}`, LINE_ID, { raw: true })).then(rows => rows.map(toLine)),
    stagesTab().then(tab => readTab(tab, `A:${SLAST}`, STAGE_ID, { raw: true })).then(rows => rows.map(toStage)),
    readCategoryList(),
    configList('QUOTE_UNITS', ['pcs', 'sqft', 'ft run', 'lot', 'room', 'lumpsum']),
    propertyTypes(),
    listPriceHistory(),
  ]);
  if (!project) return null;

  const quotes = allQuotes.filter(q => q.projectCode === projectCode);
  const kind = voId ? 'vo' : 'quote';
  let main;
  if (voId === 'new') main = null;
  else if (voId) {
    main = quotes.find(q => q.id === voId && q.kind === 'vo') || null;
    if (!main) return { notFound: `No variation order ${voId} on ${projectCode}` };
  } else main = quotes.find(q => q.kind === 'quote') || null;
  const lines = main
    ? allLines.filter(l => l.quoteId === main.id && l.version === main.currentVersion).sort((a, b) => a.position - b.position)
    : [];
  const stages = main && kind === 'quote' ? allStages.filter(s => s.quoteId === main.id).sort((a, b) => a.position - b.position) : [];
  return {
    kind,
    project,
    quote:     main,
    lines,
    schedule:  main && kind === 'quote' ? describeSchedule(main, stages) : null,
    variationOrders: quotes.filter(q => q.kind === 'vo').sort((a, b) => (a.voNumber ?? 0) - (b.voNumber ?? 0)),
    categories,
    units,
    propertyTypes: types,
    // Loaded once with the screen; suggestions and price checks run in the browser on it.
    // Only the fields the editor uses, to keep the payload small.
    priceHistory: history.map(h => ({
      description: h.description, service: h.service, unit: h.unit, unitPrice: h.unitPrice,
      propertyType: h.propertyType, client: h.client, quotedAt: h.quotedAt, source: h.source, quoteId: h.quoteId,
    })),
  };
}

async function propertyTypes() {
  const raw = await getConfig('QUOTE_PROPERTY_TYPES');
  const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : ['HDB', 'Condo', 'Commercial'];
}

/**
 * What has been billed and what has not, for the project screen: the quote's stages and
 * every variation order, with amounts. Two reads, in parallel.
 */
export async function billingSummary(projectCode) {
  const [quotes, stages] = await Promise.all([
    readQuotes(),
    stagesTab().then(tab => readTab(tab, `A:${SLAST}`, STAGE_ID, { raw: true })).then(rows => rows.map(toStage)),
  ]);
  const mine = quotes.filter(q => q.projectCode === projectCode);
  const main = mine.find(q => q.kind === 'quote') || null;
  const schedule = main
    ? describeSchedule(main, stages.filter(s => s.quoteId === main.id).sort((a, b) => a.position - b.position))
    : null;
  const vos = mine.filter(q => q.kind === 'vo').sort((a, b) => (a.voNumber ?? 0) - (b.voNumber ?? 0));
  const row = (label, amount, billed, number, kind) => ({ label, amount, billed, number, kind });
  const items = [
    ...(schedule?.stages || []).map(st => row(st.name, st.amount, !!st.xeroInvoiceId, st.xeroInvoiceNumber, 'stage')),
    ...vos.map(v => row(`Variation order VO${v.voNumber}`, v.xeroInvoiceId ? v.billedAmount : v.contractSum, !!v.xeroInvoiceId, v.xeroInvoiceNumber, 'vo')),
  ];
  const sum = list => list.reduce((a, i) => a + Math.round((i.amount || 0) * 100), 0) / 100;
  return {
    quoteId:     main?.id || null,
    contractSum: main?.contractSum ?? null,
    items,
    billed:      sum(items.filter(i => i.billed)),
    unbilled:    sum(items.filter(i => !i.billed)),
  };
}

// ── For billing (lib/billing.js) ─────────────────────────────────────────────────────

/** Everything billing needs about a quote, read fresh in one parallel wave. */
export async function readForBilling(quoteId) {
  const sTab = await stagesTab();
  const [quotes, stages] = await Promise.all([
    readQuotes(),
    readTab(sTab, `A:${SLAST}`, STAGE_ID, { raw: true }).then(rows => rows.map(toStage)),
  ]);
  const quote = quotes.find(q => q.id === quoteId) || null;
  if (!quote) return null;
  const project = await readProject(quote.projectCode);
  const mine = stages.filter(s => s.quoteId === quoteId).sort((a, b) => a.position - b.position);
  // Every invoice number this app has issued or is issuing, for the numbering check
  const usedNumbers = [
    ...stages.map(s => s.xeroInvoiceNumber),
    ...quotes.map(q => q.xeroInvoiceNumber),
  ].filter(Boolean);
  return { quote, project, stages: mine, schedule: describeSchedule(quote, mine), usedNumbers };
}

/** A variation order with its live lines and project, read fresh for billing. */
export async function readVoForBilling(quoteId) {
  const lTab = await linesTab();
  const [quotes, lines, stagesAll, categories] = await Promise.all([
    readQuotes(),
    readTab(lTab, `A:${LLAST}`, LINE_ID, { raw: true }).then(rows => rows.map(toLine)),
    stagesTab().then(tab => readTab(tab, `A:${SLAST}`, STAGE_ID, { raw: true })).then(rows => rows.map(toStage)),
    readCategoryList(),
  ]);
  const quote = quotes.find(q => q.id === quoteId) || null;
  if (!quote) return null;
  const project = await readProject(quote.projectCode);
  const live = lines.filter(l => l.quoteId === quoteId && l.version === quote.currentVersion).sort((a, b) => a.position - b.position);
  const usedNumbers = [...stagesAll.map(s => s.xeroInvoiceNumber), ...quotes.map(q => q.xeroInvoiceNumber)].filter(Boolean);
  return { quote, project, lines: live, categories, usedNumbers };
}

/** Rewrite one Quotes row in place, found fresh by ID. Used for a VO's billed state. */
export async function writeQuoteRow(quote) {
  const tab = await quotesTab();
  const rows = await readTab(tab, 'A:A', QUOTE_ID);
  const hit = rows.find(({ row }) => text(row[0]) === quote.id);
  if (!hit) throw new Error(`${quote.id} is no longer in the Quotes tab`);
  await updateRange(tab, `A${hit.rowNumber}:${QLAST}${hit.rowNumber}`, quoteRow({ ...quote, updatedAt: nowIsoSingapore() }));
}

/** Rewrite one stage row in place. Re-finds the row by ID first: rows may have moved. */
export async function writeStage(stage) {
  const tab = await stagesTab();
  const rows = await readTab(tab, 'A:A', STAGE_ID);
  const hit = rows.find(({ row }) => text(row[0]) === stage.id);
  if (!hit) throw new Error(`Stage ${stage.id} is no longer in the Payment stages tab`);
  await updateRange(tab, `A${hit.rowNumber}:${SLAST}${hit.rowNumber}`, stageRow({ ...stage, updatedAt: nowIsoSingapore() }));
}

/** The client's Contacts row with its Xero ContactID (column H), or null. */
export async function readClientContact(clientId) {
  if (!clientId) return null;
  const tab = await getTab('CONTACTS');
  const rows = await readTab(tab, 'A:H', /^CON-/);
  const hit = rows.find(({ row }) => text(row[0]) === clientId);
  if (!hit) return null;
  return { id: hit.row[0], name: text(hit.row[1]), xeroContactId: text(hit.row[7]) };
}

export { configList, getConfig };
