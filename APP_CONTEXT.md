# App context

## Data flow

A Google Sheets workbook (id in `GOOGLE_SHEET_ID`) is the single source of truth; this app holds no database. Route handlers under `app/api/` authenticate with a Google service account and read/write tabs through `lib/sheets.js`, which resolves every tab name from the workbook's `System config` tab rather than hardcoding it. Client pages are `'use client'`, fetch those routes, and cache reads in `localStorage` for instant search and offline reads.

## Directory map

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router pages. One folder per screen. |
| `app/api/` | Route handlers — the only place that touches Google Sheets. |
| `app/components/` | Shared UI. `AppShell` is the auth gate + header for every signed-in screen. |
| `lib/google.js` | Service-account auth and a memoised Sheets client. |
| `lib/sheets.js` | Generic Sheets layer: `getTab`, `readTab`, `appendRow`, `writeAfterLast`, `updateRange`, `findRowById`, `safe`, `nextId`. Not project-aware. |
| `lib/constants.js` | Shared constants. Never tab names — those come from `getTab()`. |
| `lib/useProjects.js` | Stale-while-revalidate project cache + prebuilt search index. The single source of project data on the client. |
| `lib/projects.js` | Server-side project creation (works around the protected column C). |
| `lib/costs.js` | Server-side cost CRUD against the `Project costs` tab. |
| `lib/expenses.js` | READ-ONLY view of the receipted `Expenses` tab. Never writes. |
| `lib/rollups.js` | All cost aggregation, and the `GEN-000` exclusion rule. |
| `lib/dates.js` | ISO/serial date conversion and Singapore timestamps. Vercel runs UTC, so timezone is explicit. |
| `lib/recents.js` | Per-user recently-opened projects, and the `RECENTS_CHANGED` event screens listen to. |
| `lib/session.js` | `localStorage` session with expiry. |
| `lib/theme.js` | Design tokens for inline styles. |
| `public/` | Manifest, icons, service worker. |

## Rules to maintain

**Spreadsheet access**

- **Never `.slice(1)` a sheet range.** This workbook has free-text `ℹ` note rows *inside* data ranges — `Projects` row 2, `Expenses` row 4. Filter by ID prefix instead (`/^PRJ-/`, `/^EXP-/`, `/^PC-/`). Use `readTab()`, which enforces this.
- **Never hardcode a tab name.** Use `getTab('PROJECT_COSTS')`. Tab names live in `System config` as `TAB_*` keys and may be renamed without code changes.
- **Always quote tab names in A1 ranges.** `'Project costs'!A:O` is valid; `Project costs!A:O` is a 400. Use `range()`.
- **Every string written to Sheets goes through `safe()`.** A leading `= + - @ |` is otherwise parsed as a formula.
- **`Projects` column C (`client_id`) is a protected, self-populating column.** It auto-fills `=IFERROR(INDEX(Contacts!A:A, MATCH(D<row>, Contacts!B:B, 0)), "")`, deriving the ID *from* `client_name` in column D — the reverse of what `SYSTEM_REFERENCE.md` claims. Never write to it: it is both unnecessary and blocked by a protected range named "autofilled". Write `A:B` and `D:K` around it.
- **Never `appendRow()` into a tab with a checkbox column.** A checkbox reports `FALSE` in every formatted row even when empty, so the API's table detection thinks the table is 1000 rows long and writes below it — outside the date/currency formatting, where dates land as text. Narrowing the search range does not help; detection looks at whole rows. Use `writeAfterLast()` on `Project costs`, and verify the readback since its row choice is not atomic.
- **Read numerically whenever values are sorted or summed** — `readTab(..., { raw: true })`. Formatted reads give display strings, and `"10 Aug 2026"` sorts before `"9 Aug 2026"`. Cost dates are normalised to ISO via `sheetDateToIso()` and formatted for display with `formatIsoDate()`.
- **Never use `insertDataOption: 'INSERT_ROWS'` on `Projects`.** Inserting a row is a structural change affecting every column, so it fails against the protected column C even when writing only A:B. `appendRow()` uses the default OVERWRITE, which writes into existing blank rows.
- **Rows in `Projects` cannot be deleted via the API** for the same reason. Clear `A:B` and `D:K` instead, leaving C's formula.
- **IDs are max+1 over existing IDs** (`nextId()`), never a row count. Codes are non-contiguous.
- **Dates are written as ISO `YYYY-MM-DD` with `USER_ENTERED`.** The workbook locale is `en_US`, so ambiguous formats parse wrongly. Timestamps are written as ISO 8601 *with offset* so Sheets leaves them as text.
- **Never delete rows in tabs this app does not own** (`Projects`, `Expenses`, `Contacts`, `Categories`). Hard delete is permitted only in `Project costs`, and only via `deleteCost()` / `deleteRowById()`, which re-verify the row's ID immediately before deleting because the API deletes by index and indexes shift.
- **Editing a cost rewrites `E:J` only.** `project_code`, `display_address`, the invoiced state (`K:L`), `invoice_ref` and `created_by` are deliberately untouched, so correcting an amount can never silently un-bill a line or reassign authorship.
- **Deleted cost IDs are reused.** `nextId()` is max+1 over surviving rows, so deleting the newest cost frees its ID for the next insert. Fine within the sheet; be careful if a cost ID is ever quoted outside it.

**Business rules**

- **This app makes no Xero API calls.** The `Expenses` tab is read-only to it. Receipted expenses reach Xero through the sibling `expense-pwa`.
- **Per-project receipted spend can only come from the `Expenses` tab, never from Xero.** Xero carries no project dimension — its only tracking category is `Service` (trade), and the live bill references do not contain a `PRJ-` code. `project_code` exists as a real column in Sheets only.
- **Rejected expenses are excluded from project totals** (the company is not carrying that cost); pending ones are included, since the money was spent and only the review is outstanding.
- **`GEN-000` is excluded from every cross-project rollup.** It is the general company expense bucket and is browsable like any project, but counting it in aggregates inflates project costs with overheads. Apply the exclusion in `lib/rollups.js` only.
- **A project with no client is a direct company job**, not incomplete data. Never treat a blank `client_name`/`client_id` as an error or prompt to fix it; in client-based rollups these belong to the company itself, not to an "unknown client" bucket.
- **`display_address` is immutable** once a project has linked rows — it is stored denormalised across timesheets, expenses and invoices.

**Code**

- JavaScript, not TypeScript. App Router. `@/` alias. Inline styles from `lib/theme.js` — no CSS framework.
- **List rows go through `app/components/LineRow.js`**, and tags through `Tag.js`. Both lists sit on one screen, so writing bespoke row markup lets typography drift. Change spacing or sizing there, once.
- **Never size text with a raw number.** Use `font.size.*` from `lib/theme.js`.
- **Hover styling belongs in `globals.css` under `@media (hover: hover)`**, never inline and never unguarded — on touch, `:hover` sticks after a tap and leaves a control looking permanently hovered.
- Next.js 16: `params` is a Promise (`await params`, or `use(params)` in client components). Route handlers are uncached by default.
- Read `AGENTS.md` before writing framework code — the installed Next version may differ from training data.
