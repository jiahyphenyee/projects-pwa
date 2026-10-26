// Every figure on the project screen beyond the plain cost list: the cost split, the
// breakdown by service, quoted value, profit and margin, the status flag, and the Xero
// invoices matched to the project. Pure: no Sheets, no Xero, no `@/` imports, so
// `node --test` runs it and the route, the screen and any later dashboard screen all
// compute the same numbers.
//
// Arithmetic is in integer cents, for the same reason as lib/quoteMaths.mjs: a project
// total is a long sum of two-decimal amounts, and a checked-by-hand figure must match to
// the cent, not to within floating-point noise.

const toCents = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((Math.abs(v) + Number.EPSILON) * 100) * (v < 0 ? -1 : 1);
};
const fromCents = c => c / 100;

// ── Settings ─────────────────────────────────────────────────────────────────────────

/** System config keys for the thresholds, and the value used when a key is absent. */
export const DASHBOARD_SETTINGS = {
  targetMarginPct:  { key: 'TARGET_MARGIN_PCT',  fallback: 35  },
  watchLevelPct:    { key: 'WATCH_LEVEL_PCT',    fallback: 80  },
  overLevelPct:     { key: 'OVER_LEVEL_PCT',     fallback: 100 },
  chaseAfterDays:   { key: 'CHASE_AFTER_DAYS',   fallback: 30  },
  overdueAfterDays: { key: 'OVERDUE_AFTER_DAYS', fallback: 60  },
};

/**
 * The thresholds as numbers, from raw System config values keyed by config key. A blank
 * or unreadable value takes the default rather than becoming 0 — a target margin of 0%
 * would mark every job Healthy without anyone having chosen that.
 */
export function readSettings(raw = {}) {
  return Object.fromEntries(Object.entries(DASHBOARD_SETTINGS).map(([field, { key, fallback }]) => {
    const text = String(raw[key] ?? '').trim();
    const n = Number(text);
    return [field, text !== '' && Number.isFinite(n) ? n : fallback];
  }));
}

// ── Cost split ───────────────────────────────────────────────────────────────────────

/** Display order. Labour is "own labour": internal workers, not subcontractors. */
export const BUCKETS = ['materials', 'subcon', 'ownLabour', 'transport'];

export const BUCKET_LABELS = {
  materials: 'Materials',
  subcon:    'Subcon',
  ownLabour: 'Own labour',
  transport: 'Transport',
};

// The four `cost_type` values, shared by Project costs column F and Receipted expenses
// column T. `labour (external)` is subcon: today it is mostly freelance painters paid by
// the day. When the Labour log goes live those days must not also be costed from it, or
// the same freelancer is counted twice.
const TYPE_TO_BUCKET = {
  'material':          'materials',
  'labour (external)': 'subcon',
  'labour (internal)': 'ownLabour',
  'transport':         'transport',
};

// Receipted rows from before column T existed carry no type. These categories are
// transport by definition; everything else a worker claims for is overwhelmingly material.
const TRANSPORT_CATEGORIES = new Set(['TRANS', 'VEHIC']);

/** Which bucket one cost line belongs to. `line` is a row from rollups' mergeLines. */
export function costBucket(line) {
  const byType = TYPE_TO_BUCKET[String(line.costType || '').trim()];
  if (byType) return byType;
  if (line.receipted && TRANSPORT_CATEGORIES.has(line.categoryCode)) return 'transport';
  return 'materials';
}

/**
 * Cost to date, split by bucket and by which ledger it came from.
 *
 * Every line lands in exactly one bucket, so the buckets always sum to `total` — the
 * same figure as rollups' grandTotal. `receipted` is spend recorded through the expense
 * app (and so in Xero as a bill); `nonReceipted` is the Project costs tab.
 */
export function costSplit(lines = []) {
  const cents = Object.fromEntries(BUCKETS.map(b => [b, 0]));
  let receipted = 0;
  let total = 0;
  for (const line of lines) {
    const c = toCents(line.amount);
    cents[costBucket(line)] += c;
    if (line.receipted) receipted += c;
    total += c;
  }
  return {
    total:        fromCents(total),
    receipted:    fromCents(receipted),
    nonReceipted: fromCents(total - receipted),
    buckets: BUCKETS.map(key => ({
      key,
      label:  BUCKET_LABELS[key],
      amount: fromCents(cents[key]),
      share:  total ? cents[key] / total : 0,
    })),
  };
}

