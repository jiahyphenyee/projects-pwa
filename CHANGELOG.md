# Changelog

Every user-visible change to the Projects PWA, newest first.

**One line per entry.** Say what changed, plus the why only when it is not obvious.
Mechanism, reasoning and code belong in the commit; workbook and Xero facts belong in
`docs/SYSTEM_REFERENCE.md`. Add bullets under **Unreleased** in the matching
`[Added]` / `[Changed]` / `[Fixed]` / `[Removed]` block; on release, retitle it with the
version and date and open a fresh one above.

## Unreleased

[Changed]
- Cost type `labour` renamed to `external_labour` ("External Labour"), so it names subcontracted labour only.
- The blank client option on the new-project form now reads "No client (under HFC)" — it means company-direct work, not missing data.

[Fixed]
- Date fields no longer overflow their card on iOS.

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
