# Changelog

Every user-visible change to the Projects PWA, newest first.

**One line per entry.** Say what changed, plus the why only when it is not obvious.
Mechanism, reasoning and code belong in the commit; workbook and Xero facts belong in
`docs/SYSTEM_REFERENCE.md`. Add bullets under **Unreleased** in the matching
`[Added]` / `[Changed]` / `[Fixed]` / `[Fixed]
- Line amounts are exact: 91.5 × $6.55 is $599.33, as Xero rounds it, not the $599.32 floating point gave.

[Removed]` block; on release, retitle it with the
version and date and open a fresh one above.

## Unreleased

[Added]
- Client answer (Sent / Accepted / Declined, with dates) at the top of the quote and each VO screen, and a read-only "Quotes in Xero" panel with PDFs on the project dashboard; no stage or VO can be billed until the client has accepted, including VOs settled on the final invoice (quotes already billed, and VOs written before 28 Oct 2026, carry on).
- Xero invoices on the project screen show each invoice's payment stage, a PDF download, and drafts (greyed, never counted); a new Invoices screen links invoices matching cannot place, stored in the new `Xero links` tab (`scripts/setup-xero-links-tab.mjs`).
- Project screen splits cost to date into materials, subcon, own labour and transport, with receipted against non-receipted underneath.
- Admins see quoted, profit, margin, budget used, invoiced and outstanding on the project screen, with an On track / Watch / Over budget (or Healthy / Below target / Loss once closed) flag.
- Xero invoices on the project screen, matched to the project by Reference, with collected, outstanding and Paid / Chase / Overdue by age.
- "By service" table on the project screen: quoted against materials, subcon, transport and total cost per category, adding up to the project totals.
- A cost with the same amount in the other ledger is marked "possible duplicate" on its row; no total changes.
- Margin and ageing thresholds in System config (`TARGET_MARGIN_PCT`, `WATCH_LEVEL_PCT`, `OVER_LEVEL_PCT`, `CHASE_AFTER_DAYS`, `OVERDUE_AFTER_DAYS`), added by `scripts/setup-dashboard-config.mjs`.
- `scripts/check-project.mjs` recomputes a project's figures from the raw Sheet and Xero for hand checks; `scripts/list-mistyped-costs.mjs` lists costs whose type contradicts their description.
- Receipted expenses can now be marked invoiced, so client-charged spend is tracked in one place instead of only for costs entered here.
- Filter a project's costs by category (several at once) and by invoiced state, with the number of rows and their total shown against the selection.
- Optional lock code on a project, set when creating it and editable from the project screen.
- The project screen now says when a project is on hold or closed.
- `scripts/xero-auth.mjs` authorises this app's own Xero connection, kept separate from the expense app's so neither can invalidate the other's tokens.
- Quote data layer: `Quotes`, `Quote lines`, `Payment stages` and `Price history` tabs, `lib/quotes.js` save/load with versioned saves, `lib/quoteMaths.mjs` for every money figure, and `/api/quotes`. No screen yet.
- `npm test` runs the calculation tests with Node's built-in runner.
- Xero client (`lib/xeroClient.mjs`, `lib/xero.js`) on this app's own tokens, read-only until Phase 5.
- `scripts/import-price-history.mjs` filled `Price history` with the line items of every past Xero sales invoice (1,019 rows), re-runnable without duplicates.
- Quote validity on the PDF ("Valid until", from `QUOTE_VALIDITY_DAYS`), and a note on the quote screen naming whatever the PDF is still missing (logo, T&Cs, validity, UEN, address).
- Quote PDF (logo, company details and T&Cs from System config, lines, totals, "No GST", payment schedule) with a Download button, attached once to the first stage invoice in Xero.
- Variation orders: "+ Variation order" opens the same editor blank (numbered VO1, VO2… on first save); Bill now sends one approved invoice with every line, titles as text lines, units in the description, each line's Service, and the discount as a negative line, after checking the lines add up.
- The project screen lists every payment stage and variation order with its amount and billed state.
- Payment schedule on the quote screen (stages as shares, final payment as the balance, add and remove, over-100% warning) and **Bill now**: a confirm step with invoice number, Xero client, amount and line, PIN re-entry, then one approved invoice in Xero. Dry run by default.
- Price memory in the quote editor: past items suggested as you type (3+ characters, every word must match, up to 4), filling the last price for the project's property type only; a price check line under any row that matches a past item exactly.
- Quote saves take about four round trips instead of fifteen; old line versions are tidied after the response.
- Quote screen at `/projects/<code>/quote`, opened from a project (admins only): insert-anywhere lines, section titles with subtotals, optional units and discount, totals with "No GST", property type per project, save to Sheets and price history. Unit prices show two decimals once entered. Descriptions are a box that grows with the text; Shift + Enter adds a line break.
- `scripts/link-xero-contacts.mjs` proposes Xero contact pairings and writes confirmed ones to the new `Contacts.xero_contact_id` column (H).
- `property_type` on `Projects` (column M) and `xero_tracking_option` on `Categories` (column E), so both apps can read one Xero mapping.
- Quote versions: a Version field on the quote screen that only counts up (+) sets the version printed on the PDF; stored in the new `Quotes.issue_version` column (W).
- `office` role: costs in both ledgers, quotes, VOs and billing, and a project **Billing** view (quote and Xero invoices), but no Summary.
- A variation order can omit work: negative quantities or prices on VO lines only, with a title and a reason (extra work / omitted / changed / goodwill) shown in the VO list; new `Quotes` columns `vo_reason`, `vo_title`, `settled_on_stage_id` (X–Z), appended by `scripts/setup-quote-billing-tabs.mjs`.
- The Summary's Quoted tile shows quote + additions − omissions, and "not yet invoiced" uses the adjusted sum.