// ── Quoted value ─────────────────────────────────────────────────────────────────────

/** The service key for a line with no category, kept distinct from any real code. */
export const UNASSIGNED = '';

/**
 * Split integer `totalCents` across `weights` (integers) in proportion, so the parts add
 * back to the total exactly. Largest remainder: each part is floored, then the leftover
 * cents go to the parts with the largest fractional remainders, ties to the earlier one.
 */
function allocate(totalCents, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!sum) return weights.map(() => 0);
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const raw = weights.map(w => (abs * w) / sum);
  const parts = raw.map(Math.floor);
  let left = abs - parts.reduce((a, p) => a + p, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts.map(p => p * sign);
}

/**
 * Quoted value, in total and by service, from a project's saved quote and variation
 * orders. Each is `{ contractSum, lines: [{ kind, service, amount }] }`, lines being its
 * current version.
 *
 * Line amounts are before discount; the contract sum is after it. Each quote's contract
 * sum is spread across its services in proportion to their line totals, so the services
 * add up to the contract sum to the cent — the breakdown's quoted column then totals to
 * the quoted figure at the top of the screen. A quote with no item amounts at all puts
 * its whole contract sum under UNASSIGNED rather than losing it.
 *
 * A variation order's contract sum is signed: an omission is negative and comes off the
 * quoted figure. `quoted` is the adjusted sum; `quoteSum`, `additions` and `omissions`
 * (a positive magnitude) are its parts, so the screen can show quote + additions −
 * omissions = adjusted. A VO is an addition or an omission by its net, never both.
 */
export function quotedValue(quotes = []) {
  const byService = new Map();
  let total = 0;
  let quoteSum = 0;
  let additions = 0;
  let omissions = 0;
  for (const q of quotes) {
    const sum = toCents(q.contractSum);
    total += sum;
    if (q.kind === 'vo') {
      if (sum < 0) omissions -= sum; else additions += sum;
    } else {
      quoteSum += sum;
    }
    const pre = new Map();
    for (const line of q.lines || []) {
      if (line.kind === 'title') continue;
      const key = String(line.service || '').trim() || UNASSIGNED;
      pre.set(key, (pre.get(key) || 0) + toCents(line.amount));
    }
    // Weights are magnitudes so an omission VO's negative sum is still spread by service
    const keys = [...pre.keys()].filter(k => pre.get(k) !== 0);
    const parts = keys.length ? allocate(sum, keys.map(k => Math.abs(pre.get(k)))) : [sum];
    (keys.length ? keys : [UNASSIGNED]).forEach((k, i) => byService.set(k, (byService.get(k) || 0) + parts[i]));
  }
  return {
    hasQuote:  quotes.length > 0,
    quoted:    quotes.length ? fromCents(total) : null,
    quoteSum:  quotes.length ? fromCents(quoteSum) : null,
    additions: fromCents(additions),
    omissions: fromCents(omissions),
    byService: Object.fromEntries([...byService].map(([k, c]) => [k, fromCents(c)])),
  };
}

// ── Breakdown by service ─────────────────────────────────────────────────────────────

/**
 * One row per service (Categories code), with what was quoted for it and what it has
 * cost, split by bucket. Lines with no category land in the UNASSIGNED row, so the rows
 * always add up to the project's totals. `quotedByService` is quotedValue().byService,
 * or null when the project has no quote — the quoted column is then null, not 0.
 */
export function serviceBreakdown(lines = [], quotedByService = null) {
  const rows = new Map();
  const row = code => {
    if (!rows.has(code)) rows.set(code, { quoted: 0, ...Object.fromEntries(BUCKETS.map(b => [b, 0])) });
    return rows.get(code);
  };
  for (const line of lines) {
    row(String(line.categoryCode || '').trim() || UNASSIGNED)[costBucket(line)] += toCents(line.amount);
  }
  for (const [code, amount] of Object.entries(quotedByService || {})) row(code).quoted += toCents(amount);

  const shape = (code, r) => {
    const total = BUCKETS.reduce((a, b) => a + r[b], 0);
    return {
      code,
      quoted:     quotedByService ? fromCents(r.quoted) : null,
      ...Object.fromEntries(BUCKETS.map(b => [b, fromCents(r[b])])),
      total:      fromCents(total),
      pctOfQuote: quotedByService && r.quoted > 0 ? total / r.quoted : null,
    };
  };

  const list = [...rows].map(([code, r]) => shape(code, r));
  // Biggest first by whichever is larger, quoted or spent; the unassigned bucket last —
  // it is a gap in the data, not a trade.
  const weight = r => Math.max(r.total, r.quoted ?? 0);
  list.sort((a, b) =>
    (a.code === UNASSIGNED) - (b.code === UNASSIGNED) || weight(b) - weight(a) || a.code.localeCompare(b.code));

  const sum = { quoted: 0, ...Object.fromEntries(BUCKETS.map(b => [b, 0])) };
  for (const r of rows.values()) for (const k of Object.keys(sum)) sum[k] += r[k];
  return { rows: list, totals: shape('', sum) };
}

