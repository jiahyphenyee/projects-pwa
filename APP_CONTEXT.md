# App context

## Data flow

A Google Sheets workbook (id in `GOOGLE_SHEET_ID`) is the single source of truth; this app holds no database. Route handlers under `app/api/` authenticate with a Google service account and read/write tabs through `lib/sheets.js`, which resolves every tab name from the workbook's `System config` tab rather than hardcoding it. Client pages are `'use client'`, fetch those routes, and cache reads in `localStorage` for instant search and offline reads.

## Directory map

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router pages. One folder per screen. |
| `app/api/` | Route handlers — the only place that touches Google Sheets. |
| `app/components/` | Shared UI. `AppShell` is the auth gate + header for every signed-in screen; its `layout` prop sets the page width by screen type (workflow 720 / dashboard 1280 / editor 1360). |
| `app/components/dashboard/` | Dashboard building blocks: `Panel`, `StatTile`, `TileGrid` / `PanelGrid` / `DashboardStack`, and shared table styles. Built only from `lib/theme.js` tokens. |
| `app/components/quote/` | The quote screen's parts. `QuoteScreen` is the whole screen, shared by the quote (`/projects/<code>/quote`) and variation orders (`…/quote/vo/<id>`, or `vo/new`); `LineEditor`, `TotalsPanel`, `PaymentSchedule`, `VariationOrders`, `BillConfirm`, and `QuoteBillingCard` for the project screen. |
| `lib/priceMemory.mjs` | Price suggestions and the price check, pure and tested. Runs in the browser on history loaded once with the screen. |
| `lib/billing.js` | Billing one payment stage: preview with blockers, then PIN-checked, idempotent creation of one approved Xero invoice. |
| `lib/voInvoice.mjs` | The exact Xero invoice for a variation order, with the lines-equal-contract-sum check. Pure, tested. |
| `lib/invoiceNumbers.mjs`, `lib/stageInvoice.mjs` | Invoice numbering (INV-YYMMDD-XX) and the exact stage invoice payload. Pure, tested. |
| `lib/pin.js` | Server-side PIN check against `PWA_USER_*`, for billing. |
| `lib/quoteEditor.mjs` | The editor's row operations (insert, move, duplicate, delete, save payload) as pure, tested functions. |
| `lib/google.js` | Service-account auth and a memoised Sheets client. |
| `lib/sheets.js` | Generic Sheets layer: `getTab`, `readTab`, `appendRow`, `writeAfterLast`, `updateRange`, `findRowById`, `safe`, `nextId`. Not project-aware. |
| `lib/constants.js` | Shared constants. Never tab names — those come from `getTab()`. |
| `lib/useProjects.js` | Stale-while-revalidate project cache + prebuilt search index. The single source of project data on the client. |
| `lib/projects.js` | Server-side project creation and lock-code edits (works around the protected column C). |
| `lib/costs.js` | Server-side cost CRUD against the `Project costs` tab. |
| `lib/expenses.js` | READ-ONLY view of the receipted `Expenses` tab. Never writes. |
| `lib/receiptedInvoicing.js` | Invoiced state for receipted expenses, in the separate tab this app owns. |
| `lib/rollups.js` | All cost aggregation, the merge of the two cost sources, and the `GEN-000` exclusion rule. |
| `lib/projectFigures.mjs` | Every project-screen figure past the cost list: cost split, quoted value by service, profit/margin/budget, status flag, invoice ageing, invoice→project matching, possible duplicates. Pure, tested. |
| `lib/projectInvoices.js` | Every Xero sales invoice (drafts included) and live credit note, normalised and memoised for 10 minutes, plus `invoicePdf()`. Read-only. |
| `lib/invoiceMatching.js` | One parallel read of everything invoice→project matching needs: documents, project addresses, manual links, the billed-invoice index. |
| `lib/stageSelection.mjs` | Which stages one invoice may cover (billed together), and the retry rule for an unfinished attempt. Pure, tested. |
| `lib/clientAcceptance.mjs` | The client's answer to a quote or VO and the billing rule it sets. Pure, tested. |
| `lib/xeroQuotes.js` | Quotes made in Xero, read-only, memoised 10 minutes, plus their PDF. A refused read reports `noPermission`. |
| `lib/xeroLinks.js` | The `Xero links` tab: manual invoice→project links made on the Invoices screen. This app owns it. |
| `app/api/dashboard/` | Quote figures, the project's matched Xero invoices and the thresholds, each settling on its own. Costs stay on `/api/costs`. |
| `app/components/project/` | The project's two views' parts: Summary header, tiles and panels; `CostRow`, `LockCodeCard` and the `ViewSwitch` shared with Costs. `TotalsCard.js` now holds only the shared amount formatters. |
| `app/projects/[code]/` | **Summary** (dashboard, admins) at `/projects/<code>`; **Costs** (workflow, everyone) at `/projects/<code>/costs`; **Billing** (dashboard, office role) at `/projects/<code>/billing`; **Invoices** (workflow, `INVOICES` permission) at `/projects/<code>/invoices`, reached from the Xero invoices panel's "Link invoices". The client's answer to a quote or VO is recorded at the top of the quote screen (`ClientAnswer`); quotes made in Xero before this app show read-only in the Summary's and Billing's "Quotes in Xero" panel (`XeroQuotesCard`). |
| `lib/roles.mjs` | Which `PWA_USER_*` roles may sign in, and what each may do (`can(role, permission)`). Pure, tested. |
| `lib/useProjectCosts.js`, `lib/useProjectDashboard.js`, `lib/useViewer.js` | A project's costs (load, cache fallback, tick, bulk mark), its Summary reads (dashboard + billing summary), and the viewer's role — shared by both views. |
| `lib/dates.js` | ISO/serial date conversion and Singapore timestamps. Vercel runs UTC, so timezone is explicit. |
| `lib/recents.js` | Per-user recently-opened projects, and the `RECENTS_CHANGED` event screens listen to. |
| `lib/session.js` | `localStorage` session with expiry. |
| `lib/theme.js` | Design tokens for inline styles. |
| `docs/` | Deploy notes, and the master `SYSTEM_REFERENCE.md` for the whole operations system. |
| `public/sw.js` | Hand-written service worker. Bump `CACHE_VERSION` on any change to it. |
| `lib/localCache.js` | localStorage fallback so viewed projects open offline. |
| `lib/useOnline.js` | Online/offline state for the header banner. |
| `lib/quotes.js` | Quotes, VOs and payment stages: versioned save, load, list. Owns `Quotes`, `Quote lines`, `Payment stages`. |
| `lib/priceHistory.js` | The `Price history` tab: upsert per saved line, read for suggestions. |
| `lib/quoteMaths.mjs` | Every money calculation for quotes. Pure; `.mjs` so `node --test` runs it. |
| `lib/quoteSchema.mjs` | Column maps and headers of the four quote tabs, shared by the server modules and the setup script. |
| `lib/xeroClient.mjs` | Dependency-free Xero API client: token refresh against a pluggable store, 401/429 handling, paging. Used by the app and the scripts. |
| `lib/xero.js` | The app's Xero connection: token store on `XERO_PROJECTS_*` in System config, `isDryRun()`. |
| `assets/` | Files the server reads at runtime, bundled by `outputFileTracingIncludes`. `quote-logo.png` for the quote PDF. |
| `lib/quotePdf.mjs`, `lib/quoteDocument.js` | The quote PDF: pdf-lib renderer (pure) and the model built from the saved quote and System config. |
| `tests/` | `node --test` unit tests (`npm test`). No runner dependency. |
| `scripts/` | One-off Node scripts run by hand, never by the app; `_shared.mjs` gives them Sheets and Xero access without the `@/` alias. `xero-auth.mjs` authorises this app's own Xero connection; `setup-quote-billing-tabs.mjs` creates the quote tabs (idempotent); `sample-quote.mjs` is the Phase 1 round-trip check against a running dev server; `import-price-history.mjs` and `link-xero-contacts.mjs` are the Phase 2 imports, both read-only against Xero. |

