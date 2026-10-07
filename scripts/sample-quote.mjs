// Phase 1 round-trip check: save a sample quote through the API, save it again, load it
// back, and compare. Needs the dev server running, because lib/ uses the `@/` alias and
// Next's module handling that plain Node cannot resolve:
//
//   PORT=3100 npm run dev
//   node scripts/sample-quote.mjs http://localhost:3100 PRJ-042
//
// The quote it writes is REAL and stays on that project (there is no delete yet), so point
// it at a test project. If the project has no property type, one is set as part of the
// save, as the editor will do in Phase 3.

const [base, projectCode] = process.argv.slice(2);
if (!base || !projectCode) {
  console.error('usage: node scripts/sample-quote.mjs <base-url> <project-code>');
  process.exit(1);
}

const sample = {
  projectCode,
  kind: 'quote',
  propertyType: 'HDB',
  user: 'sample-quote script',
  showUnit: true,
  discountMode: '%',
  discountValue: 5,
  lines: [
    { kind: 'title', description: 'Living room' },
    { kind: 'item',  description: 'Supply & install 13A double socket outlet', service: 'ELEC', qty: 4, unit: 'pcs',  unitPrice: 88 },
    { kind: 'item',  description: 'Supply & install LED downlight',            service: 'ELEC', qty: 6, unit: 'pcs',  unitPrice: 45 },
    { kind: 'title', description: 'Kitchen' },
    { kind: 'item',  description: 'Hack existing floor tiles & dispose',       service: 'HACK', qty: 91, unit: 'sqft', unitPrice: 4.5 },
    { kind: 'item',  description: 'Supply & lay 600x600 homogeneous tiles',    service: 'TILE', qty: 91, unit: 'sqft', unitPrice: 9.5 },
  ],
  stages: [
    { name: 'Deposit',            sharePct: 30 },
    { name: 'Progress payment 1', sharePct: 20 },
    { name: 'Progress payment 2', sharePct: 20 },
    { name: 'Final payment (balance)', isFinal: true },
  ],
};

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

const money = n => '$' + Number(n).toFixed(2);
function show(label, { quote, lines, schedule }) {
  console.log(`\n== ${label}: ${quote.id} v${quote.currentVersion}  subtotal ${money(quote.subtotal)}  contract ${money(quote.contractSum)}  (${quote.propertyType})`);
  for (const l of lines) {
    console.log(l.kind === 'title'
      ? `   ${l.id}  ${l.description.toUpperCase()}`
      : `   ${l.id}  ${l.description}  ${l.qty} ${l.unit} × ${money(l.unitPrice)} = ${money(l.amount)}`);
  }
  for (const s of schedule.stages) console.log(`   stage ${s.id || '(new)'}  ${s.name}  ${s.sharePct ?? ''}%  ${money(s.amount)}`);
}

// First save creates it; second save with the loaded lines (now carrying IDs) and one
// price changed must keep the IDs, bump the version and leave one set of history rows.
const first = await call('POST', '/api/quotes', sample);
show('first save', first);

const edited = {
  ...sample,
  id: first.quote.id,
  lines: first.lines.map(l => (l.description.startsWith('Supply & install LED') ? { ...l, unitPrice: 48 } : l)),
  stages: first.schedule.stages,
};
const second = await call('POST', '/api/quotes', edited);
show('second save', second);

const loaded = await call('GET', `/api/quotes?id=${first.quote.id}`);
show('loaded back', loaded);

const problems = [];
if (loaded.quote.currentVersion !== 2) problems.push(`expected version 2, got ${loaded.quote.currentVersion}`);
if (loaded.lines.length !== sample.lines.length) problems.push(`expected ${sample.lines.length} lines, got ${loaded.lines.length}`);
loaded.lines.forEach((l, i) => {
  if (l.id !== first.lines[i].id) problems.push(`line ${i + 1} changed id ${first.lines[i].id} → ${l.id}`);
  if (l.description !== sample.lines[i].description) problems.push(`line ${i + 1} description differs`);
});
const expectedSubtotal = 352 + 288 + 409.5 + 864.5;      // 4×88, 6×48, 91×4.5, 91×9.5
if (loaded.quote.subtotal !== expectedSubtotal) problems.push(`subtotal ${loaded.quote.subtotal}, expected ${expectedSubtotal}`);
if (loaded.quote.contractSum !== Math.round(expectedSubtotal * 95) / 100) problems.push(`contract sum ${loaded.quote.contractSum} is not subtotal less 5%`);
const stageSum = loaded.schedule.stages.reduce((a, s) => a + Math.round(s.amount * 100), 0) / 100;
if (stageSum !== loaded.quote.contractSum) problems.push(`stages add to ${stageSum}, contract sum is ${loaded.quote.contractSum}`);
if (loaded.schedule.stages.length !== 4) problems.push(`expected 4 stages, got ${loaded.schedule.stages.length}`);
for (const w of [...first.warnings, ...second.warnings]) problems.push(`warning: ${w}`);

if (problems.length) {
  console.log('\nMISMATCH');
  problems.forEach(p => console.log('  - ' + p));
  process.exit(1);
}
console.log('\nOK — second save kept the line IDs, bumped the version, and the figures match.');