// ── Profit, margin, flag ─────────────────────────────────────────────────────────────

export const FLAG_LABELS = {
  onTrack:     'On track',
  watch:       'Watch',
  overBudget:  'Over budget',
  healthy:     'Healthy',
  belowTarget: 'Below target',
  loss:        'Loss',
};

/**
 * The headline figures, per the build spec's formulas.
 *
 * A job is completed when its Projects status is `closed`, and only then is profit
 * measured against what was invoiced. An ongoing job's profit is against what was
 * quoted, so a job with no quote has no profit figure yet — null, which the screen
 * shows as "No quote", never as a 100% margin. `invoices` is null when Xero could not
 * be read; every figure that needs it is then null too, rather than computed as if
 * nothing had been invoiced.
 */
export function projectFigures({ cost = 0, quoted = null, invoices = null, status = '', settings = readSettings() }) {
  const completed = String(status).trim().toLowerCase() === 'closed';
  const costC     = toCents(cost);
  const quotedC   = quoted === null || quoted === undefined ? null : toCents(quoted);
  const invoicedC = invoices ? toCents(invoices.invoiced) : null;
  const collectedC = invoices ? toCents(invoices.collected) : null;

  let profitC = null;
  let base = null;
  if (completed) {
    if (invoicedC !== null) { profitC = invoicedC - costC; base = invoicedC; }
  } else if (quotedC !== null) {
    profitC = quotedC - costC;
    base = quotedC;
  }
  const margin = profitC !== null && base > 0 ? profitC / base : null;

  // Budget = quoted × (1 − target), kept in whole cents
  const budgetC = quotedC !== null ? Math.round(quotedC * (100 - settings.targetMarginPct) / 100) : null;
  const budgetUsed = budgetC !== null && budgetC > 0 ? costC / budgetC : null;

  const opt = c => (c === null ? null : fromCents(c));
  return {
    completed,
    cost:           fromCents(costC),
    quoted:         opt(quotedC),
    invoiced:       opt(invoicedC),
    collected:      opt(collectedC),
    outstanding:    invoices ? fromCents(toCents(invoices.outstanding)) : null,
    notYetInvoiced: quotedC !== null && invoicedC !== null ? fromCents(quotedC - invoicedC) : null,
    profit:         opt(profitC),
    margin,
    budget:         opt(budgetC),
    budgetUsed,
    flag:           statusFlag({ completed, margin, budgetUsed, settings }),
  };
}

/**
 * Ongoing: On track below the Watch level, Watch at or above it, Over budget above the
 * Over level. Completed: Healthy at or above the target margin, Below target from 0% up
 * to it, Loss below 0%. Null when the figure it rests on does not exist yet.
 */
export function statusFlag({ completed, margin, budgetUsed, settings = readSettings() }) {
  if (completed) {
    if (margin === null || margin === undefined) return null;
    if (margin < 0) return 'loss';
    return margin * 100 >= settings.targetMarginPct ? 'healthy' : 'belowTarget';
  }
  if (budgetUsed === null || budgetUsed === undefined) return null;
  if (budgetUsed * 100 > settings.overLevelPct) return 'overBudget';
  return budgetUsed * 100 >= settings.watchLevelPct ? 'watch' : 'onTrack';
}

// ── Xero invoices ────────────────────────────────────────────────────────────────────

