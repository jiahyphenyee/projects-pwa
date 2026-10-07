// The quote editor's row operations, as pure functions over an array of rows. Kept out of
// the component so every rule in the spec ("a new row copies the nearest service", "moving
// a title moves only the title", "the last row cannot be deleted") is unit-tested.
//
// A row is { key, id, kind: 'item' | 'title', description, service, qty, unit, unitPrice,
// suggestDone }. `suggestDone` is the description the suggestions were last picked or
// dismissed for; the panel stays shut until the description changes from it.
// `key` is a client-only identity for React and focus; `id` is the server's line_id, blank
// until the row has been saved. qty and unitPrice are kept as the strings typed.

let counter = 0;
export function newKey() {
  counter += 1;
  return `k${Date.now().toString(36)}${counter}`;
}

/** The service of the nearest item row: the closest above, else the closest below. */
export function nearestService(rows, index, fallback = '') {
  for (let i = index - 1; i >= 0; i--) if (rows[i].kind === 'item') return rows[i].service;
  for (let i = index; i < rows.length; i++) if (rows[i].kind === 'item') return rows[i].service;
  return fallback;
}

export function blankItem(service = '') {
  return { key: newKey(), id: '', kind: 'item', description: '', service, qty: '1', unit: '', unitPrice: '', suggestDone: '' };
}

export function blankTitle() {
  return { key: newKey(), id: '', kind: 'title', description: '', service: '', qty: '', unit: '', unitPrice: '' };
}

/** Insert a blank item at `index`. Returns { rows, key } so the caller can focus it. */
export function insertItem(rows, index, fallbackService = '') {
  const row = blankItem(nearestService(rows, index, fallbackService));
  const next = rows.slice();
  next.splice(index, 0, row);
  return { rows: next, key: row.key };
}

export function insertTitle(rows, index) {
  const row = blankTitle();
  const next = rows.slice();
  next.splice(index, 0, row);
  return { rows: next, key: row.key };
}

/** A copy of the row directly below it. The copy is a new line: it gets no server id. */
export function duplicateRow(rows, index) {
  const row = { ...rows[index], key: newKey(), id: '' };
  const next = rows.slice();
  next.splice(index + 1, 0, row);
  return { rows: next, key: row.key };
}

/** Move one row up (-1) or down (+1). A title moves alone; the rows under it stay put. */
export function moveRow(rows, index, dir) {
  const to = index + dir;
  if (to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  const [row] = next.splice(index, 1);
  next.splice(to, 0, row);
  return next;
}

/** Remove a row. The last remaining row cannot be removed. Deleting a title keeps its items. */
export function removeRow(rows, index) {
  if (rows.length <= 1) return rows;
  const next = rows.slice();
  next.splice(index, 1);
  return next;
}

export function updateRow(rows, key, change) {
  return rows.map(r => (r.key === key ? { ...r, ...change } : r));
}

/** Item rows numbered 1, 2, 3…; titles get no number. Returns Map key → number. */
export function lineNumbers(rows) {
  const out = new Map();
  let n = 0;
  for (const r of rows) if (r.kind === 'item') out.set(r.key, ++n);
  return out;
}

/** A price as shown once the field is left: always two decimals, "88" → "88.00". Blank stays blank. */
export function formatPrice(value) {
  const t = String(value ?? '').trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) ? n.toFixed(2) : t;
}

/** Accept a typed number with at most `dp` decimals; anything else keeps the old value. */
export function acceptDecimal(typed, previous, dp = 2) {
  const t = String(typed).replace(/,/g, '').trim();
  if (t === '') return '';
  return new RegExp(`^\\d*(\\.\\d{0,${dp}})?$`).test(t) ? t : previous;
}

const isBlankItem = r => r.kind === 'item' && !r.description.trim() && String(r.unitPrice).trim() === '';
const isBlankTitle = r => r.kind === 'title' && !r.description.trim();

/**
 * The rows as the save route expects them, or { error } naming the first problem.
 * Completely blank rows (an item with no description or price, a title with no text) are
 * dropped rather than saved: they are what Enter and "+ Below" leave behind.
 */
export function toSavePayload(rows) {
  const kept = rows.filter(r => !isBlankItem(r) && !isBlankTitle(r));
  if (!kept.some(r => r.kind === 'item')) return { error: 'Add at least one line with a description before saving' };

  const numbers = lineNumbers(kept);
  for (const r of kept) {
    if (r.kind === 'item' && !r.description.trim()) {
      return { error: `Line ${numbers.get(r.key)} has a price but no description` };
    }
  }
  return {
    lines: kept.map(r => ({
      id:          r.id || undefined,
      kind:        r.kind,
      description: r.description.trim(),
      service:     r.kind === 'item' ? r.service : '',
      qty:         r.kind === 'item' ? (String(r.qty).trim() === '' ? 1 : Number(r.qty)) : null,
      unit:        r.kind === 'item' ? r.unit : '',
      unitPrice:   r.kind === 'item' ? (String(r.unitPrice).trim() === '' ? null : Number(r.unitPrice)) : null,
    })),
    dropped: rows.length - kept.length,
  };
}

/** Server lines → editor rows. */
export function fromServerLines(lines) {
  return lines.map(l => ({
    key:         newKey(),
    id:          l.id,
    kind:        l.kind,
    description: l.description || '',
    service:     l.service || '',
    qty:         l.qty === null || l.qty === undefined ? '' : String(l.qty),
    unit:        l.unit || '',
    unitPrice:   l.unitPrice === null || l.unitPrice === undefined ? '' : formatPrice(l.unitPrice),
    // A saved line does not pop suggestions open on load; editing its description does
    suggestDone: l.description || '',
  }));
}

/** A fingerprint of everything a save would send, for the unsaved-changes check. */
export function snapshot(rows, extra) {
  return JSON.stringify({
    rows: rows.map(r => [r.id, r.kind, r.description, r.service, r.qty, r.unit, r.unitPrice]),
    extra,
  });
}
