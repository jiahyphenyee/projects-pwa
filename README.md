# Projects PWA

Mobile-first PWA for tracking construction projects and their non-receipted costs (labour, transport, materials without a receipt), backed by a Google Sheets workbook.

## Quick start

```bash
npm install                 # install
npm run dev                 # run — http://localhost:3000
npm run build               # production build (also the type/lint gate)
npm start                   # production server — needed to test the service worker
```

Requires `.env.local` with `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`.
No test suite yet — verification is manual against the spreadsheet.

## Changelog

### 0.9.0 — 2026-08-14

[Changed]
- App icon replaced with the "PRJ" wordmark artwork, regenerated at 192, 512 and 180 (apple-touch).
- App renamed to "HFC Projects" across `manifest.json` (`name`, `short_name`) and the `metadata` block in `app/layout.js`.

[Fixed]
- `apple-touch-icon.png` is now flattened onto the cyan field. iOS ignores alpha and composites onto black, so the transparent rounded corners rendered as black corners.
- Added a dedicated `icon-maskable-512.png` instead of reusing the `any` icon for `purpose: "maskable"`. The wordmark spans 12.7%–87.5% of the width, so Android's inner-80% crop was clipping the P and the J; the maskable variant is full-bleed cyan with the wordmark scaled to 94% to sit inside the safe circle.
- Bumped `CACHE_VERSION` to `v2` so installed clients pick up the new icons rather than serving the precached old ones.

[Removed]
- `public/android-chrome-512x512.png` — the source upload, redundant with `icon-512.png` and referenced by nothing.

### 0.8.0 — 2026-08-09

[Added]
- `docs/DEPLOY.md` — environment variables, the private-key gotcha, and post-deploy checks.
- `docs/SYSTEM_REFERENCE.md` — v3.0 of the operations reference, corrected against the live workbook and covering both PWAs.

### 0.7.0 — 2026-08-09

[Added]
- Service worker (`public/sw.js`): cache-first for build assets, network-first with cached fallback for pages and API reads. Registered in production only.
- Offline reads — a project you have opened before still renders its last-known costs with no signal, with a banner stating how old the data is.
- Offline banner in the header, and installability to the home screen.

### 0.6.0 — 2026-08-09

[Added]
- Cost row labels underline on hover (pointer devices only) to show they open the editor.
- Tap a cost's description to edit its date, type, category, amount and description (`PUT /api/costs`).
- Delete a cost from the edit form, with a confirm step (`DELETE /api/costs?id=`).

### 0.5.0 — 2026-08-09

[Added]
- Shared `LineRow` component so cost rows and receipted rows use identical typography and spacing.
- "Mark N as invoiced" bulk action per project, applied as one batched write and skipping rows already invoiced.
- Invoiced toggle is a labelled checkbox with a 44px tap target, replacing an 11px pill that was too small to hit and did not read as interactive.
- Colour-coded tags on every row: cost type (material/labour/transport), invoiced state, and a Receipted marker on expense rows. Shared `Tag` component in `app/components/Tag.js`.
- Totals card per project: non-receipted costs split into invoiced / not invoiced, receipted subtotal, and a combined project total.
- Invoiced toggle on each cost line (`PATCH /api/costs`), stamping `invoiced_date` on tick and clearing it on untick. Optimistic, reverting if the write fails.
- Collapsible read-only "Receipted" section reading the `Expenses` tab. Rejected claims excluded; pending ones included.
- `lib/rollups.js` — all aggregation in one place, including the `GEN-000` cross-project exclusion.

### 0.4.0 — 2026-08-09

[Added]
- Cost form preselects Material (`DEFAULT_COST_TYPE`), the most common entry.
- `Project costs` tab wired up: `GET/POST /api/costs`, cost entry form, and a per-project cost list newest-first.
- Costs carry both a type (material/labour/transport) and a category from the Categories tab; both required.
- Validation on write: known cost type, live category, positive amount under $1,000,000, real calendar date.

[Fixed]
- Cost rows landed at row 1001+ instead of after the data, because the invoiced checkbox column makes every row look occupied to the Sheets append API. Replaced with `writeAfterLast()`.
- Cost dates sorted as display text, so `10 Aug` ordered before `9 Aug`. Costs are now read numerically and normalised to ISO.

### 0.3.0 — 2026-08-09

[Added]
- `POST /api/projects` creating a project: address mirrored into `project_name`, optional client validated against Contacts, start date defaulting to today, status `active`.
- `GET /api/reference` returning client contacts and active categories in one call.
- New project form at `/projects/new`, with duplicate-address detection offering "open existing" or "create anyway".

[Fixed]
- Writes now work around the `Projects` tab's protected column C: `appendRow` no longer inserts rows, and column C is left to auto-fill itself.

### 0.2.1 — 2026-08-08

[Changed]
- Search now runs against a precomputed index (`buildSearchIndex`) instead of normalising every field on every keystroke — ~14x faster, and flat as the list grows.
- PIN entry now uses a real focusable input instead of a custom on-screen keypad, so a physical keyboard works and mobile raises the numeric keypad on tap.
- The header name opens a menu (showing role and days left on the session) rather than logging out on a single tap.
- Project search ignores punctuation and spacing — `0990` finds `#09-90`.

### 0.2.0 — 2026-08-08

[Added]
- `GET /api/projects` returning the whole project list in one read.
- Home screen: recently-opened projects (falling back to the newest 5 when there's no history), instant search across address, client and code, and links to the full list and project creation.
- Full project list at `/projects` with client-side paging, 50 per page.
- Project detail at `/projects/[code]` showing address, client, status and dates.
- Stale-while-revalidate project cache in `localStorage` (`lib/useProjects.js`) — screens render instantly from cache and refresh in the background, and survive a failed fetch.
- Per-user recents in `localStorage` (`lib/recents.js`), with a change event so the home screen updates even when the router keeps it mounted.

### 0.1.0 — 2026-08-08

[Added]
- Google Sheets access layer (`lib/sheets.js`): config-driven tab names via `getTab()`, note-row-safe reads, `safe()` formula-injection guard, `nextId()` max+1 ID generation.
- PIN login against `PWA_USER_*` in the workbook's `System config` tab.
- Persistent session in `localStorage` with a 7-day expiry; role carried for future gating.
- `AppShell` auth gate and header, shared by all signed-in screens.
- PWA manifest, generated teal icons, iOS standalone and safe-area support.
- Design tokens in `lib/theme.js`.
- `Project costs` tab created in the workbook; `TAB_PROJECT_COSTS` added to `System config`; workbook timezone corrected to Asia/Singapore.