const daysBetween = (fromIso, toIso) => {
  const d = iso => { const [y, m, dd] = iso.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((d(toIso) - d(fromIso)) / 86400000);
};

/**
 * Invoiced, collected and outstanding over a project's sales documents, with each
 * invoice's age and chase state as of `today` (YYYY-MM-DD, Singapore).
 *
 * `docs` are normalised Xero documents: `{ kind: 'invoice' | 'credit', total, due, date }`,
 * where `due` is an invoice's AmountDue or a credit note's RemainingCredit. A credit note
 * reduces what was invoiced; Xero already nets an applied one out of the invoice's
 * AmountDue, so outstanding is what is still due less any credit not yet applied, and
 * collected is the remainder.
 */
export function summariseInvoices(docs = [], today, settings = readSettings()) {
  let invoiced = 0;
  let outstanding = 0;
  const items = docs.map(doc => {
    // A draft is listed so it can be found and downloaded, but it is not an invoice yet:
    // it never counts towards invoiced, collected or outstanding.
    if (!isDraft(doc)) {
      const total = toCents(doc.total);
      const due   = toCents(doc.due);
      const sign  = doc.kind === 'credit' ? -1 : 1;
      invoiced    += sign * total;
      outstanding += sign * due;
    }
    const paid = doc.kind === 'credit' ? null : fromCents(toCents(doc.total) - toCents(doc.due));
    return { ...doc, paid, ...invoiceAge(doc, today, settings) };
  });
  return {
    invoiced:    fromCents(invoiced),
    collected:   fromCents(invoiced - outstanding),
    outstanding: fromCents(outstanding),
    items: items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number))),
  };
}

/**
 * Paid, or Unpaid / Chase / Overdue by age. Age counts from the invoice date, and only
 * an unpaid invoice has one; Chase and Overdue begin strictly after their thresholds.
 */
export function invoiceAge(doc, today, settings = readSettings()) {
  if (isDraft(doc)) return { state: 'draft', ageDays: null };
  if (doc.kind === 'credit') return { state: 'credit', ageDays: null };
  if (toCents(doc.due) <= 0) return { state: 'paid', ageDays: null };
  if (!today || !doc.date) return { state: 'unpaid', ageDays: null };
  const ageDays = daysBetween(doc.date, today);
  const state = ageDays > settings.overdueAfterDays ? 'overdue'
    : ageDays > settings.chaseAfterDays ? 'chase'
    : 'unpaid';
  return { state, ageDays };
}

/** A Xero draft (or one submitted for approval): listed on the project, never counted in any total. */
export const isDraft = doc => ['DRAFT', 'SUBMITTED'].includes(String(doc?.status || '').toUpperCase());

const normAddress = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// "#09-04", "# 11-576", "#B1-30"
const UNIT = /#\s*([a-z]?\d+)\s*-\s*(\d+)/i;
// "S520297", "Singapore 331002"
const POSTCODE = /\b(?:s|singapore)\s*\(?\d{6}\)?/gi;

/**
 * Block, street and unit — "297|TAMPINES|11-576" — for matching an address typed two
 * ways. All three are needed: a unit like #09-04 recurs across buildings, and block 88
 * with unit #03-11 exists on more than one street. The street is only its first word,
 * which survives "Rd" against "Road". Null when any part is missing.
 */
function blockUnitKey(address) {
  const text = String(address || '');
  const unit = text.match(UNIT);
  if (!unit) return null;
  const rest = text.replace(UNIT, ' ').replace(POSTCODE, ' ');
  const block = rest.match(/\b(\d+[a-z]?)\s+([a-z]+)/i);
  if (!block) return null;
  return `${block[1].toUpperCase()}|${block[2].toUpperCase()}|${unit[1].toUpperCase()}-${unit[2]}`;
}

/**
 * Which project each Xero document belongs to. Three sources, strongest first:
 *
 *   1. A manual link (`Xero links` tab), made on the Invoices screen. Wins outright.
 *   2. This app's own billing record: a payment stage or VO that stored the invoice's
 *      `xero_invoice_id`. Exact, and never ambiguous, even when two projects share an
 *      address (one billed to the ID firm, one to the owner).
 *   3. The Reference. Xero has no project field; this app bills with Reference =
 *      display_address, and the invoices raised by hand before it mostly did the same.
 *      So: an exact match on the address (ignoring case and spacing) first; failing that,
 *      the block and unit number, which survives "Blk 297 Tampines St 22 S520297, #11-576"
 *      against "297 Tampines St 22 #11-576". The match must point at exactly one project.
 *      Anything pointing at several is ambiguous, for a person to link, never guessed — a
 *      wrong guess silently moves revenue between jobs.
 *
 * `links`:  [{ xeroId, projectCode }]
 * `billed`: [{ xeroId, projectCode, stage }]   stage = the payment stage or "VO n"
 *
 * Returns a Map of document (the object itself) → { codes, how, stage }.
 */