## Rules to maintain

**Spreadsheet access**

- **Never `.slice(1)` a sheet range.** This workbook has free-text `ℹ` note rows *inside* data ranges — `Projects` row 2, `Expenses` row 4. Filter by ID prefix instead (`/^PRJ-/`, `/^EXP-/`, `/^PC-/`). Use `readTab()`, which enforces this.
- **Never hardcode a tab name.** Use `getTab('PROJECT_COSTS')`. Tab names live in `System config` as `TAB_*` keys and may be renamed without code changes.
- **Always quote tab names in A1 ranges.** `'Project costs'!A:N` is valid; `Project costs!A:N` is a 400. Use `range()`.
- **Every string written to Sheets goes through `safe()`.** A leading `= + - @ |` is otherwise parsed as a formula.
- **`Projects` column C (`client_id`) is a protected, self-populating column.** It auto-fills `=IFERROR(INDEX(Contacts!A:A, MATCH(D<row>, Contacts!B:B, 0)), "")`, deriving the ID *from* `client_name` in column D — the reverse of what `SYSTEM_REFERENCE.md` claims. Never write to it: it is both unnecessary and blocked by a protected range named "autofilled". Write `A:B` and `D:L` around it.
- **Never `appendRow()` into a tab with a checkbox column.** A checkbox reports `FALSE` in every formatted row even when empty, so the API's table detection thinks the table is 1000 rows long and writes below it — outside the date/currency formatting, where dates land as text. Narrowing the search range does not help; detection looks at whole rows. Use `writeAfterLast()` on `Project costs`, and verify the readback since its row choice is not atomic.
- **Read numerically whenever values are sorted or summed** — `readTab(..., { raw: true })`. Formatted reads give display strings, and `"10 Aug 2026"` sorts before `"9 Aug 2026"`. Cost dates are normalised to ISO via `sheetDateToIso()` and formatted for display with `formatIsoDate()`.
- **Never use `insertDataOption: 'INSERT_ROWS'` on `Projects`.** Inserting a row is a structural change affecting every column, so it fails against the protected column C even when writing only A:B. `appendRow()` uses the default OVERWRITE, which writes into existing blank rows.
- **Rows in `Projects` cannot be deleted via the API** for the same reason. Clear `A:B` and `D:L` instead, leaving C's formula.
- **IDs are max+1 over existing IDs** (`nextId()`), never a row count. Codes are non-contiguous.
- **Dates are written as ISO `YYYY-MM-DD` with `USER_ENTERED`.** The workbook locale is `en_US`, so ambiguous formats parse wrongly. Timestamps are written as ISO 8601 *with offset* so Sheets leaves them as text.
- **Never delete rows in tabs this app does not own** (`Projects`, `Expenses`, `Contacts`, `Categories`). Hard delete is permitted only in `Project costs`, and only via `deleteCost()` / `deleteRowById()`, which re-verify the row's ID immediately before deleting because the API deletes by index and indexes shift.
- **`Project costs` is exactly 14 columns (A:N) and has no `category_name`.** The trade's display name is joined from `Categories` on read. A row wider than the tab is rejected outright by the API — never truncated — so `writeAfterLast()` checks the tab's width first and names the drift rather than letting every insert fail on an opaque "exceeds grid limits".
- **`cost_type` values must match that column's own dropdown in the workbook** (`material`, `labour (internal)`, `labour (external)`, `transport`). The sheet validates against its list, so a value invented in code is rejected there even where the API accepts it — and the API will happily write one, so the sheet is no safety net. Changing the vocabulary means editing the dropdown and migrating the existing rows, not just `COST_TYPES`.
- **Editing a cost rewrites `E:I` only.** `project_code`, `project_name`, the invoiced state (`J:K`), `invoice_ref` and `created_by` are deliberately untouched, so correcting an amount can never silently un-bill a line or reassign authorship.
- **Deleted cost IDs are reused.** `nextId()` is max+1 over surviving rows, so deleting the newest cost frees its ID for the next insert. Fine within the sheet; be careful if a cost ID is ever quoted outside it.