[Removed]
- The unused `Invoices`, `Payments`, `Payment allocations` and `Reports` tabs and their config keys, replaced by the quote tabs. Nothing read them.

[Changed]
- Variation orders now settle on the final payment invoice by default, one "Add:" or "Less:" line each after the balance line; an addition can still be billed early with "Bill now" and then stays off the final, an omission cannot be billed on its own, and a new omission is refused once the final invoice is issued.
- A project now has two views: a wide **Summary** dashboard for admins (headline tiles, cost split, by-service table, billing and Xero invoices side by side, latest costs) and the phone-first **Costs** list; everyone else lands on Costs.
- "Total project cost" is now "Cost to date" in the project summary, and receipted expenses are typed by the expense app's new `cost_type` column (T).
- A project shows one cost list — receipted expenses sit alongside the rest, newest first, rather than in a separate collapsed section. They still cannot be edited here.
- "Non-receipted costs" is now "Not from expense app": some migrated costs do have a Xero receipt, just not one this system tracks.
- Cost rows carry one tag, the category code — the same code on both kinds, so a trade no longer reads as "Electrical" on one row and "ELEC" on the next.
- Where a cost came from, and who was paid, are now plain text beside the date rather than tags.
- Cost rows lead with their label: it and the amount are now 15px semibold against a 12px supporting line, where the two were a single pixel apart and nothing led.
- Cost rows have Amount and Invoiced column headers, and more room between them.
- The amount sits in its own column, level with the tick box, instead of riding high on the label's baseline.
- The invoiced control is a single tick box beside the row rather than a 118px labelled control under it — the words were a second block of text competing with the label, and on a phone took a third of the row.
- Tags on a row no longer carry an outline; only a pressable one does, so an outline now means "you can tap this".
- The category dropdown on the cost form shows a chevron again — stripping the native control to fix its size on iOS had taken the arrow with it.
- Cost form field order is now description, amount, date, category, cost type — what you type first, then what is merely confirmed.
- Cost rows no longer show the Material / Labour / Transport tag; the type is still recorded on every cost.
- The totals card shows the project total alone — the split by source, and the invoiced breakdown, were competing with the one figure the screen exists for.
- Cost types now match the workbook's own dropdown: Material, Internal Labour, External Labour, Transport.
- The blank client option on the new-project form now reads "No client (under HFC)" — it means company-direct work, not missing data.
- Quote PDF letterhead: logo in the top right corner, the heading and its facts at the top left, no company address and no property type; a quote shows its version (v1, v2…) instead of the Q-number, and a VO only its VO number.
- PDF files are named `HFCQuote_v<n>_<address>.pdf` and `HFCVO<n>_<address>.pdf` (prefix from `QUOTE_FILE_PREFIX`).
- The quote PDF says "This quotation is valid for N days." above the T&Cs instead of printing a "Valid until" date.
- Only `admin`, `boss_man` and `office` PINs can sign in; any other role is refused at login, and billing re-checks the PIN's role on the server.

[Fixed]
- The project dashboard no longer runs into the Google Sheets read quota: the Xero client keeps its access token in memory instead of re-reading System config on every Xero call.
- Project costs were read one column out: amounts appeared as the row's label, every total read 0.00, and invoiced costs showed as unbilled.
- Adding, editing and ticking a cost work again — every write to `Project costs` was landing past the last column and being rejected.
- A failure on the project screen no longer blames the network when the server was reachable.
- An amount that cannot be read shows as "—" instead of 0.00, which looked like a real figure.
- Ticking a cost invoiced no longer refetches the whole project — one tap, one request.
- Failures on the project screen now look like failures, instead of borrowing the amber used for notices.

[Removed]
- `project_name` — a project is identified by its address alone, which is what every other tab already joins on.

[Added]
- Sheet tabs are checked against the columns the app expects, so a column added or removed in the workbook fails loudly instead of quietly shifting every figure after it.
- Date fields no longer overflow their card on iOS.
- Form fields in a card now share one height — the date field no longer sits a few pixels off from the ones beside it.

