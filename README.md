# Projects PWA

Mobile-first PWA for tracking construction projects and their non-receipted costs (external labour, transport, materials without a receipt), backed by a Google Sheets workbook.

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

See [CHANGELOG.md](CHANGELOG.md).