**Quotes (data layer; the screen arrives in Phase 3)**

- **Every quote figure goes through `lib/quoteMaths.mjs`.** Integer-cent arithmetic, 2 dp, no GST. The editor, the saved totals, the PDF and the Xero invoice must never compute a figure their own way, or they will disagree by a cent.
- **Saving a quote never edits its live lines.** New lines are appended as the next `version` in one request; flipping `Quotes.current_version` is the commit point; pruning runs after the response (`after()`) and may fail harmlessly. Sheets has no transactions, and a half-applied delete-and-rewrite would be a quote with half its rows.
- **A prune deletes only versions strictly below current; a save writes above every version on the tab.** Both rules live in `lib/quoteVersions.mjs` with tests. A prune that deleted "everything but current" once raced a save mid-commit and deleted its new lines (2026-10-07, test data only). Never loosen either rule.
- **A save is one parallel wave of reads, two ordered commit writes, one parallel wave of follow-up writes.** Don't add a read-back or a sequential read to it: each Sheets call is ~400ms and can stall for seconds.
- **Line IDs are never reused.** `next_line_no` only goes up, so `Price history` (keyed on `line_id`) can never attach a new line to an old item's price.
- **A billed stage is locked.** Its name, share and amount are read from the sheet, never from the request, and it cannot be removed while it carries a `xero_invoice_id`.
- **Stage amounts are computed on read, never stored, except for billed ones.** The final payment is contract sum minus every other stage, so the schedule always sums to the contract sum to the cent.
- **Property type lives on `Projects` column M**, set once per project; a quote copies it at save time. `Projects` is now A:M. Column C stays protected and unwritten.
- **`Quotes.issue_version` (W) is the client-facing version (v1, v2…), not `current_version`.** It is raised only by the quote screen's count-up-only Version field (`startIssueVersion`, refused unless the sheet still holds the version the screen showed), never by a save; blank reads as 1. It is printed on the quote PDF and in its file name (`quoteFileName`). VOs are not versioned and their PDFs never show the Q-number.
- **The quote tabs use `appendRows()` and `deleteRowsByNumbers()`** — this app owns them outright and they have no checkbox columns. Those helpers are never used on shared tabs.
- **`Categories.E xero_tracking_option` is the one Xero mapping.** Do not add a code→option map in this repo.
- **A price is only ever filled from a past quote of the same property type, and only into a blank price.** Imported rows (blank `property_type`) are reference only. A quote never suggests or price-checks against its own saved lines. All in `lib/priceMemory.mjs`; keep it there.
- **The quote editor is exempt from the `LineRow` rule.** It is a grid of inputs, not a list of read-only rows; `LineRow` remains the rule for every list on the other screens.
- **Row rules live in `lib/quoteEditor.mjs`, not the component.** A new row copies the nearest item's service; a title moves alone; deleting a title keeps its lines; the last row cannot be deleted; prices take at most 2 decimals; fully blank rows are dropped on save.
- **The quote screen loads with one parallel wave of reads** (`loadQuoteScreen`). Each Sheets call is ~400ms on a good day and several seconds on a bad one, so never chain reads that could run together.

