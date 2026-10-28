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
  getTab, getConfig, readTab, appendRows, updateRange, updateRanges, updateRangesAcrossTabs,
  deleteRowsByNumbers, assertHeaders, safe, nextId, columnLetter,
} from '@/lib/sheets';
import { projectsTab, PROJECT_COL } from '@/lib/projects';
import { QUOTES_COLUMNS, QUOTE_LINES_COLUMNS, PAYMENT_STAGES_COLUMNS, PROGRESS_CLAIMS_COLUMNS, VO_REASONS } from '@/lib/quoteSchema.mjs';
import { lineAmount, quoteTotals, scheduleAmounts, finalPaymentDue, sumAmounts, round2 } from '@/lib/quoteMaths.mjs';
import { after } from 'next/server';
import { nextVersion, prunableVersions } from '@/lib/quoteVersions.mjs';
import { quotedValue } from '@/lib/projectFigures.mjs';
import { nowIsoSingapore, sheetDateToIso, todaySingapore } from '@/lib/dates';
import { clientStatusChange, attemptInFlight } from '@/lib/clientAcceptance.mjs';
import { claimCounts, mainBilledBefore } from '@/lib/progressClaims.mjs';
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
// columnLetter, not a char code: Quotes now runs past Z (AA:AC), where String.fromCharCode
// would give "]" and every Quotes range would be a 400.
const last = headers => columnLetter(headers.length - 1);
const QLAST = last(QHEADERS);   // AC
// Full-row rewrites (a save, billing, settling VOs) stop before the client columns, so a
// client answer recorded meanwhile on the quote screen is never overwritten by an older copy.
// Only setClientStatus() writes AA:AC; a brand-new row is appended at full width.
const QCORE = QCOL.clientStatus;            // 26 cells, A:Z
const QCORE_LAST = columnLetter(QCORE - 1); // Z
const coreRow = q => quoteRow(q).slice(0, QCORE);
const LLAST = last(LHEADERS);   // K
const SLAST = last(SHEADERS);   // O
const CCOL = Object.fromEntries(PROGRESS_CLAIMS_COLUMNS.map(([f], i) => [f, i]));
const CHEADERS = PROGRESS_CLAIMS_COLUMNS.map(([, h]) => h);
const CLAST = last(CHEADERS);   // S
const CLAIM_ID = /^CLM-\d+$/;

async function quotesTab() { const t = await getTab('QUOTES');         await assertHeaders(t, QHEADERS); return t; }
async function linesTab()  { const t = await getTab('QUOTE_LINES');    await assertHeaders(t, LHEADERS); return t; }
async function stagesTab() { const t = await getTab('PAYMENT_STAGES'); await assertHeaders(t, SHEADERS); return t; }
async function claimsTab() { const t = await getTab('PROGRESS_CLAIMS'); await assertHeaders(t, CHEADERS); return t; }

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
    issueVersion:      num(row[QCOL.issueVersion]) ?? 1,
    voReason:          row[QCOL.voReason] || '',
    voTitle:           row[QCOL.voTitle] || '',
    settledOnStageId:  row[QCOL.settledOnStageId] || '',
    clientStatus:      text(row[QCOL.clientStatus]).toLowerCase(),
    clientSentAt:      sheetDateToIso(row[QCOL.clientSentAt]),
    clientAcceptedAt:  sheetDateToIso(row[QCOL.clientAcceptedAt]),
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
    pdfAttachedAt:     row[SCOL.pdfAttachedAt] || '',
    rowNumber,
  };
}

function quoteRow(q) {
  return [
    q.id, q.projectCode, q.kind, q.voNumber ?? '', safe(q.propertyType),
    q.showUnit ? 'TRUE' : 'FALSE', q.discountMode || '', q.discountValue ?? '',
    q.subtotal, q.contractSum, q.status, q.currentVersion, q.nextLineNo,
    q.xeroInvoiceId || '', q.xeroInvoiceNumber || '', q.billedAmount ?? '', q.billedAt || '', safe(q.billedBy || ''),
    q.createdAt, safe(q.createdBy), q.updatedAt, safe(q.updatedBy), q.issueVersion ?? 1,
    safe(q.voReason || ''), safe(q.voTitle || ''), q.settledOnStageId || '',
    q.clientStatus || '', q.clientSentAt || '', q.clientAcceptedAt || '',
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
    s.pdfAttachedAt || '',
  ];
}

