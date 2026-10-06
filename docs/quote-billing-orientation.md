# Quote and Billing — Phase 0 orientation

Written 2026-10-06 from the repo, the sibling `expense-pwa`, the live workbook (read-only)
and live Xero (read-only). No feature code was written. The spec is
`docs/quote-billing-spec.md`; its **Amendments** section holds every decision made so far
and is not repeated here except where it changes the answer.

## 1. Pages, components, routes, and how a project opens

| What | Where |
|---|---|
| Screens | `app/<screen>/page.js`, all `'use client'`. Login `/`, home `/home`, list `/projects`, new `/projects/new`, detail `/projects/[code]` |
| Shared UI | `app/components/`. `AppShell` is the auth gate and header on every signed-in screen; `LineRow`, `Tag`, `FilterChip`, `TotalsCard`, `CostForm`, `LockCodeInput` |
| API | `app/api/<name>/route.js` — the only code that touches Sheets. `auth`, `projects`, `costs`, `reference` |
| Server modules | `lib/*.js`. One module per tab it owns (`costs.js`, `projects.js`, `receiptedInvoicing.js`), read-only views (`expenses.js`), aggregation (`rollups.js`) |

A project opens at `/projects/<project_code>` (e.g. `/projects/PRJ-042`). The page takes
`params` as a Promise (`use(params)`), finds the project in the client-side cache from
`lib/useProjects.js`, then fetches `/api/costs?project=<code>` for its money. Every
screen is a single 720px column (`AppShell`, `maxWidth: 720`), styled with inline tokens
from `lib/theme.js`; there is no CSS framework and no media queries beyond hover guards.

## 2. Google Sheets access

- Auth: a service account (`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`) via
  `lib/google.js`; workbook id in `GOOGLE_SHEET_ID`. Same service account as the expense
  app, already an editor.
- Layer: `lib/sheets.js` — `getTab(KEY)` resolves tab names from `System config`
  `TAB_*` rows (5-minute cache, with fallbacks); `readTab(tab, a1, idPattern)` filters
  by an ID regex because note rows sit inside data ranges; `appendRow`, `updateRange(s)`,
  `writeAfterLast`, `findRowById`, `deleteRowById`, `assertHeaders`, `safe`, `nextId`.