**Project figures (dashboard checkpoint 1)**

- **Every figure on the project screen beyond the cost list comes from `lib/projectFigures.mjs`**, in integer cents. The page computes them on the client from `/api/costs` and `/api/dashboard`, so a cached copy still renders and ages correctly offline. Never total or split costs in a component.
- **Cost buckets follow `cost_type`, in both ledgers**: `material` → Materials, `labour (external)` → Subcon, `labour (internal)` → Own labour, `transport` → Transport. A receipted row with a blank `cost_type` (everything before 2026-10-15) is Transport for `TRANS`/`VEHIC`, Materials otherwise. Buckets always sum to the grand total.
- **`labour (external)` is subcon for now.** It is mostly day-paid freelancers. When the Labour log goes live, a freelancer's days must not be costed from both the log and the payment row.
- **Ongoing vs completed is `Projects.status === 'closed'`.** Ongoing profit is against the quote, so no quote means no profit figure ("No quote"), never a 100% margin. Completed profit is against what was invoiced. Xero unreadable → those figures are null, never computed as if nothing was invoiced.
- **Quoted = the quote's plus every VO's `contract_sum`, at its live version.** The by-service split spreads any discount across services by largest remainder, so service rows total the quoted figure to the cent. Lines with no category have their own row, so cost rows also total the grand total.
- **Invoices match a project in this order** (`assignDocuments`): a manual link in `Xero links`; then this app's own billing record (`xero_invoice_id` on a payment stage or VO, via `billedInvoiceIndex()`), which also gives the invoice its stage; then the Xero `Reference`: the exact `display_address` first (ignoring case and spacing), then block number + first street word + unit number. A reference fitting two projects is shown as ambiguous and counted nowhere — never guessed; it is linked by hand on the Invoices screen. Two projects can share an address (one billed to the ID firm, one to the owner), so the Reference alone is never enough for them. Credit notes subtract from invoiced; applied credit is already out of `AmountDue`.
- **Drafts (and invoices submitted for approval) are listed, never counted** (`isDraft`). They appear greyed with a PDF link and are excluded from invoiced, collected and outstanding. Credit notes are still read live-only.
- **An invoice's stage**: the payment stage or "VO n" it was billed for; otherwise "Payment n (auto)" by date among the project's non-draft invoices (`labelStages`). Never stored.
- **`Xero links` is keyed by Xero InvoiceID in column A; unlinking blanks `project_code`** instead of deleting the row. Missing tab reads as no links; linking fails loudly with the setup script to run.
- **Invoice PDFs come straight from Xero** (`GET /api/invoices/pdf?id=`), only for invoices in the organisation's sales list. A read: dry run does not apply. `xeroClient` `binary: true` returns the bytes untouched.
- **The Xero invoice read is separate from costs and fails soft.** `/api/dashboard` uses `Promise.allSettled`; a failed part returns `{ error }` and is not written over the last good cached copy. Credit notes that cannot be read are skipped, and the screen says so.
- **Profit, margin, invoices, flags, the cost split and the by-service table live on the Summary, which is admin-only.** Viewers without `SUMMARY` and GEN-000 are redirected from `/projects/<code>` to `/costs` once the session is read (`useViewer().ready`) — never before, or an admin is bounced too. The office role sees the billing and Xero invoices panels on the Billing view instead. On Costs the lock code stays the first card: it is what people on site open the screen for.
- **"Xero invoices" is not "Invoiced".** The cost list's tick column means a cost was recharged to the client; keep the two words apart on screen.
- **Thresholds are System config rows** (`TARGET_MARGIN_PCT`, `WATCH_LEVEL_PCT`, `OVER_LEVEL_PCT`, `CHASE_AFTER_DAYS`, `OVERDUE_AFTER_DAYS`), read with the same defaults when absent or blank — never 0.
- **`Receipted expenses` is read to column T** (`cost_type`, written by `expense-pwa`). Still read-only here.

