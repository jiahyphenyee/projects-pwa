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

### 0.1.0 — 2026-08-08

[Added]
- Google Sheets access layer (`lib/sheets.js`): config-driven tab names via `getTab()`, note-row-safe reads, `safe()` formula-injection guard, `nextId()` max+1 ID generation.
- PIN login against `PWA_USER_*` in the workbook's `System config` tab.
- Persistent session in `localStorage` with a 7-day expiry; role carried for future gating.
- `AppShell` auth gate and header, shared by all signed-in screens.
- PWA manifest, generated teal icons, iOS standalone and safe-area support.
- Design tokens in `lib/theme.js`.
- `Project costs` tab created in the workbook; `TAB_PROJECT_COSTS` added to `System config`; workbook timezone corrected to Asia/Singapore.