export function assignDocuments(docs = [], projects = [], { links = [], billed = [] } = {}) {
  const exact = new Map();
  const loose = new Map();
  const add = (map, key, c) => { if (!key) return; map.set(key, [...(map.get(key) || []), c]); };
  for (const p of projects) {
    add(exact, normAddress(p.address), p.code);
    add(loose, blockUnitKey(p.address), p.code);
  }
  const linkOf   = new Map(links.filter(l => l.xeroId && l.projectCode).map(l => [l.xeroId, l]));
  const billedOf = new Map(billed.filter(b => b.xeroId && b.projectCode).map(b => [b.xeroId, b]));

  const out = new Map();
  for (const doc of docs) {
    const billedRow = billedOf.get(doc.id);
    const stage = billedRow?.stage || '';
    const link = linkOf.get(doc.id);
    if (link) { out.set(doc, { codes: [link.projectCode], how: 'linked', stage }); continue; }
    if (billedRow) { out.set(doc, { codes: [billedRow.projectCode], how: 'billed', stage }); continue; }
    let codes = exact.get(normAddress(doc.reference)) || [];
    let how = 'exact';
    if (!codes.length) {
      codes = loose.get(blockUnitKey(doc.reference)) || [];
      how = 'unit';
    }
    out.set(doc, { codes, how: codes.length ? how : 'none', stage: '' });
  }
  return out;
}

/**
 * This project's matched documents, and any ambiguous ones naming it. See
 * assignDocuments() for the order of evidence. Matched documents carry `matchedBy` and,
 * when this app billed them, `stage`.
 */
export function invoicesForProject(docs = [], projects = [], code, options = {}) {
  const assigned = assignDocuments(docs, projects, options);
  const matched = [];
  const ambiguous = [];
  for (const doc of docs) {
    const { codes, how, stage } = assigned.get(doc);
    if (!codes.includes(code)) continue;
    if (codes.length === 1) matched.push({ ...doc, matchedBy: how, ...(stage ? { stage } : {}) });
    else ambiguous.push({ ...doc, candidates: codes });
  }
  return { matched: labelStages(matched), ambiguous };
}

/**
 * Documents no project claims: no link, no billing record, and a Reference that fits
 * nothing or more than one project. These are what the Invoices screen offers to link.
 */
export function unassignedDocuments(docs = [], projects = [], options = {}) {
  const assigned = assignDocuments(docs, projects, options);
  return docs
    .filter(doc => assigned.get(doc).codes.length !== 1)
    .map(doc => ({ ...doc, candidates: assigned.get(doc).codes }));
}

/**
 * A stage for every invoice. Invoices this app billed keep the stage they were billed
 * for. The rest — older, raised by hand in Xero — are numbered by date among the
 * project's non-draft invoices ("Payment 1", "Payment 2"…), marked `stageAuto` so the
 * screen can show it is a guess. Credit notes and drafts carry no stage of their own.
 */
export function labelStages(docs = []) {
  const numbered = docs
    .filter(d => d.kind !== 'credit' && !isDraft(d))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.number).localeCompare(String(b.number)));
  const position = new Map(numbered.map((d, i) => [d, i + 1]));
  return docs.map(d => {
    if (d.stage) return { ...d, stageAuto: false };
    if (!position.has(d)) return { ...d, stage: '', stageAuto: false };
    return { ...d, stage: `Payment ${position.get(d)}`, stageAuto: true };
  });
}

// ── Possible duplicates ──────────────────────────────────────────────────────────────

/**
 * Lines that may be the same spend recorded in both ledgers: a receipted expense and a
 * project cost on this project for the same amount. Display only — nothing is excluded
 * from any total, because an equal amount is often a genuine second purchase. Returns
 * id → ids of the matching lines in the other ledger.
 */
export function possibleDuplicates(lines = []) {
  const byAmount = { true: new Map(), false: new Map() };
  for (const line of lines) {
    const c = toCents(line.amount);
    if (!c) continue;
    const side = byAmount[!!line.receipted];
    side.set(c, [...(side.get(c) || []), line.id]);
  }
  const out = {};
  for (const line of lines) {
    const c = toCents(line.amount);
    if (!c) continue;
    const others = byAmount[!line.receipted].get(c);
    if (others?.length) out[line.id] = others;
  }
  return out;
}