**Business rules**

- **Every Xero write goes through `xeroWrite()` in `lib/xero.js`** (via `createInvoice()` or `attachToInvoice()`), which honours `isDryRun()` — true unless `XERO_DRY_RUN` is exactly `false`. In dry run nothing is written anywhere: the stage stays unbilled and the screen shows the payload. The `Expenses` tab stays read-only; receipted expenses reach Xero through `expense-pwa`.
- **Billing a stage is idempotent and must stay so.** A stage with `xero_invoice_id` is never sent again. The number is stored with status `sending` before the Xero call; any retry looks that number up in Xero and adopts a matching invoice instead of creating another. The call carries an `Idempotency-Key`. A duplicate-number rejection takes the next number and retries once. Do not remove any of these.
- **The quote PDF goes onto the first stage invoice once.** `Payment stages.pdf_attached_at` records it; if any stage of the quote has it, nothing is sent. A failed attachment never fails billing. The PDF is drawn from the *saved* quote, with no section subtotals (William).
- **PDF text goes through `printable()`**: the standard PDF fonts cover Windows-1252 only, so anything else becomes "?" instead of failing the document.
- **The client's answer lives in `Quotes` AA:AC** (`client_status` blank/sent/accepted/declined, `client_sent_at`, `client_accepted_at`), written only through `setClientStatus()` and only to those three cells. `status` stays the billing state. **No stage or VO is billed until the client has accepted** (`acceptanceBlocker`, checked in `prepareStageBill`/`prepareVoBill`); a quote with a blank answer that already has a billed stage counts as accepted, so jobs billed before this rule carry on. Each VO settled on the final invoice is checked too (`settlingBlocker`; a blank answer passes only on a VO created before `ACCEPTANCE_RULE_FROM`). A retry of an earlier attempt (`attemptInFlight`: a number kept, no invoice, `sending` or `error`) is never blocked, and while one exists the answer can only be set to accepted. **Deploy:** run `scripts/setup-quote-billing-tabs.mjs` on the live sheet first; it appends the AA:AC headers, without which `assertHeaders` stops every Quotes read. **Stages billed together share one invoice**: every stage on it records the same `xero_invoice_id`/number with its own `billed_amount`; an unfinished attempt (`sending`/`error`) belongs to every stage holding its number, and its retry must select exactly those (`selectStages`). Billing is queued per quote in-process, and `claimStages()` writes `sending`, pauses, and re-reads so another instance's overlapping claim stops it before Xero is called. **Every other write to a `Quotes` row stops at Z** (`coreRow`, `A{n}:Z{n}`), so a save never overwrites a client answer; only a new row is appended at full width.
- **`Quotes` runs past column Z.** Its last column comes from `columnLetter()`, never `String.fromCharCode`, which gives "]" after Z.
- **A variation order is a `Quotes` row with `kind = vo`, edited by the same `QuoteScreen` — never a copy of it.** Its billed state lives on that row (`xero_invoice_*`, `billed_*`), and `Quotes.status` carries `sending` / `error` / `billed` as a stage's `xero_sync_status` does. Billed VOs are locked; VOs never change stage amounts.
- **No save while a billing attempt is unfinished** (`sending`): the retry must match the invoice by amount, and an edit would stop it matching. A VO is frozen while the final payment invoice is `sending` too, since that invoice settles it.
- **Every VO settles on the final payment invoice unless billed early.** A VO's `contract_sum` is signed (negative lines are allowed on VO lines only — `cleanLines`/`acceptDecimal` with the VO flag; the quote still floors at 0). The final stage's amount is `finalPaymentDue()`: the %-based balance plus every VO without an `xero_invoice_id`, one "Add:"/"Less:" line each (`buildStageInvoice`). Billing the final writes the invoice onto those VOs (`xero_invoice_*`, `billed_*`, `settled_on_stage_id`) so they are locked and never put on another invoice. Only a VO with a positive total may be billed on its own, and a VO netting to ≤ 0 cannot be saved once the final is billed.
- **`lineAmount` is exact decimal arithmetic** (BigInt). Floating point turns 91.5 × 6.55 = 599.325 into 599.32; Xero says 599.33.
- **Billing re-checks everything on the server**: the PIN (`lib/pin.js`), shares ≤ 100%, a client with a Xero ContactID that Xero still has, and that the amount and quote version match what was confirmed. The screen's checks are convenience only.
- **Invoices are sent against `ContactID` only, as `AUTHORISED`, `NoTax`, with `Reference` = `display_address`, due date + `INVOICE_DUE_DAYS`, account `XERO_SALES_ACCOUNT_CODE`.**
- **Never create a Xero contact.** Invoices go against `Contacts.xero_contact_id` (column H) only. The token's contacts scope is read-only, so an attempt fails in Xero as well as in review.
- **This app has its own Xero app registration and its own tokens**, stored in `System config` as `XERO_PROJECTS_ACCESS_TOKEN` / `_REFRESH_TOKEN` / `_TOKEN_EXPIRY`. Never read or refresh the expense app's `XERO_ACCESS_TOKEN` / `XERO_REFRESH_TOKEN`: Xero refresh tokens are single-use, so two apps sharing one set take turns locking each other out.
- **Whether a receipted expense has been invoiced is tracked in its own tab**, `Receipted expense invoicing` (`TAB_RECEIPTED_INVOICING`), keyed by `expense_id` and joined on read. That state is a fact about *our* billing, not about the expense claim, so it must not be written into `Expenses` — which stays read-only, and whose every column belongs to `expense-pwa` or its Xero sync. Rows are created lazily on the first tick: **absent means not invoiced**. Non-receipted costs are unaffected; they keep their own state in `Project costs` J:L. Both are normalised to one `{ invoiced, invoicedDate }` shape by `app/api/costs`, so no screen branches on which tab it came from.
- **Never format `invoiced` in that tab as a checkbox.** Plain `TRUE`/`FALSE` text only. A checkbox column defeats the API's table detection for the whole tab — the same failure that forced `Project costs` onto `writeAfterLast()`.
- **A missing `Receipted expense invoicing` tab degrades to "nothing is invoiced" on read, and fails loudly on write.** A workbook that has not been set up still shows its costs; a tick that cannot be saved must never look like it was.
- **Per-project receipted spend can only come from the `Expenses` tab, never from Xero.** Xero carries no project dimension — its only tracking category is `Service` (trade), and the live bill references do not contain a `PRJ-` code. `project_code` exists as a real column in Sheets only.
- **Rejected expenses are excluded from project totals** (the company is not carrying that cost); pending ones are included, since the money was spent and only the review is outstanding.
- **`GEN-000` is excluded from every cross-project rollup.** It is the general company expense bucket and is browsable like any project, but counting it in aggregates inflates project costs with overheads. Apply the exclusion in `lib/rollups.js` only.
- **A project with no client is a direct company job**, not incomplete data. Never treat a blank `client_name`/`client_id` as an error or prompt to fix it; in client-based rollups these belong to the company itself, not to an "unknown client" bucket.
- **`display_address` is immutable** once a project has linked rows — it is stored denormalised across timesheets, expenses and invoices.
- **`display_address` is the only name a project has. `Projects.project_name` (column E) is deprecated** — never read or write it. It was a copy of B that went stale: blank on 5 projects, drifted on 2, and referenced by nothing. Every formula, dropdown and denormalised row in the workbook joins on column B.
- **A tab's column map is asserted against its header row on first use** (`assertHeaders`). Each module owning a tab declares one `COLUMNS` list pairing field name to header; the index map and the assertion are both derived from it, so they cannot drift apart. `null` marks a column this app does not address. One extra read per cold start. Add a column to a map and you must add its header — that is the point.
- **Never delete a column from `Projects`.** Both this app and `expense-pwa` read that tab by index (`row[7]` status, `row[11]` lock_code), so removing the dead column E would silently shift every later field and empty the expense app's project picker. Deprecated columns stay in place.

