# Quote and billing: acceptance checks before go-live

Status on 2026-10-07, branch `quote-billing/integration` plus Phase 7. Each check says how
it was verified. "Live" means against the real workbook and the real Xero organisation,
using the test project `PRJ-208` and the test contact "TEST – Heng Fa internal".

## The spec's acceptance checks

| # | Check | Result | How it was checked |
|---|---|---|---|
| 1 | A row can be inserted above or below any row without dragging, and the cursor lands in the new row | Pass | Unit tests (`quoteEditor.test.mjs`); JY in the UI, Phase 3 |
| 2 | A quote with no titles, no units and no discount shows none of those controls in use and saves cleanly | Pass, partly | Save payload and PDF render covered by unit tests; not yet saved through the screen on a real project |
| 3 | A title row shows the subtotal of the rows under it and is not numbered | Pass | Unit tests; JY in the UI |
| 4 | Typing "13a socket" on an HDB quote suggests past socket items and fills the last HDB price only | Pass in tests; not yet on real data | Unit tests (`priceMemory.test.mjs`). The live history has no HDB-typed rows yet: imported rows never fill a price, so this is first visible after William saves real quotes |
| 5 | On a property type with no past quote for the item, the price stays blank and other types' prices are shown | Pass | Unit tests; live suggestions on imported items |
| 6 | Picking an item priced per sqft or ft run switches the unit box on | Pass | Unit tests |
| 7 | Totals never show GST | Pass | No GST anywhere in the code; screen and PDF both say "No GST"; invoices are `NoTax` |
| 8 | "Bill now" on a stage creates exactly one approved invoice in Xero with one line and the correct amount, and the stage shows "Billed" | Pass | Live: `INV-261007-01`, $495.33, approved, one line; checked by William, then voided |
| 9 | Pressing "Bill now" twice, or retrying after an error, never creates two invoices for one stage | Built; not provoked live | Billed stages refused on the server; number stored before the call and looked up on retry; Xero Idempotency-Key; per-stage queue. A dropped connection mid-call has not been simulated against Xero |
| 10 | The billed stage amounts plus the final payment always equal the contract sum to the cent | Pass | Unit tests incl. 33.33% × 3 on $999.99; every live schedule |
| 11 | A VO invoice in Xero matches the VO lines, including title rows as description-only lines | Pass in dry run; not yet live | Dry-run payload for VO1 ($755.33) checked line by line; lines-equal-total check before sending |
| 12 | Two invoices on the same date get -01 and -02, and a number already used in Xero for that date is skipped | Pass | Unit tests; live preview gave `-02` after the voided `-01` |
| 13 | Each invoice appears on the statement of account of the project's client, and no new contact is created | Pass | Live: William checked the test contact's statement; Xero still has one TEST contact. The token cannot create contacts at all (read-only contacts scope) |

## Phase 7 checks

| Check | Result | How it was checked |
|---|---|---|
| The PDF matches the quote on screen line for line and total for total | Pass | `Q-0001` and VO `Q-0002` rendered and compared with the screen |
| A quote with no titles, units or discount produces a clean PDF | Pass | Unit test renders one, 90 lines over 3+ pages |
| The PDF is attached to the first stage invoice in Xero, once | Built; not yet live | Attaches after the first stage is billed; recorded in `Payment stages.pdf_attached_at`; skipped if any stage of the quote has it; retry button with PIN if it fails. Needs one live billing to confirm |
| William runs one real project from quote to billed deposit | Not done | Go-live step |
| Expense, timesheet and service report features still work as before | Pass, see below | `npm run build` passes; shared files only gained code (list below). No service report feature exists in this repo |

## What this work changed outside its own files

**Shared code in this repo** (every removed line was replaced by a superset of it):
- `lib/sheets.js`: added `appendRows`, `deleteRowsByNumbers`, four tab fallbacks. Nothing changed.
- `lib/projects.js`: `property_type` (column M) added to the column map, and `updateProjectPropertyType`. The header check now covers A1:M1.
- `app/components/AppShell.js`: optional `wide` prop; every other screen is unchanged at 720px.
- `app/projects/[code]/page.js`: the Quote and billing card, admins only, hidden on GEN-000.
- `app/globals.css`: `.qe-btn` hover and disabled styles.
- `next.config.mjs`: `outputFileTracingIncludes` for `assets/` on the PDF routes.
- `package.json`: `npm test`, and `pdf-lib` 1.17.1.

**The workbook:**
- Deleted the unused `Invoices`, `Payments`, `Payment allocations` and `Reports` tabs and the `TAB_INVOICES`, `TAB_PAYMENTS`, `TAB_ALLOCATIONS`, `TAB_REPORTS`, `GST_RATE` and `INVOICE_PREFIX` keys. No app read them.
- New tabs `Quotes`, `Quote lines`, `Payment stages`, `Price history` and their `TAB_*` keys.
- Appended, never inserted: `Projects.M property_type`, `Categories.E xero_tracking_option`, `Contacts.H xero_contact_id`. Both apps read these tabs by index, and every existing index is unchanged.
- New System config keys: `XERO_PROJECTS_*` tokens, `XERO_SALES_ACCOUNT_CODE`, `INVOICE_DUE_DAYS`, `QUOTE_UNITS`, `QUOTE_PROPERTY_TYPES`, `STAGE_TRACKING_OPTION`, `COMPANY_ADDRESS`, `COMPANY_PHONE`, `COMPANY_EMAIL`, `QUOTE_TERMS`.

**`expense-pwa`:** branch `categories-xero-option` reads the Xero tracking option from `Categories.E` instead of its hard-coded map. Not merged or deployed yet.

## Before go-live

1. Fill in System config: `COMPANY_UEN` (still "[UEN Number]"), `COMPANY_ADDRESS`, `COMPANY_PHONE`, `COMPANY_EMAIL`, `QUOTE_TERMS`.
2. Put the logo at `assets/quote-logo.png` (optional).
3. Add `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_TENANT_ID` and `XERO_DRY_RUN` to Vercel (see `docs/DEPLOY.md`).
4. One live run on the test project: bill a VO and a first stage, check both in Xero (lines, the PDF attachment), void both, reset the rows.
5. Merge and deploy `expense-pwa` `categories-xero-option`.
6. Merge `quote-billing/integration` into `main` and deploy with `XERO_DRY_RUN=true`; switch it to `false` in Vercel when William is ready.
7. Separately: the installed Next.js 16.3.0 has a critical security advisory; upgrade it on its own branch.
