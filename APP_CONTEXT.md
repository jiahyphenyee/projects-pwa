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
| `lib/sheets.js` | Generic Sheets layer: `getTab`, `readTab`, `appendRow`, `updateRange`, `findRowById`, `safe`, `nextId`. Not project-aware. |
| `lib/constants.js` | Shared constants. Never tab names — those come from `getTab()`. |
| `lib/useProjects.js` | Stale-while-revalidate project cache + `searchProjects()`. The single source of project data on the client. |
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
- **`Projects` column C (`client_id`) is a formula** deriving the ID from `client_name` in column D — the reverse of what `SYSTEM_REFERENCE.md` claims. Never plain-append to `Projects`; write an explicit row range and re-inject the formula with the correct row number.
- **IDs are max+1 over existing IDs** (`nextId()`), never a row count. Codes are non-contiguous.
- **Dates are written as ISO `YYYY-MM-DD` with `USER_ENTERED`.** The workbook locale is `en_US`, so ambiguous formats parse wrongly. Timestamps are written as ISO 8601 *with offset* so Sheets leaves them as text.
- **Never delete rows in tabs this app does not own** (`Projects`, `Expenses`, `Contacts`, `Categories`). Hard delete is permitted only in `Project costs`, and only via `deleteCost()`.

**Business rules**

- **This app makes no Xero API calls.** The `Expenses` tab is read-only to it. Receipted expenses reach Xero through the sibling `expense-pwa`.
- **`GEN-000` is excluded from every cross-project rollup.** It is the general company expense bucket and is browsable like any project, but counting it in aggregates inflates project costs with overheads. Apply the exclusion in `lib/rollups.js` only.
- **`display_address` is immutable** once a project has linked rows — it is stored denormalised across timesheets, expenses and invoices.

**Code**

- JavaScript, not TypeScript. App Router. `@/` alias. Inline styles from `lib/theme.js` — no CSS framework.
- Next.js 16: `params` is a Promise (`await params`, or `use(params)` in client components). Route handlers are uncached by default.
- Read `AGENTS.md` before writing framework code — the installed Next version may differ from training data.
