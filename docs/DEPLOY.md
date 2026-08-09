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

**The private key is the one that usually breaks.** `lib/google.js` calls
`.replace(/\\n/g, '\n')`, so the value must contain literal backslash-n sequences rather
than real newlines. Two ways to get that right:

- Paste the key wrapped in double quotes, exactly as it appears in `.env.local`.
- Or paste the raw multi-line key — Vercel stores it verbatim and the replace becomes a
  no-op, which also works.

If auth fails after deploy the error is usually `error:1E08010C:DECODER routines` or
`invalid_grant`, both of which mean the key was mangled in transit.

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