**Roles**

- **Every role check goes through `can()` / `hasAccess()` in `lib/roles.mjs`.** Never compare a role string in a component or route. Admin and `boss_man` have every permission; `office` has `QUOTES` (quotes, VOs and billing) and `INVOICES` (Xero invoices) but not `SUMMARY` (profit, margin, budget, cost split, by service). Every listed role can open projects, create them and enter costs.
- **A role not in `ROLE_PERMISSIONS` cannot use this app.** `/api/auth` refuses its PIN with a 403, and `getUser()` drops a session carrying it, so taking a role away signs that person out on their next screen. The same `PWA_USER_*` rows sign in to `expense-pwa`, which does its own gating — this lock-out is projects-pwa only.
- **Roles gate screens, not data, except for billing.** The session is unsigned `localStorage` and no route checks identity, so a role check in the browser is convenience. Billing is the exception: the PIN re-entered on the confirm step yields a trustworthy role, and `lib/billing.js` refuses a PIN without `QUOTES`.
- **The office role reaches quotes through the Billing view**, which holds the Summary's two billing panels. `ViewSwitch` offers Billing only to viewers without the Summary, and draws nothing when there is only one view.

**Offline**

- **The service worker registers in production only.** In dev it caches constantly-changing unhashed assets and produces stale-module errors that look like real bugs. Test with `npm run build && npm start`.
- **Bump `CACHE_VERSION` in `public/sw.js` whenever that file changes.** The cache name is what evicts the old cache; a stale shell served against fresh chunks is the classic PWA failure.
- **Never cache `/api/auth` or any non-GET request.** A cached identity is a security problem, and cached writes are a correctness one.
- **Stale data must say it is stale.** The project screen shows how old cached figures are — silently showing out-of-date money is worse than an error.

