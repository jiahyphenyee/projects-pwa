// Phase 2: pair each client in the Contacts tab with its Xero contact, and store the Xero
// ContactID in the Contacts tab's xero_contact_id column (appended as column H).
//
//   node scripts/link-xero-contacts.mjs                      # propose pairings, write nothing
//   node scripts/link-xero-contacts.mjs --apply CON-002=<ContactID>,CON-003=<ContactID>
//
// Names rarely match exactly ("Urban Makers Construction" vs "Urban Maker Construction Pte
// Ltd"), so nothing is written on a guess: the script lists its best candidates and a person
// confirms each pair by passing it to --apply. A filled cell is never overwritten unless
// --force is given. Read-only against Xero.

import { readTab, updateCells, ensureHeader, columnLetter, tabName, xero, q } from './_shared.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const applyArg = args[args.indexOf('--apply') + 1];
const apply = args.includes('--apply') && applyArg
  ? Object.fromEntries(applyArg.split(',').map(pair => pair.split('=').map(s => s.trim())))
  : null;

const contactsTab = await tabName('CONTACTS', 'Contacts');
const col = await ensureHeader(contactsTab, 'xero_contact_id');
const letter = columnLetter(col);

const sheetContacts = (await readTab(contactsTab, `A:${letter}`, /^CON-/)).map(({ row, rowNumber }) => ({
  id: row[0], name: String(row[1] ?? '').trim(), types: String(row[5] ?? ''), xeroId: String(row[col] ?? '').trim(), rowNumber,
}));

const api = xero();
const xeroContacts = [];
// Not summaryOnly: that drops IsCustomer / IsSupplier, which tell a client apart from a
// supplier of the same name.
for await (const page of api.pages('/Contacts', 'Contacts', { includeArchived: 'false' })) {
  for (const c of page) xeroContacts.push({ id: c.ContactID, name: c.Name, isCustomer: !!c.IsCustomer, isSupplier: !!c.IsSupplier });
}
console.log(`${sheetContacts.length} contacts in the sheet, ${xeroContacts.length} in Xero\n`);

// ── Apply confirmed pairs ───────────────────────────────────────────────────────────────

if (apply) {
  const updates = [];
  for (const [conId, xeroId] of Object.entries(apply)) {
    const sc = sheetContacts.find(c => c.id === conId);
    const xc = xeroContacts.find(c => c.id === xeroId);
    if (!sc) { console.log(`skip ${conId}: not in the Contacts tab`); continue; }
    if (!xc) { console.log(`skip ${conId}: ${xeroId} is not a Xero ContactID in this organisation`); continue; }
    if (sc.xeroId && sc.xeroId !== xeroId && !FORCE) { console.log(`skip ${conId}: already linked to ${sc.xeroId} (use --force to replace)`); continue; }
    updates.push({ range: `${q(contactsTab)}!${letter}${sc.rowNumber}`, values: [[xeroId]] });
    console.log(`link ${conId} "${sc.name}" → "${xc.name}" (${xeroId})`);
  }
  await updateCells(updates, 'RAW');
  console.log(`\n${updates.length} written`);
  process.exit(0);
}

// ── Propose ─────────────────────────────────────────────────────────────────────────────

const STOP = new Set(['pte', 'ltd', 'llp', 'limited', 'private', 'the', 'and', 'company', 'co']);
function tokens(name) {
  return new Set(
    name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
      .filter(t => t && !STOP.has(t))
      .map(t => t.replace(/s$/, ''))   // makers / maker
  );
}
function score(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

for (const sc of sheetContacts) {
  const ranked = xeroContacts
    .map(xc => ({ xc, s: score(sc.name, xc.name) }))
    .filter(r => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  const status = sc.xeroId ? `linked → ${xeroContacts.find(c => c.id === sc.xeroId)?.name || sc.xeroId}` : 'not linked';
  console.log(`${sc.id}  ${sc.name}  [${sc.types}]  ${status}`);
  if (!ranked.length) { console.log('     no candidate in Xero'); continue; }
  for (const { xc, s } of ranked) {
    const kind = xc.isCustomer ? 'customer' : xc.isSupplier ? 'supplier' : 'no invoices yet';
    const label = sameName(sc.name, xc.name) ? 'same name' : `${Math.round(s * 100)}% words`;
    console.log(`     ${label.padEnd(10)} ${xc.name}  (${kind})  ${xc.id}`);
  }
}
console.log('\nTo write a pairing: node scripts/link-xero-contacts.mjs --apply CON-001=<ContactID>,CON-002=<ContactID>');