function toClaim({ row, rowNumber }) {
  return {
    id:                row[CCOL.id] || '',
    quoteId:           row[CCOL.quoteId] || '',
    claimNo:           num(row[CCOL.claimNo]) ?? 0,
    pctDone:           num(row[CCOL.pctDone]),
    contractSum:       num(row[CCOL.contractSum]),
    grossToDate:       num(row[CCOL.grossToDate]),
    billedBefore:      num(row[CCOL.billedBefore]),
    mainAmount:        num(row[CCOL.mainAmount]),
    voIds:             String(row[CCOL.voIds] || '').split(',').map(x => x.trim()).filter(Boolean),
    voAmount:          num(row[CCOL.voAmount]),
    total:             num(row[CCOL.total]),
    xeroInvoiceId:     row[CCOL.xeroInvoiceId] || '',
    xeroInvoiceNumber: row[CCOL.xeroInvoiceNumber] || '',
    xeroSyncStatus:    row[CCOL.xeroSyncStatus] || '',
    billedAt:          row[CCOL.billedAt] || '',
    billedBy:          row[CCOL.billedBy] || '',
    createdAt:         row[CCOL.createdAt] || '',
    createdBy:         row[CCOL.createdBy] || '',
    updatedAt:         row[CCOL.updatedAt] || '',
    rowNumber,
  };
}