- Conventions that bind the new tabs: quote every tab name in A1; every written string
  through `safe()`; dates ISO `YYYY-MM-DD`, timestamps ISO with `+08:00` offset so Sheets
  keeps them as text; read with `raw: true` wherever values are sorted or summed; no
  checkbox columns (they break the API's append detection); each module declares one
  `COLUMNS` list and asserts it against the header row on first use.
- IDs: `nextId()` is max+1 over existing IDs. Deleted IDs are therefore reused, which is
  why the spec amendment makes line IDs per-quote counters that are never reused.
- No transactions. Multi-row writes are not atomic, which is why saves will be versioned
  rather than delete-and-rewrite.

## 3. How Xero is called today

**This app: not at all.** `APP_CONTEXT.md` and `docs/DEPLOY.md` both say so, and there are
no Xero env vars on Vercel. The only Xero code is the sibling `expense-pwa/lib/xero.js`:

- Tokens in `System config` (`XERO_ACCESS_TOKEN`, `XERO_REFRESH_TOKEN`,
  `XERO_TOKEN_EXPIRY`); refreshed when within 2 minutes of expiry; saved as three
  separate cell writes. Client id/secret and `XERO_TENANT_ID` are env vars.
- `xeroFetch(path)` adds the bearer token and `Xero-Tenant-Id`; a non-2xx response
  throws with the body text. No retry, no rate-limit handling.
- Bills: `POST /Invoices` with `Type: ACCPAY`, `Status: DRAFT`, `LineAmountTypes: NoTax`,
  contact by `findOrCreateContact(name)` (creates a contact on a name miss — exactly what
  the quote feature must never do), account code 310, tracking from a code→name map.
- Attachments: `PUT /Invoices/{id}/Attachments/{name}` with the raw file; a failure is
  logged and returns `null` rather than throwing.

Since 2026-10-06 this app has its own Xero app registration and tokens
(`XERO_PROJECTS_*`), authorised with `scripts/xero-auth.mjs`. Phase 2 ports the fetch
wrapper and token refresh here against those keys. The attachment helper's "swallow the
error" behaviour must not be copied for the quote PDF: an unattached PDF should be
reported and retried, never silently dropped.

Live Xero facts (sampled 30 of the 31 sales invoices dated from 1 Jun 2026):

- Organisation `HENG FA CONSTRUCTION PTE LTD`, SGD, `Asia/Singapore`.
- Every line `NoTax`; every priced line account code **200**; 11 of 199 lines are
  description-only headers (no account, no quantity).
- Most lines are quantity 1 with the size inside the description ("False ceiling 448
  sqft"), so imported "unit prices" are mostly lump sums.
- Four invoices carry November 2026 dates (future), so a "last price by date" must not
  trust dates blindly.
- Numbers are `INV-YYMMDD` with or without `-XX`, and some do not match the invoice date.
- `Service` tracking category has 15 options: Aircon, Carpentry, Cleaning, Company
  Vehicle, Disposal, Electrical, General, Hacking, Painting, Partition / Ceiling,
  Plastering, Plumbing, Tiling, Worker, Worker Transport.

## 4. Project → client → Xero contact

`Projects` column D is the typed `client_name`; column C `client_id` is a protected
formula that looks the name up in `Contacts` B (`CON-xxx`). Blank client = direct company
job, by design, never an error.

`Contacts` is A:G: `contact_id`, `company_name`, `contact_person`, `email`,
`whatsapp_number`, `contact_types`, `notes`. **There is no Xero ContactID column.** This
app reads A:G and the expense app A:F, both by index, so a new column must be appended
as H (`xero_contact_id`) and never inserted.

Filling it cannot be automatic. The sheet has 8 contacts and only one matches a Xero
contact by exact name (`Katherine`). The rest differ in wording ("Koel Design &
Furniture (CY)" vs "Koel Design and Furniture (CY)", "Urban Makers Construction" vs
"Urban Maker Construction Pte Ltd", "Sam (Grab)" vs "Sam"). Proposal, agreed: a one-time
script lists Xero contacts (read-only scope), proposes a pairing per sheet contact, and
writes only the pairs JY or William confirm. Xero also has clients the sheet lacks
(Renee, Theresa, "30 Swettenham Road").

## 5. Service report PDFs, logo and T&C config

**There is no service report module, no PDF code and no PDF dependency in this repo**, nor
in `expense-pwa`. `SYSTEM_REFERENCE.md` describes invoice and payslip *Google Docs*
templates filled by hand, which is not reusable. Phase 7 therefore needs a PDF approach
chosen from scratch, and a dependency (ask before adding, per the ground rules). Logo,
T&Cs and entity details will need new `System config` keys or a small config tab.

## 6. Sign-in and roles

PIN login: `POST /api/auth` matches a 4-digit PIN against `PWA_USER_n = name|PIN|role`
rows in `System config` and returns `{ name, role }`. The client stores that in
`localStorage` for 7 days (`lib/session.js`); `AppShell` redirects to `/` if absent.
`ADMIN_ROLES = ['admin', 'boss_man']` exists but **nothing enforces roles**, and **no API
route checks identity at all** — any route can be called without logging in.

Both current users are `admin`, so "admin only" is already true in practice. The gap
that matters is the billing route: a POST that creates an approved invoice must not be
callable anonymously. Proposal: the confirm step asks for the PIN again and the server
verifies it against `PWA_USER_*` on that request, which also yields a trustworthy
`billed_by` name. `/api/auth` must stay uncached by the service worker (it is).

## 7. Proposed locations and names

Following the one-module-per-tab pattern, JavaScript, `@/` alias:

| New | Path |
|---|---|
| Screen | `app/projects/[code]/quote/page.js` (quote and billing), later `app/projects/[code]/quote/vo/[n]/page.js` |
| Components | `app/components/quote/LineEditor.js`, `SuggestionPanel.js`, `PaymentSchedule.js`, `TotalsPanel.js`, `BillConfirm.js` |
| Routes | `app/api/quotes/route.js` (load/save), `app/api/quotes/bill/route.js` (stage and VO billing), `app/api/price-history/route.js` (read) |
| Sheets modules | `lib/quotes.js`, `lib/paymentStages.js`, `lib/priceHistory.js` |
| Pure maths | `lib/quoteMaths.js` — no Sheets or Xero imports |
| Xero | `lib/xero.js` — token refresh on `XERO_PROJECTS_*`, `xeroFetch`, one `createInvoice()` behind `XERO_DRY_RUN`, `listInvoiceNumbers(prefix)`, `attachToInvoice()` |
| Invoice numbers | `lib/invoiceNumbers.js` (pure, tested) |
| Tests | `tests/*.test.mjs` run with `node --test` — no runner dependency needed |
| Scripts | `scripts/xero-auth.mjs` (done), `scripts/import-price-history.mjs`, `scripts/link-xero-contacts.mjs` |
| Tabs | `Quotes`, `Quote lines`, `Payment stages`, `Price history`, with `TAB_QUOTES`, `TAB_QUOTE_LINES`, `TAB_PAYMENT_STAGES`, `TAB_PRICE_HISTORY` keys and fallbacks in `lib/sheets.js` |
| Config keys | `XERO_SALES_ACCOUNT_CODE`, `INVOICE_DUE_DAYS`, `QUOTE_UNITS`, `QUOTE_PROPERTY_TYPES`, `STAGE_TRACKING_OPTION` |

The quote screen gets a wide variant of `AppShell` (a `wide` prop raising `maxWidth`),
leaving every other screen at 720px.

## 8. Where the spec conflicts with the code, or is unclear

Resolved ones are in the spec's Amendments. Still worth knowing:

1. **`project_name` is deprecated.** "Reference = project name" means `display_address`
   (column B). Live Xero references are already addresses, so this matches.
2. **`LineRow` rule.** `APP_CONTEXT.md` says list rows go through `LineRow`. The editor
   table is a grid of inputs, not a list row; the rule needs an explicit carve-out.
3. **`APP_CONTEXT.md` "no Xero calls"** is now worded as "not yet"; it must be rewritten
   when `lib/xero.js` lands.
4. **Service worker caches `/api/` GETs.** A quote screen read offline may show stale
   billed state; the refresh button and the server-side "already has an invoice ID"
   guard cover it. Billing is a POST and is never cached.
5. **`GST_RATE` exists in System config** (0.09) and the old `Invoices` tab computes GST.
   The quote feature never reads it; "No GST" is unconditional.
6. **Vercel runs UTC.** Invoice dates and numbers must use `todaySingapore()` from
   `lib/dates.js`, never `new Date()` formatting.
7. **Price history quality.** Imported rows are lump sums with blank property type; they
   never fill a price (spec rule), which limits the damage, but the "other types' last
   prices" line will often be showing a lump sum, not a rate. William should know.
8. **Spec silent on:** a contract sum that drops below the amount already billed
   (negative final payment); which figure the `$1,014.00` in the sample line is (stage or
   contract sum); unit prices with more than 2 decimals (Xero rounds unit amounts to 2 dp
   by default, so the editor should cap at 2).
9. **Plan's ground rules assume** TypeScript ("typed"), a test runner, a
   `SYSTEM_REFERENCE.md` at the repo root (it is in `docs/`), and timesheet/payroll/
   scheduler/service-report code in this repo (none here; the timesheet app is a separate
   repo). None of these change the build, only the wording of the checks.

## Questions

**For William**
- Stage invoice tracking option: General, none, or the quote's main trade?
- Property type per quote or per project?
- Section subtotals on the client PDF?
- Any units beyond pcs, sqft, ft run, lot, room, lumpsum?
- Confirm sales account code 200.
- Blank-client project: can it be billed, and to whom?
- Mock-up look exactly, or the app's own fonts and colours with the mock-up layout?
- Keep imported history with blank property type, or tag common items afterwards?

**For JY**
- Check Extensions → Apps Script for the strings `Invoices`, `Payments` and `Payment
  allocations` before Phase 1 deletes those tabs.
- Agree the `Reports` fix: repoint rows 7–11 and 26 to the new tabs, or remove them.
- Confirm `node --test` (no dependency) is acceptable as the test runner.
- Confirm the PIN-re-entry design for billing, or name another server-side check.
