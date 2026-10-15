// Adds the project-screen thresholds to System config, so William can change them in the
// workbook without a deploy. Idempotent: a key already present is left as it is.
//
//   node scripts/setup-dashboard-config.mjs --dry-run   # show what would be added
//   node scripts/setup-dashboard-config.mjs
//
// The app reads each key with the same default when it is absent (lib/projectFigures.mjs),
// so running this changes no figure — it only makes the numbers visible and editable.

import { sheets, spreadsheetId, q, configMap } from './_shared.mjs';
import { DASHBOARD_SETTINGS } from '../lib/projectFigures.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIG_TAB = 'System config';

const have = await configMap();
const missing = Object.values(DASHBOARD_SETTINGS)
  .filter(({ key }) => !(key in have))
  .map(({ key, fallback }) => [key, String(fallback)]);

if (!missing.length) {
  console.log('All dashboard keys are already in System config.');
} else {
  missing.forEach(([k, v]) => console.log(`${DRY_RUN ? 'would add' : 'add'} ${k} = ${v}`));
  if (!DRY_RUN) {
    await sheets().spreadsheets.values.append({
      spreadsheetId, range: `${q(CONFIG_TAB)}!A:B`, valueInputOption: 'RAW', requestBody: { values: missing },
    });
  }
}
