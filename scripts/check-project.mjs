// Read-only. The project screen's figures for one project, recomputed straight from the
// raw Sheet and Xero — deliberately NOT through lib/projectFigures.mjs, so it is a second
// opinion on the page rather than the same code agreeing with itself. For the acceptance
// check: compare its output with the page and with a sum done by hand.
//
//   node scripts/check-project.mjs PRJ-090

import { readTab, tabName, xero } from './_shared.mjs';

const code = process.argv[2];
if (!code) { console.error('Usage: node scripts/check-project.mjs PRJ-xxx'); process.exit(1); }

const cents = v => Math.round(Number(v || 0) * 100);
const $ = c => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-SG', { minimumFractionDigits: 2 })}`;

const [projectsTab, costsTab, expensesTab] = await Promise.all([
  tabName('PROJECTS', 'Projects'), tabName('PROJECT_COSTS', 'Project costs'), tabName('EXPENSES', 'Receipted expenses'),
]);
const project = (await readTab(projectsTab, 'A:M', /^(PRJ-|GEN-)/)).find(({ row }) => row[0] === code)?.row;
if (!project) { console.error(`No project ${code}`); process.exit(1); }
const address = project[1];
console.log(`${code}  ${address}  status=${project[7] || '(blank)'}\n`);

// ── Costs ──
const bucketOfType = { 'material': 'materials', 'labour (external)': 'subcon', 'labour (internal)': 'ownLabour', 'transport': 'transport' };
const buckets = { materials: 0, subcon: 0, ownLabour: 0, transport: 0 };
const services = {};
let receipted = 0, nonReceipted = 0;

const pc = (await readTab(costsTab, 'A:I', /^PC-/, { raw: true })).filter(({ row }) => row[2] === code);
for (const { row } of pc) {
  const c = cents(row[8]);
  buckets[bucketOfType[row[5]] || 'materials'] += c;
  services[row[6] || '(none)'] = (services[row[6] || '(none)'] || 0) + c;
  nonReceipted += c;
}
const ex = (await readTab(expensesTab, 'A:T', /^EXP-/, { raw: true }))
  .filter(({ row }) => row[2] === code && String(row[12] || '').toLowerCase() !== 'rejected');
for (const { row } of ex) {
  const c = cents(row[6]);
  const bucket = bucketOfType[row[19]] || (['TRANS', 'VEHIC'].includes(row[4]) ? 'transport' : 'materials');
  buckets[bucket] += c;
  services[row[4] || '(none)'] = (services[row[4] || '(none)'] || 0) + c;
  receipted += c;
}
const cost = receipted + nonReceipted;
console.log(`Costs: ${pc.length} project cost rows + ${ex.length} receipted (rejected excluded)`);
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(10)} ${$(v)}`);
console.log(`  ${'TOTAL'.padEnd(10)} ${$(cost)}   (receipted ${$(receipted)}, non-receipted ${$(nonReceipted)})`);
console.log('  by service:', Object.entries(services).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${$(v)}`).join(', '));

// ── Xero ──
// Exact Reference only, plus anything sharing the unit number listed for a human to judge.
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const unit = (String(address).match(/#\s*[A-Z]?\d+\s*-\s*\d+/i) || [''])[0].replace(/\s/g, '').toLowerCase();
const docs = [];
for await (const page of xero().pages('/Invoices', 'Invoices', { where: 'Type=="ACCREC"', Statuses: 'AUTHORISED,PAID' })) docs.push(...page.map(i => ({ ...i, kind: 'invoice' })));
try {
  for await (const page of xero().pages('/CreditNotes', 'CreditNotes', { where: 'Type=="ACCRECCREDIT"', Statuses: 'AUTHORISED,PAID' })) docs.push(...page.map(c => ({ ...c, kind: 'credit' })));
} catch (err) { console.log(`\n(credit notes unreadable: ${err.status})`); }

const exact = docs.filter(d => norm(d.Reference) === norm(address));
const nearby = docs.filter(d => !exact.includes(d) && unit && String(d.Reference || '').replace(/\s/g, '').toLowerCase().includes(unit));

let invoiced = 0, outstanding = 0;
console.log(`\nXero, Reference exactly "${address}":`);
for (const d of exact) {
  const sign = d.kind === 'credit' ? -1 : 1;
  invoiced += sign * cents(d.Total);
  outstanding += sign * cents(d.kind === 'credit' ? d.RemainingCredit : d.AmountDue);
  console.log(`  ${d.kind === 'credit' ? d.CreditNoteNumber : d.InvoiceNumber}  ${String(d.DateString || '').slice(0, 10)}  ${d.Status.padEnd(10)} total ${$(cents(d.Total))}  due ${$(cents(d.kind === 'credit' ? d.RemainingCredit : d.AmountDue))}`);
}
console.log(`  invoiced ${$(invoiced)}  collected ${$(invoiced - outstanding)}  outstanding ${$(outstanding)}`);
if (nearby.length) {
  console.log(`\nSame unit number, different Reference (check by eye — the page counts these only if block and street also match):`);
  nearby.forEach(d => console.log(`  ${d.InvoiceNumber || d.CreditNoteNumber}  "${d.Reference}"  ${$(cents(d.Total))}`));
}

console.log(`\nProfit if completed (invoiced − cost): ${$(invoiced - cost)}   margin ${invoiced ? ((invoiced - cost) / invoiced * 100).toFixed(1) + '%' : '—'}`);