**Screen types**

Every screen is one of three kinds, and its kind decides its layout. Pick the kind before laying a screen out.

| | Workflow | Dashboard | Editor |
|---|---|---|---|
| For | Doing a task on a phone: record, tick, edit, find a code | Reading a state at a desk: is this job OK, what is owed | Building a document: the quote |
| `AppShell layout` | `workflow` (default, 720px) | `dashboard` (1280px) | `editor` (1360px) |
| Shape | One column, in task order | Header → `TileGrid` → `Panel`s, stacked in priority order, side by side via `PanelGrid` | A grid of inputs |
| Lists | `LineRow` | `LineRow` for lists of things; a table (dashboard `table.js` styles) only for figures read across *and* down | Its own grid |
| Actions | Inline, 44px targets | **None inline.** Every action is a link into a workflow or editor screen | Inline |

- **One job per screen.** An object that is both reported on and edited gets two views of one URL tree (Summary at `/projects/<code>`, Costs at `/projects/<code>/costs`), joined by `ViewSwitch` — not one screen doing both.
- **Dashboards never edit in place.** A row shown on a dashboard drops its action (`CostRow` without `onToggle`); a panel's action is a `PanelLink` to where the change is made. "Bill next stage" opens the quote screen, which keeps its own confirm and PIN.
- **Responsive without media queries.** Grids use `repeat(auto-fit, minmax(min(100%, Npx), 1fr))`: tiles fall to two across a phone, panels to one. Panels are written in priority order because that is the order a phone shows them. Never let side-by-side placement carry meaning.
- **Same components in every kind.** A dashboard is laid out differently, not styled differently: `card`, `Tag`, `LineRow`, `font.size` and the theme colours throughout. The build-spec mock-up's navy palette and IBM Plex are not adopted — only its layout.

