import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestService, insertItem, insertTitle, duplicateRow, moveRow, removeRow,
  lineNumbers, acceptDecimal, formatPrice, toSavePayload, fromServerLines,
} from '../lib/quoteEditor.mjs';

const item = (key, service = 'ELEC', extra = {}) => ({ key, id: '', kind: 'item', description: key, service, qty: '1', unit: '', unitPrice: '10', ...extra });
const title = key => ({ key, id: '', kind: 'title', description: key, service: '', qty: '', unit: '', unitPrice: '' });
const keys = rows => rows.map(r => r.key);

test('a new row copies the service of the nearest item row, above first', () => {
  const rows = [item('a', 'PLMB'), title('t'), item('b', 'ELEC')];
  assert.equal(nearestService(rows, 2), 'PLMB');   // inserting at index 2: nearest above is a
  assert.equal(nearestService(rows, 0), 'PLMB');   // at the top: nearest below
  assert.equal(nearestService([title('t')], 1, 'GENL'), 'GENL');
});

test('insert above and below land at the right index and return the new key', () => {
  const rows = [item('a'), item('b')];
  const above = insertItem(rows, 1);
  assert.equal(above.rows[1].key, above.key);
  assert.equal(above.rows[1].description, '');
  assert.deepEqual([above.rows[0].key, above.rows[2].key], ['a', 'b']);
  const below = insertItem(rows, 2);
  assert.equal(below.rows[2].key, below.key);
});

test('+ Title inserts a title row above the row', () => {
  const { rows, key } = insertTitle([item('a'), item('b')], 1);
  assert.equal(rows[1].kind, 'title');
  assert.equal(rows[1].key, key);
});

test('duplicate makes a new unsaved line directly below', () => {
  const rows = [item('a', 'ELEC', { id: 'Q-0001-L1' })];
  const d = duplicateRow(rows, 0);
  assert.equal(d.rows.length, 2);
  assert.equal(d.rows[1].id, '');
  assert.equal(d.rows[1].description, 'a');
});

test('moving a title moves only the title', () => {
  const rows = [title('t1'), item('a'), item('b'), title('t2'), item('c')];
  assert.deepEqual(keys(moveRow(rows, 3, -1)), ['t1', 'a', 't2', 'b', 'c']);
  assert.deepEqual(keys(moveRow(rows, 0, -1)), keys(rows));   // already at the top
});

test('deleting a title keeps its items; the last row cannot be deleted', () => {
  assert.deepEqual(keys(removeRow([title('t'), item('a')], 0)), ['a']);
  assert.deepEqual(keys(removeRow([item('a')], 0)), ['a']);
});

test('line numbers count item rows only', () => {
  const n = lineNumbers([title('t'), item('a'), title('u'), item('b')]);
  assert.equal(n.get('a'), 1);
  assert.equal(n.get('b'), 2);
  assert.equal(n.has('t'), false);
});

test('prices accept at most 2 decimals', () => {
  assert.equal(acceptDecimal('12.34', '12.3'), '12.34');
  assert.equal(acceptDecimal('12.345', '12.34'), '12.34');
  assert.equal(acceptDecimal('1,200', ''), '1200');
  assert.equal(acceptDecimal('abc', '5'), '5');
  assert.equal(acceptDecimal('', '5'), '');
  assert.equal(acceptDecimal('.5', ''), '.5');
});

test('a minus is accepted only where negatives are allowed (variation order lines)', () => {
  assert.equal(acceptDecimal('-5', '', 2), '');
  assert.equal(acceptDecimal('-5', '', 2, { negative: true }), '-5');
  assert.equal(acceptDecimal('-', '', 2, { negative: true }), '-');
  assert.equal(acceptDecimal('-12.345', '-12.34', 2, { negative: true }), '-12.34');
  assert.equal(acceptDecimal('--5', '', 2, { negative: true }), '');
});

test('save payload drops blank rows and keeps ids', () => {
  const rows = [
    title('Living'), item('a', 'ELEC', { id: 'Q-0001-L2', qty: '4', unitPrice: '88' }),
    { ...item('blank'), description: '', unitPrice: '' }, { ...title('x'), description: '  ' },
  ];
  const p = toSavePayload(rows);
  assert.equal(p.dropped, 2);
  assert.equal(p.lines.length, 2);
  assert.deepEqual(p.lines[1], { id: 'Q-0001-L2', kind: 'item', description: 'a', service: 'ELEC', qty: 4, unit: '', unitPrice: 88 });
  assert.equal(p.lines[0].id, undefined);
});

test('save payload refuses a priced line with no description, and an empty quote', () => {
  assert.match(toSavePayload([item('a'), { ...item('b'), description: '' }]).error, /Line 2/);
  assert.match(toSavePayload([title('t')]).error, /at least one line/);
});

test('blank qty saves as 1; blank price saves as null', () => {
  const p = toSavePayload([item('a', 'ELEC', { qty: '', unitPrice: '' })]);
  assert.equal(p.lines[0].qty, 1);
  assert.equal(p.lines[0].unitPrice, null);
});

test('prices show two decimals once entered', () => {
  assert.equal(formatPrice('88'), '88.00');
  assert.equal(formatPrice('9.5'), '9.50');
  assert.equal(formatPrice('.5'), '0.50');
  assert.equal(formatPrice('12.34'), '12.34');
  assert.equal(formatPrice(''), '');
});

test('server lines round-trip into editor rows', () => {
  const rows = fromServerLines([{ id: 'Q-1-L1', kind: 'item', description: 'x', service: 'ELEC', qty: 2, unit: 'pcs', unitPrice: 9.5 }]);
  assert.equal(rows[0].qty, '2');
  assert.equal(rows[0].unitPrice, '9.50');
  assert.ok(rows[0].key);
});
