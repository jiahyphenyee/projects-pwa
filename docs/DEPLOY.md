# Deploying

## Environment variables

Set these three in Vercel (Project → Settings → Environment Variables), for
Production, Preview and Development. Copy the values from `.env.local`, which is
gitignored and never leaves this machine.

| Key | Notes |
|---|---|
| `GOOGLE_CLIENT_EMAIL` | Service account address, ends `.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Full PEM **including** the BEGIN/END lines |
| `GOOGLE_SHEET_ID` | The workbook id from its URL |

**The private key is the one that usually breaks**, because the two environments parse
it differently:

- `.env.local` — Next strips the surrounding double quotes before the app sees the value
- **Vercel env vars — stored verbatim, quotes included**

So copying the line straight out of `.env.local` *with* its quotes gives Vercel a value
beginning `"-----BEGIN…`, which fails to parse and returns a 500 saying nothing useful.

**Paste the key without the surrounding quotes**, keeping the `\n` sequences. Since
2026-08-10 `lib/google.js` strips stray quotes anyway and throws a named error if the PEM
is malformed, so a mistake here now says what is wrong instead of crashing opaquely.

Nothing else is needed. There are **no Xero variables** — this app makes no Xero calls.

## Google access

The service account is already an editor on the workbook (it is the same one
`expense-pwa` uses). No new sharing step.

## Deploy

Vercel auto-detects Next.js. Build command `npm run build`, output handled by the
framework preset — no overrides required.

## After deploying

1. Log in with a PIN on the deployed URL.
2. Open a project, add a cost, delete it — confirms Sheets writes work with the
   production credentials.
3. Install to the home screen, then turn off Wi-Fi and reopen a project you have viewed —
   confirms the service worker registered. It only registers in production, so this is the
   first real chance to test it.

## Still outstanding

**The `Expenses` tab rename is deferred and not done.** It requires `expense-pwa` to be
made config-driven and deployed *first*, or expense submission breaks. The handoff prompt
for that repo is in the scratchpad (`expense-pwa-config-prompt.md`); the ordering is in
the project plan. Renaming the tab before that deploy will take the expense app down.
