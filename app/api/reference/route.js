// Dropdown sources, fetched in one call: client contacts and active categories.

import { getTab, readTab } from '@/lib/sheets';

// Contacts tab: A contact_id, B company_name, C contact_person, F contact_types
const CONTACT_ID = /^CON-/;
// Categories tab has no ID column — column A is the code itself
const CATEGORY_CODE = /^[A-Z]{3,6}$/;

export async function GET() {
  try {
    const [contactsTab, categoriesTab] = await Promise.all([
      getTab('CONTACTS'),
      getTab('CATEGORIES'),
    ]);

    const [contactRows, categoryRows] = await Promise.all([
      readTab(contactsTab, 'A:G', CONTACT_ID),
      readTab(categoriesTab, 'A:C', CATEGORY_CODE),
    ]);

    // Projects.client_id is a formula matching client_name against Contacts.company_name,
    // so the dropdown must offer company_name values verbatim or the lookup breaks.
    const clients = contactRows
      .filter(({ row }) => String(row[5] || '').toLowerCase().includes('client'))
      .map(({ row }) => ({
        id:            row[0] || '',
        companyName:   row[1] || '',
        contactPerson: row[2] || '',
      }))
      .filter(c => c.companyName)
      .sort((a, b) => a.companyName.localeCompare(b.companyName));

    // Column C is headed active_codes and holds the string "TRUE"
    const categories = categoryRows
      .filter(({ row }) => String(row[2] || '').toUpperCase() === 'TRUE')
      .map(({ row }) => ({ code: row[0], name: row[1] || row[0] }));

    return Response.json({ clients, categories });

  } catch (err) {
    console.error('Reference read error:', err.message);
    return Response.json({ error: 'Could not load dropdowns' }, { status: 500 });
  }
}
