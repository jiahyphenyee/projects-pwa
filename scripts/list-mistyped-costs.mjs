// Read-only. Lists Project costs whose cost_type disagrees with their own description, so
// they can be corrected by hand in the app's edit form before the cost split is trusted.
//
//   node scripts/list-mistyped-costs.mjs
//
// Two patterns, both found in the Xero import: labour rows that are really a material
// ("painter tape" filed as labour (external)), and material rows that are really labour.
// Lines mixing both ("painting labour + paint") are listed separately and left alone —
// they cannot be split honestly, so they keep their current type.

import { readTab, tabName } from './_shared.mjs';

const MATERIAL_WORDS = /\b(tape|material|paint(?!ing)|tile|cement|pipe|wire|hardware|sealant|board|turpentine)\b/i;
const LABOUR_WORDS = /\b(labou?r|workmanship|subcon|man ?days?|full day|half day)\b/i;

const tab = await tabName('PROJECT_COSTS', 'Project costs');
const rows = await readTab(tab, 'A:I', /^PC-/, { raw: true });

const show = ({ row }) => `  ${row[0]}  ${row[2]}  ${String(row[5]).padEnd(17)}  ${String(Number(row[8]).toFixed(2)).padStart(9)}  ${row[7]}`;

const labourButMaterial = rows.filter(({ row }) =>
  /^labour/.test(row[5] || '') && MATERIAL_WORDS.test(row[7] || '') && !LABOUR_WORDS.test(row[7] || ''));
const materialButLabour = rows.filter(({ row }) =>
  row[5] === 'material' && LABOUR_WORDS.test(row[7] || '') && !MATERIAL_WORDS.test(row[7] || ''));
const mixed = rows.filter(({ row }) => LABOUR_WORDS.test(row[7] || '') && MATERIAL_WORDS.test(row[7] || ''));

console.log(`Typed as labour, described as material only (${labourButMaterial.length}) — likely should be "material":`);
labourButMaterial.forEach(r => console.log(show(r)));
console.log(`\nTyped as material, described as labour only (${materialButLabour.length}) — likely "labour (external)" or "labour (internal)":`);
materialButLabour.forEach(r => console.log(show(r)));
console.log(`\nMixed labour and material in one line (${mixed.length}) — left as they are:`);
mixed.forEach(r => console.log(show(r)));