## 0.9.0 — 2026-08-14

[Changed]
- App icon replaced with the "PRJ" wordmark, regenerated at 192, 512 and 180.
- App renamed to "HFC Projects".

[Fixed]
- `apple-touch-icon.png` flattened onto the cyan field — iOS ignores alpha and was rendering black corners.
- Separate `icon-maskable-512.png` added; Android's inner-80% crop was clipping the wordmark.
- `CACHE_VERSION` bumped to `v2` so installed clients pick up the new icons.

[Removed]
- `public/android-chrome-512x512.png` — unused, redundant with `icon-512.png`.

## 0.8.0 — 2026-08-09

[Added]
- `docs/DEPLOY.md` — environment variables, the private-key gotcha, and post-deploy checks.
- `docs/SYSTEM_REFERENCE.md` — v3.0 of the operations reference, covering both PWAs.

## 0.7.0 — 2026-08-09

[Added]
- Service worker (`public/sw.js`), production only: cache-first for build assets, network-first for pages and API reads.
- Offline reads — a project opened before renders its last-known costs, with a banner stating their age.
- Offline banner in the header, and installability to the home screen.

## 0.6.0 — 2026-08-09

[Added]
- Tap a cost's description to edit its date, type, category, amount and description (`PUT /api/costs`).
- Delete a cost from the edit form, with a confirm step (`DELETE /api/costs?id=`).
- Cost row labels underline on hover to show they open the editor.

## 0.5.0 — 2026-08-09

[Added]
- Totals card per project: non-receipted split into invoiced / not invoiced, receipted subtotal, grand total.
- Invoiced toggle on each cost line (`PATCH /api/costs`), stamping `invoiced_date` on tick and clearing it on untick.
- "Mark N as invoiced" bulk action per project, skipping rows already invoiced.
- Invoiced toggle is a labelled checkbox with a 44px tap target, replacing an 11px pill too small to hit.
- Collapsible read-only "Receipted" section from the `Expenses` tab; rejected claims excluded, pending included.
- Colour-coded tags on every row: cost type, invoiced state, and a Receipted marker.
- Shared `LineRow` component so cost and receipted rows match.
- `lib/rollups.js` — all aggregation in one place, including the `GEN-000` exclusion.

## 0.4.0 — 2026-08-09

[Added]
- `Project costs` wired up: `GET/POST /api/costs`, cost entry form, per-project list newest-first.
- Costs carry both a type and a category; both required.
- Validation on write: known cost type, live category, positive amount under $1,000,000, real calendar date.
- Cost form preselects Material (`DEFAULT_COST_TYPE`), the most common entry.

[Fixed]
- Cost rows landed at row 1001+; the invoiced checkbox makes every row look occupied to the Sheets append API. Now `writeAfterLast()`.
- Cost dates sorted as display text, so `10 Aug` ordered before `9 Aug`. Now read numerically and normalised to ISO.

## 0.3.0 — 2026-08-09

[Added]
- `POST /api/projects` creating a project, with the address mirrored into `project_name` and the client validated against Contacts.
- New project form at `/projects/new`, offering "open existing" or "create anyway" on a duplicate address.
- `GET /api/reference` returning client contacts and active categories in one call.

[Fixed]
- Writes now work around the `Projects` tab's protected column C, which is left to auto-fill itself.

## 0.2.1 — 2026-08-08

[Changed]
- Search runs against a precomputed index (`buildSearchIndex`) — ~14x faster, and flat as the list grows.
- Search ignores punctuation and spacing — `0990` finds `#09-90`.
- PIN entry uses a real input instead of an on-screen keypad, so physical and numeric keyboards both work.
- The header name opens a menu instead of logging out on a single tap.

## 0.2.0 — 2026-08-08

[Added]
- Home screen: recent projects, instant search across address, client and code, and links onward.
- Full project list at `/projects`, 50 per page, client-side.
- Project detail at `/projects/[code]` showing address, client, status and dates.
- `GET /api/projects` returning the whole list in one read.
- Stale-while-revalidate project cache in `localStorage` (`lib/useProjects.js`), surviving a failed fetch.
- Per-user recents in `localStorage` (`lib/recents.js`).

## 0.1.0 — 2026-08-08

[Added]
- Google Sheets access layer (`lib/sheets.js`): config-driven tab names, note-row-safe reads, formula-injection guard, max+1 IDs.
- PIN login against `PWA_USER_*`, with a 7-day `localStorage` session carrying the role.
- `AppShell` auth gate and header, shared by all signed-in screens.
- PWA manifest, generated teal icons, iOS standalone and safe-area support.
- Design tokens in `lib/theme.js`.
- `Project costs` tab created in the workbook; `TAB_PROJECT_COSTS` added to `System config`; workbook timezone corrected to Asia/Singapore.