**Code**

- JavaScript, not TypeScript. App Router. `@/` alias. Inline styles from `lib/theme.js` — no CSS framework.
- **List rows go through `app/components/LineRow.js`**, and tags through `Tag.js` (a dashboard table of figures is the one exception — see Screen types). The project screen renders both cost sources through one `CostRow`, so any difference in how a row looks reads as a difference in what it means. Only three things may differ between the two kinds: the word "Receipted" in `meta`, the payee, and whether the label opens the editor. Change spacing or sizing in `LineRow`, once.
- **A row is tagged with its category CODE, never the joined display name.** `Project costs` joins a name from `Categories` and the Expenses tab stores only the code, so showing the name on one and the code on the other makes one trade look like two. The name survives only as the fallback label for a cost with no description, where "Electrical" beats "ELEC".
- **A filter control must not look like a `Tag`.** Filters and row tags sit inches apart on the project screen and mean opposite things — a tag is a fact about its row, a chip is a control that changes what you see. They go through `FilterChip`, which is squarer, larger and bordered, reusing the selected-option look of the cost type buttons. When the two looked alike, a row's category tag read as something you could press.
- **Filtering the cost list must never change a total that describes the whole project.** The totals card stays whole-project; the filtered figure lives in the filter bar where the selection is visible. And the bulk "mark invoiced" button is withheld while a filter is on — it marks the whole project, and a button reading "Mark 27" under a list showing 6 is how someone bills a client for the wrong thing.
- **A receipted row must never offer an edit affordance**, and `app/api/costs` rejects `PUT`/`DELETE` on an `EXP-` id independently of the UI. Editing one here would desync it from its Xero bill. Marking it invoiced is the one write allowed, and it lands in a different tab.
- **A row's two lines must be visibly different sizes.** 15px/600 for the label and amount, 12px for everything under them. At 13 over 12 nothing leads, and a tinted pill on the lower line then out-weighs the label above it — the row reads bottom-first.
- **The cost list has column headers, and they are load-bearing.** The tick box carries no words of its own, so the `Invoiced` heading is the only thing naming it — and `ACTION_WIDTH` is sized to fit that word, not the 44px target inside it. The header uses the same flex shape as a row so the headings land over the columns they name; change one and change the other.
- **A row's action sits beside its text, never under it.** A 44px tap target stacked below the meta line makes a row's secondary line taller than its primary one, and the label stops being what you see first. The action is a fixed-width column (`ACTION_WIDTH`, set by the caller so `LineRow` stays generic) — that is also what keeps amounts aligned down the list, since "Invoiced" and "Not invoiced" are different widths.
- **An outline means pressable.** `Tag` draws its border only when it has an `onClick`; a static tag shows ground and text alone. Keep the border transparent rather than removing it, so both kinds measure the same and never sit a pixel apart in one row.
- **Tags do not wrap, so only fixed vocabulary belongs in one** — a category code, a status. Anything of unbounded length (a payee, an address) goes in a row's `meta` text, which wraps. A cost row carries exactly one tag, the category code; where the row came from, when, and who was paid are all quiet `meta` text, because a pill is a claim on the eye and only the trade earns one.
- **Never size text with a raw number.** Use `font.size.*` from `lib/theme.js`.
- **A `select` styled with `appearance: none` must draw its own chevron.** Stripping the native appearance is required — iOS otherwise sizes the control itself and overflows the card — but it removes the disclosure arrow too, leaving a dropdown that looks like a text field. Use a background-image SVG, not an extra element.
- **`input[type=date]` must use the `dateInput` token, not `input`.** iOS Safari sizes date inputs to their native control and ignores `width: 100%`, so a plain `input` style overflows its card. Keep `min-width: 0` on any grid or flex ancestor of a form control for the same reason.
- **Hover styling belongs in `globals.css` under `@media (hover: hover)`**, never inline and never unguarded — on touch, `:hover` sticks after a tap and leaves a control looking permanently hovered.
- Next.js 16: `params` is a Promise (`await params`, or `use(params)` in client components). Route handlers are uncached by default.
- Read `AGENTS.md` before writing framework code — the installed Next version may differ from training data.
