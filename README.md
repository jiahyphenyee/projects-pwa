# Projects PWA

Mobile-first PWA for tracking construction projects and their non-receipted costs (labour, transport, materials without a receipt), backed by a Google Sheets workbook.

## Quick start

```bash
npm install                 # install
npm run dev                 # run — http://localhost:3000
npm run build               # production build (also the type/lint gate)
```

Requires `.env.local` with `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`.
No test suite yet — verification is manual against the spreadsheet.

## Changelog

### 0.2.1 — 2026-08-08

[Changed]
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