function claimRow(c) {
  return [
    c.id, c.quoteId, c.claimNo, c.pctDone ?? '', c.contractSum ?? '', c.grossToDate ?? '',
    c.billedBefore ?? '', c.mainAmount ?? '', (c.voIds || []).join(','), c.voAmount ?? '', c.total ?? '',
    c.xeroInvoiceId || '', c.xeroInvoiceNumber || '', c.xeroSyncStatus || '',
    c.billedAt || '', safe(c.billedBy || ''), c.createdAt || '', safe(c.createdBy || ''), c.updatedAt || '',
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

/**
 * The title a VO shows on the final invoice and in lists: its vo_title, else the first line
 * of its first item's description. `lines` are the live lines of every quote on the tab.
 */
function voTitleFrom(vo, lines) {
  if (vo.voTitle) return vo.voTitle;
  const first = lines.find(l => l.quoteId === vo.id && l.version === vo.currentVersion && l.kind === 'item' && l.description);
  return first ? String(first.description).split('\n')[0].trim() : '';
}

/** A project's VOs by number, each with its display `title`, for the schedule and the lists. */
function projectVos(quotes, lines, projectCode) {
  return quotes
    .filter(q => q.projectCode === projectCode && q.kind === 'vo')
    .sort((a, b) => (a.voNumber ?? 0) - (b.voNumber ?? 0))
    .map(vo => ({ ...vo, title: voTitleFrom(vo, lines) }));
}

/** The one line the final invoice carries for a VO. */
const settlementLine = vo => ({ id: vo.id, voNumber: vo.voNumber, title: vo.title || '', contractSum: vo.contractSum });

/**
 * Stages with their computed amounts, plus the schedule-level flags, from the pure maths.
 *
 * `vos` are the project's variation orders (with `title`). While the final payment is
 * unbilled its `amount` is the total due — the %-based `balance` plus the VOs still to
 * settle, listed in `settling`. Once billed, `amount` is what was invoiced and `settling`
 * the VOs that went onto that invoice. The other stages never see a VO.
 */
export function describeSchedule(quote, stages, vos = []) {
  const others = stages.filter(s => !s.isFinal);
  const final  = stages.find(s => s.isFinal) || null;
  const s = scheduleAmounts(quote.contractSum, others, final?.billedAmount ?? null);
  const withAmounts = others.map((st, i) => ({ ...st, amount: s.amounts[i], billed: !!st.xeroInvoiceId }));
  let finalNegative = s.finalNegative;
  if (final) {
    const billed = !!final.xeroInvoiceId;
    const due = finalPaymentDue(s.finalAmount, vos);
    const settling = billed ? vos.filter(v => v.settledOnStageId === final.id) : due.vos;
    const adjustment = billed ? sumAmounts(settling.map(v => v.contractSum)) : due.adjustment;
    if (!billed) finalNegative = due.negative;
    withAmounts.push({
      ...final, sharePct: s.finalPct, billed,
      amount:       billed ? s.finalAmount : due.due,
      balance:      billed ? sumAmounts([s.finalAmount, -adjustment]) : due.balance,
      voAdjustment: adjustment,
      settling:     settling.map(settlementLine),
    });
  }
  return {
    stages:        withAmounts,
    sharesTotal:   s.sharesTotal,
    overAllocated: s.overAllocated,
    finalNegative,
  };
}

/** A quote with its live lines and its schedule. Null if there is no such quote. */
export async function loadQuote(quoteId) {
  const quotes = await readQuotes();
  const quote = quotes.find(q => q.id === quoteId);
  if (!quote) return null;
  const isVo = quote.kind === 'vo';
  const [allLines, stages, project] = await Promise.all([
    // Every line, not just this quote's: the VO titles on the schedule come from theirs
    isVo ? readLines(quoteId, quote.currentVersion) : linesTab().then(tab => readTab(tab, `A:${LLAST}`, LINE_ID, { raw: true })).then(rows => rows.map(toLine)),
    isVo ? [] : readStages(quoteId),
    readProject(quote.projectCode),
  ]);
  const lines = isVo ? allLines
    : allLines.filter(l => l.quoteId === quoteId && l.version === quote.currentVersion).sort((a, b) => a.position - b.position);
  const vos = isVo ? [] : projectVos(quotes, allLines, quote.projectCode);
  return { quote, lines, project, schedule: describeSchedule(quote, stages, vos) };
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

/**
 * Unit prices are capped at 2 decimals so the app's amounts always agree with Xero's.
 * `allowNegative` is for variation orders only: an omission is a negative line. The quote
 * itself never has one.
 */
function cleanLines(input, quoteId, nextLineNo, { allowNegative = false } = {}) {
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
    const below = n => !allowNegative && n < 0;
    if (!Number.isFinite(qty) || below(qty)) return fail(400, `Line "${description || id}": quantity must be a number`);
    const priceIn = raw.unitPrice === '' || raw.unitPrice === null || raw.unitPrice === undefined ? null : Number(raw.unitPrice);
    if (priceIn !== null && (!Number.isFinite(priceIn) || below(priceIn))) return fail(400, `Line "${description || id}": unit price must be a number`);
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
  const [project, quotes, allLines, allStages, history, allowedTypes, allClaims] = await Promise.all([
    readProject(projectCode),
    readQuotes(),
    readTab(lTab, `A:${LLAST}`, LINE_ID, { raw: true }).then(rows => rows.map(toLine)),
    readTab(sTab, `A:${SLAST}`, STAGE_ID, { raw: true }).then(rows => rows.map(toStage)),
    listPriceHistory(),
    propertyTypes(),
    readClaims(),
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

  const isVo = quote.kind === 'vo';
  const cleaned = cleanLines(input.lines, quote.id, quote.nextLineNo, { allowNegative: isVo });
  if (!cleaned.ok) return cleaned;
  const { lines } = cleaned;

  const discountMode  = input.discountMode === '%' || input.discountMode === '$' ? input.discountMode : '';
  const discountValue = discountMode ? num(input.discountValue) : null;
  // A VO's contract sum keeps its sign: an omission is negative and comes off the final invoice
  const totals = quoteTotals(lines, discountMode, discountValue, { signed: isVo });

  const voReason = text(input.voReason);
  if (isVo && voReason && !VO_REASONS.includes(voReason)) return fail(400, `Reason must be one of: ${VO_REASONS.join(', ')}`);

  // Every VO settles on the final payment invoice unless billed early on its own. Once that
  // invoice is issued there is nothing left for an omission to come off, so a VO netting to
  // zero or less is refused. An addition is still fine: it is billed with "Bill now".
  const mainQuote = isVo ? quotes.find(q => q.projectCode === projectCode && q.kind === 'quote') : null;
  // A 100% progress claim is the last invoice too
  const fullyClaimed = id => allClaims.some(c => c.quoteId === id && claimCounts(c) && Number(c.pctDone) >= 100);
  const finalBilled = !!mainQuote && (allStages.some(s => s.quoteId === mainQuote.id && s.isFinal && s.xeroInvoiceId) || fullyClaimed(mainQuote.id));
  if (isVo && finalBilled && !(totals.contractSum > 0)) {
    return fail(409, 'The final invoice is already issued. Adjust this in Xero by hand.');
  }
  // After a 100% claim nothing can bill a change to the contract sum
  if (!isVo && quote?.id && fullyClaimed(quote.id) && Math.round(totals.contractSum * 100) !== Math.round((quote.contractSum || 0) * 100)) {
    return fail(409, 'This job is fully claimed (100%), so its contract sum can no longer change. Use a variation order, or adjust in Xero by hand.');
  }

  const existingStages = isVo ? [] : allStages.filter(s => s.quoteId === quote.id);

  // An invoice attempt whose outcome is unknown (the call went out, no answer came back;
  // "sending", or "error" with its number kept) must be finished before anything changes: if it did reach Xero, a retry finds it by
  // number and amount, and an edited amount would stop it matching — and bill twice.
  // A VO is also frozen while the final payment invoice (which settles it) is in flight.
  const mainStages = mainQuote ? allStages.filter(s => s.quoteId === mainQuote.id) : [];
  // Progress claims: the main quote's own, or (for a VO) its main quote's
  const mainClaims = allClaims.filter(c => c.quoteId === (isVo ? mainQuote?.id : quote.id));
  const unfinished = attemptInFlight(quote) ? quote.xeroInvoiceNumber
    : [...existingStages, ...mainStages, ...mainClaims].find(attemptInFlight)?.xeroInvoiceNumber;
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
    ...(isVo ? { voReason, voTitle: text(input.voTitle) } : {}),
  };
  if (next.rowNumber) {
    await updateRange(qTab, `A${next.rowNumber}:${QCORE_LAST}${next.rowNumber}`, coreRow(next));
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
    schedule: isVo ? null : describeSchedule(next, savedStages, projectVos(quotes, allLines, projectCode)),
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

// ── Issue version ────────────────────────────────────────────────────────────────────

/**
 * Start the next client-facing version of a quote (v1 → v2): the number printed on its PDF
 * and in its file name. Raised only by hand, because only a person knows which saves went
 * to the client; current_version counts every save and is not this.
 *
 * `from` is the version the screen showed. If the sheet has moved on (a double click, a
 * second tab), nothing is written, so one press can never skip a version.
 */
export async function startIssueVersion(quoteId, from) {
  const [tab, quotes] = await Promise.all([quotesTab(), readQuotes()]);
  const quote = quotes.find(q => q.id === quoteId);
  if (!quote) return fail(404, `No quote with id ${quoteId}`);
  if (quote.kind !== 'quote') return fail(400, 'Variation orders are not versioned');
  if (Number(from) !== quote.issueVersion) {
    return fail(409, `${quoteId} is already on v${quote.issueVersion}. Refresh to see it.`);
  }
  const next = quote.issueVersion + 1;
  const col = String.fromCharCode(65 + QCOL.issueVersion);
  await updateRange(tab, `${col}${quote.rowNumber}:${col}${quote.rowNumber}`, [next]);
  return { ok: true, issueVersion: next };
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
  const [project, allQuotes, allLines, allStages, categories, units, types, history, allClaims] = await Promise.all([
    readProject(projectCode),
    readQuotes(),
    linesTab().then(tab => readTab(tab, `A:${LLAST}`, LINE_ID, { raw: true })).then(rows => rows.map(toLine)),
    stagesTab().then(tab => readTab(tab, `A:${SLAST}`, STAGE_ID, { raw: true })).then(rows => rows.map(toStage)),
    readCategoryList(),
    configList('QUOTE_UNITS', ['pcs', 'sqft', 'ft run', 'lot', 'room', 'lumpsum']),
    propertyTypes(),
    listPriceHistory(),
    readClaims(),
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
  const vos = projectVos(allQuotes, allLines, projectCode);
  // Whether the final payment is already invoiced decides what a VO can still do: a new
  // addition is billed on its own, and a new omission is refused
  const mainQuote = quotes.find(q => q.kind === 'quote') || null;
  const mainClaims = mainQuote ? allClaims.filter(c => c.quoteId === mainQuote.id && claimCounts(c)) : [];
  const finalBilled = !!mainQuote && (allStages.some(s => s.quoteId === mainQuote.id && s.isFinal && s.xeroInvoiceId)
    || mainClaims.some(c => Number(c.pctDone) >= 100));
  return {
    byClaims: mainClaims.length > 0,
    kind,
    project,
    quote:     main,
    lines,
    schedule:  main && kind === 'quote' ? describeSchedule(main, stages, vos) : null,
    variationOrders: vos,
    finalBilled,
    // The main quote's progress claims (cancelled ones never reached Xero and are left out)
    claims: main && kind === 'quote' ? allClaims.filter(c => c.quoteId === main.id && c.xeroSyncStatus !== 'cancelled') : [],
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
 * every variation order, with amounts. Three reads, in parallel (the lines only for the
 * VO titles).
 *
 * A VO waiting for the final invoice is listed with `onFinal` and left out of `unbilled`:
 * the final payment's amount already carries it, and counting both would double it.
 */
export async function billingSummary(projectCode) {
  const [quotes, stages, lines, allClaims] = await Promise.all([
    readQuotes(),
    stagesTab().then(tab => readTab(tab, `A:${SLAST}`, STAGE_ID, { raw: true })).then(rows => rows.map(toStage)),
    linesTab().then(tab => readTab(tab, `A:${LLAST}`, LINE_ID, { raw: true })).then(rows => rows.map(toLine)),
    readClaims(),
  ]);
  const mine = quotes.filter(q => q.projectCode === projectCode);
  const main = mine.find(q => q.kind === 'quote') || null;
  const vos = projectVos(quotes, lines, projectCode);
  const mainStages = main ? stages.filter(s => s.quoteId === main.id).sort((a, b) => a.position - b.position) : [];
  const schedule = main ? describeSchedule(main, mainStages, vos) : null;
  const claims = main ? allClaims.filter(c => c.quoteId === main.id && claimCounts(c)) : [];
  const byClaims = claims.length > 0;
  const row = (label, amount, billed, number, kind, onFinal = false) => ({ label, amount, billed, number, kind, onFinal });
  // A billed final shows its balance only: the VOs it settled are listed as billed on their own rows
  const stageAmount = st => (st.isFinal && st.xeroInvoiceId ? st.balance : st.amount);
  const items = [
    // Billed by claims: the stages are off, so only those already billed are listed
    ...(schedule?.stages || []).filter(st => !byClaims || st.xeroInvoiceId)
      .map(st => row(st.name, stageAmount(st), !!st.xeroInvoiceId, st.xeroInvoiceNumber, 'stage')),
    ...claims.map(c => row(`Progress claim ${c.claimNo} (${Number(Number(c.pctDone).toFixed(2))}%)`, c.mainAmount, !!c.xeroInvoiceId, c.xeroInvoiceNumber, 'claim')),
    ...(byClaims ? [row('Still to claim', sumAmounts([main.contractSum, -mainBilledBefore(mainStages, claims)]), false, '', 'claim')] : []),
    ...vos.map(v => row(
      `VO${v.voNumber}${v.title ? ` – ${v.title}` : ''}`,
      v.xeroInvoiceId ? v.billedAmount : v.contractSum, !!v.xeroInvoiceId, v.xeroInvoiceNumber, 'vo',
      // Waiting for the final invoice only while billing by stages; by claims it goes on a claim
      !v.xeroInvoiceId && !!main && !byClaims,
    )),
  ];
  const sum = list => sumAmounts(list.map(i => i.amount || 0));
  return {
    quoteId:     main?.id || null,
    contractSum: main?.contractSum ?? null,
    byClaims,
    items,
    billed:      sum(items.filter(i => i.billed)),
    unbilled:    sum(items.filter(i => !i.billed && !i.onFinal)),
  };
}

/**
 * Quoted value for the project screen: the quote plus every variation order, in total
 * and by service, each at its live version. Two reads, in parallel; the splitting is
 * lib/projectFigures.mjs, so the service rows sum to the contract sums to the cent.
 *
 * A saved quote counts as quoted whatever its status — the module has no "accepted"
 * state, and a quote is only written up for a job that is going ahead.
 */
export async function projectQuoteFigures(projectCode) {
  const [quotes, lines] = await Promise.all([
    readQuotes(),
    linesTab().then(tab => readTab(tab, `A:${LLAST}`, LINE_ID, { raw: true })).then(rows => rows.map(toLine)),
  ]);
  const mine = quotes.filter(q => q.projectCode === projectCode);
  return quotedValue(mine.map(q => ({
    kind:        q.kind,
    contractSum: q.contractSum,
    lines: lines.filter(l => l.quoteId === q.id && l.version === q.currentVersion),
  })));
}

// ── For billing (lib/billing.js) ─────────────────────────────────────────────────────

/**
 * Everything billing needs about a quote, read fresh in one parallel wave. `vos` are the
 * project's variation orders with their titles: the final payment invoice settles them.
 */
export async function readForBilling(quoteId) {
  const [sTab, lTab] = await Promise.all([stagesTab(), linesTab()]);
  const [quotes, stages, lines, allClaims] = await Promise.all([
    readQuotes(),
    readTab(sTab, `A:${SLAST}`, STAGE_ID, { raw: true }).then(rows => rows.map(toStage)),
    readTab(lTab, `A:${LLAST}`, LINE_ID, { raw: true }).then(rows => rows.map(toLine)),
    readClaims(),
  ]);
  const quote = quotes.find(q => q.id === quoteId) || null;
  if (!quote) return null;
  const project = await readProject(quote.projectCode);
  const mine = stages.filter(s => s.quoteId === quoteId).sort((a, b) => a.position - b.position);
  const vos = projectVos(quotes, lines, quote.projectCode);
  // Every invoice number this app has issued or is issuing, for the numbering check
  const usedNumbers = [
    ...stages.map(s => s.xeroInvoiceNumber),
    ...quotes.map(q => q.xeroInvoiceNumber),
    ...allClaims.map(c => c.xeroInvoiceNumber),
  ].filter(Boolean);
  const claims = allClaims.filter(c => c.quoteId === quoteId);
  return { quote, project, stages: mine, vos, claims, schedule: describeSchedule(quote, mine, vos), usedNumbers };
}

/** A variation order with its live lines and project, read fresh for billing. */
export async function readVoForBilling(quoteId) {
  const lTab = await linesTab();
  const [quotes, lines, stagesAll, categories, claimsAll] = await Promise.all([
    readQuotes(),
    readTab(lTab, `A:${LLAST}`, LINE_ID, { raw: true }).then(rows => rows.map(toLine)),
    stagesTab().then(tab => readTab(tab, `A:${SLAST}`, STAGE_ID, { raw: true })).then(rows => rows.map(toStage)),
    readCategoryList(),
    readClaims(),
  ]);
  const quote = quotes.find(q => q.id === quoteId) || null;
  if (!quote) return null;
  const project = await readProject(quote.projectCode);
  const live = lines.filter(l => l.quoteId === quoteId && l.version === quote.currentVersion).sort((a, b) => a.position - b.position);
  const usedNumbers = [...stagesAll.map(s => s.xeroInvoiceNumber), ...quotes.map(q => q.xeroInvoiceNumber), ...claimsAll.map(c => c.xeroInvoiceNumber)].filter(Boolean);
  // The final payment invoice, or a progress claim, may be carrying this VO right now
  const main = quotes.find(q => q.kind === 'quote' && q.projectCode === quote.projectCode);
  const finalInFlight = main
    ? stagesAll.find(s => s.quoteId === main.id && s.isFinal && attemptInFlight(s))
      || claimsAll.find(c => c.quoteId === main.id && attemptInFlight(c) && c.voIds.includes(quote.id))
      || null
    : null;
  return { quote, project, lines: live, categories, usedNumbers, finalInFlight };
}

/** Rewrite one Quotes row in place, found fresh by ID. Used for a VO's billed state. */
export async function writeQuoteRow(quote) {
  return writeQuoteRows([quote]);
}

/** Rewrite several Quotes rows in one batch, each found fresh by ID. Used to settle VOs on the final invoice. */
export async function writeQuoteRows(quotes) {
  if (!quotes.length) return;
  const tab = await quotesTab();
  const rows = await readTab(tab, 'A:A', QUOTE_ID);
  const now = nowIsoSingapore();
  const edits = quotes.map(quote => {
    const hit = rows.find(({ row }) => text(row[0]) === quote.id);
    if (!hit) throw new Error(`${quote.id} is no longer in the Quotes tab`);
    return { a1: `A${hit.rowNumber}:${QCORE_LAST}${hit.rowNumber}`, values: coreRow({ ...quote, updatedAt: now }) };
  });
  await updateRanges(tab, edits);
}

/** Rewrite one stage row in place. Re-finds the row by ID first: rows may have moved. */
export async function writeStage(stage) {
  const tab = await stagesTab();
  const rows = await readTab(tab, 'A:A', STAGE_ID);
  const hit = rows.find(({ row }) => text(row[0]) === stage.id);
  if (!hit) throw new Error(`Stage ${stage.id} is no longer in the Payment stages tab`);
  await updateRange(tab, `A${hit.rowNumber}:${SLAST}${hit.rowNumber}`, stageRow({ ...stage, updatedAt: nowIsoSingapore() }));
}

/** Rewrite several stage rows in one batch, each found fresh by ID. Used for stages billed together. */
export async function writeStages(stages) {
  if (!stages.length) return;
  if (stages.length === 1) return writeStage(stages[0]);
  const tab = await stagesTab();
  const rows = await readTab(tab, 'A:A', STAGE_ID);
  const now = nowIsoSingapore();
  const edits = stages.map(stage => {
    const hit = rows.find(({ row }) => text(row[0]) === stage.id);
    if (!hit) throw new Error(`Stage ${stage.id} is no longer in the Payment stages tab`);
    return { a1: `A${hit.rowNumber}:${SLAST}${hit.rowNumber}`, values: stageRow({ ...stage, updatedAt: now }) };
  });
  await updateRanges(tab, edits);
}

/**
 * Record an invoice on its stages and on the VOs it settles in ONE write, so no reader ever
 * sees the final billed with its VOs not (or the reverse). VO rows stop at Z as always.
 */
export async function writeBilled(stages, vos = []) {
  const [sTab, qTab] = await Promise.all([stagesTab(), vos.length ? quotesTab() : null]);
  const [sRows, qRows] = await Promise.all([readTab(sTab, 'A:A', STAGE_ID), vos.length ? readTab(qTab, 'A:A', QUOTE_ID) : []]);
  const now = nowIsoSingapore();
  const find = (rows, id, what) => {
    const hit = rows.find(({ row }) => text(row[0]) === id);
    if (!hit) throw new Error(`${what} ${id} is no longer in the sheet`);
    return hit.rowNumber;
  };
  const groups = [{ tab: sTab, edits: stages.map(st => {
    const n = find(sRows, st.id, 'Stage');
    return { a1: `A${n}:${SLAST}${n}`, values: stageRow({ ...st, updatedAt: now }) };
  }) }];
  if (vos.length) groups.push({ tab: qTab, edits: vos.map(vo => {
    const n = find(qRows, vo.id, 'Quote');
    return { a1: `A${n}:${QCORE_LAST}${n}`, values: coreRow({ ...vo, updatedAt: now }) };
  }) });
  await updateRangesAcrossTabs(groups);
}

// ── Progress claims ─────────────────────────────────────────────────────────────────

/** Every claim row, or only a quote's, in claim order. */
export async function readClaims(quoteId) {
  const tab = await claimsTab();
  const all = (await readTab(tab, `A:${CLAST}`, CLAIM_ID, { raw: true })).map(toClaim);
  return (quoteId ? all.filter(c => c.quoteId === quoteId) : all).sort((a, b) => a.claimNo - b.claimNo);
}

/** Append a new claim row with the next CLM- id and claim number. Returns the row as written. */
export async function appendClaim(claim) {
  const tab = await claimsTab();
  const all = (await readTab(tab, `A:${CLAST}`, CLAIM_ID, { raw: true })).map(toClaim);
  const now = nowIsoSingapore();
  const row = {
    ...claim,
    // Time-based plus random, not "next number": two phones appending at once must never share an id
    id: `CLM-${now.replace(/\D/g, '').slice(2, 14)}${String(Date.now() % 1000).padStart(3, '0')}${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
    // Cancelled attempts never reached Xero: their numbers are reused, so the client sees 1, 2, 3
    claimNo: all.filter(c => c.quoteId === claim.quoteId && c.xeroSyncStatus !== 'cancelled').reduce((m, c) => Math.max(m, c.claimNo || 0), 0) + 1,
    createdAt: now, updatedAt: now,
  };
  await appendRows(tab, 'A:A', [claimRow(row)]);
  return row;
}

/** Rewrite claim rows in place, found fresh by id. */
export async function writeClaims(claims) {
  if (!claims.length) return;
  const tab = await claimsTab();
  const rows = await readTab(tab, 'A:A', CLAIM_ID);
  const now = nowIsoSingapore();
  await updateRanges(tab, claims.map(c => {
    const hit = rows.find(({ row }) => text(row[0]) === c.id);
    if (!hit) throw new Error(`Claim ${c.id} is no longer in the Progress claims tab`);
    return { a1: `A${hit.rowNumber}:${CLAST}${hit.rowNumber}`, values: claimRow({ ...c, updatedAt: now }) };
  }));
}

/** Record a billed claim and the VOs on it in ONE write, so neither is ever seen without the other. */
export async function writeClaimBilled(claim, vos = []) {
  const [cTab, qTab] = await Promise.all([claimsTab(), vos.length ? quotesTab() : null]);
  const [cRows, qRows] = await Promise.all([readTab(cTab, 'A:A', CLAIM_ID), vos.length ? readTab(qTab, 'A:A', QUOTE_ID) : []]);
  const now = nowIsoSingapore();
  const at = (rows, id) => {
    const hit = rows.find(({ row }) => text(row[0]) === id);
    if (!hit) throw new Error(`${id} is no longer in the sheet`);
    return hit.rowNumber;
  };
  const n = at(cRows, claim.id);
  const groups = [{ tab: cTab, edits: [{ a1: `A${n}:${CLAST}${n}`, values: claimRow({ ...claim, updatedAt: now }) }] }];
  if (vos.length) groups.push({ tab: qTab, edits: vos.map(vo => {
    const r = at(qRows, vo.id);
    return { a1: `A${r}:${QCORE_LAST}${r}`, values: coreRow({ ...vo, updatedAt: now }) };
  }) });
  await updateRangesAcrossTabs(groups);
}

/** A quote's stage rows as they are in the sheet now, for the check after "sending" is written. */
export async function readQuoteStages(quoteId) {
  return readStages(quoteId);
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

/**
 * Record the client's answer to a quote or VO: client_status, client_sent_at and
 * client_accepted_at (AA:AC) only. Saves and billing rewrite A:Z only, so neither side can
 * overwrite the other's cells. Checked by clientStatusChange(). Returns { ok, quote } or a failure.
 */
export async function setClientStatus({ quoteId, status, date }) {
  const quotes = await readQuotes();
  const quote = quotes.find(q => q.id === quoteId);
  if (!quote) return fail(404, `No quote with id ${quoteId}`);
  // An attempt that may already be in Xero counts as billed: the answer cannot be undone under it
  let anyBilled = !!quote.xeroInvoiceId || attemptInFlight(quote);
  if (quote.kind === 'quote' && !anyBilled) {
    const [st, cl] = await Promise.all([readStages(quote.id), readClaims(quote.id)]);
    anyBilled = st.some(s => s.xeroInvoiceId || attemptInFlight(s)) || cl.some(claimCounts);
  }
  // An unbilled VO may be riding on a final-payment invoice or a claim being created
  if (quote.kind === 'vo' && !anyBilled) {
    const main = quotes.find(q => q.kind === 'quote' && q.projectCode === quote.projectCode);
    if (main) {
      const [st, cl] = await Promise.all([readStages(main.id), readClaims(main.id)]);
      anyBilled = st.some(s => s.isFinal && attemptInFlight(s)) || cl.some(c => attemptInFlight(c) && c.voIds.includes(quote.id));
    }
  }
  const change = clientStatusChange(quote, status, { date, today: todaySingapore(), anyBilled });
  if (change.error) return fail(400, change.error);
  const tab = await quotesTab();
  const from = columnLetter(QCOL.clientStatus);
  const to = columnLetter(QCOL.clientAcceptedAt);
  await updateRange(tab, `${from}${quote.rowNumber}:${to}${quote.rowNumber}`,
    [change.clientStatus, change.clientSentAt, change.clientAcceptedAt]);
  return { ok: true, quote: { ...quote, ...change } };
}

/**
 * Every Xero invoice this app billed, as [{ xeroId, projectCode, stage }], for matching
 * invoices to projects exactly (lib/projectFigures.mjs → assignDocuments). A payment
 * stage names itself; a VO billed on its own is "VO n". A VO settled on the final payment
 * invoice carries that invoice's id too, so stage rows are taken first and win.
 * Two reads, in parallel; no per-project filtering, since matching needs every project.
 */
export async function billedInvoiceIndex() {
  const [qTab, sTab] = await Promise.all([quotesTab(), stagesTab()]);
  const [quotes, stages] = await Promise.all([
    readTab(qTab, `A:${QLAST}`, QUOTE_ID, { raw: true }).then(rows => rows.map(toQuote)),
    readTab(sTab, `A:${SLAST}`, STAGE_ID, { raw: true }).then(rows => rows.map(toStage)),
  ]);
  const projectOf = new Map(quotes.map(q => [q.id, q.projectCode]));
  const out = new Map();
  // Stages billed together share one invoice: its label names them all, in schedule order
  for (const s of [...stages].sort((a, b) => a.position - b.position)) {
    if (!s.xeroInvoiceId || !projectOf.get(s.quoteId)) continue;
    const seen = out.get(s.xeroInvoiceId);
    if (seen) seen.stage = `${seen.stage} + ${s.name}`;
    else out.set(s.xeroInvoiceId, { xeroId: s.xeroInvoiceId, projectCode: projectOf.get(s.quoteId), stage: s.name });
  }
  const claims = await readClaims();
  for (const c of claims) {
    if (c.xeroInvoiceId && projectOf.get(c.quoteId) && !out.has(c.xeroInvoiceId)) {
      out.set(c.xeroInvoiceId, { xeroId: c.xeroInvoiceId, projectCode: projectOf.get(c.quoteId), stage: `Progress claim ${c.claimNo}` });
    }
  }
  for (const q of quotes) {
    if (q.kind === 'vo' && q.xeroInvoiceId && !out.has(q.xeroInvoiceId)) {
      out.set(q.xeroInvoiceId, { xeroId: q.xeroInvoiceId, projectCode: q.projectCode, stage: `VO ${q.voNumber ?? ''}`.trim() });
    }
  }
  return [...out.values()];
}

export { configList, getConfig };
