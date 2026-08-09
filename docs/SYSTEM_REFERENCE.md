# Contractor & Renovation Business — Operations System
## Complete System Reference

> **Purpose:** single source of truth for the whole system. Use it when modifying the
> system, onboarding a developer, debugging, or planning features. Keep it updated
> whenever the system changes.
>
> **Version 3.0 — 2026-08-09.** Corrected against the live workbook. Sections marked
> **[corrected]** previously documented behaviour that does not match reality; each says
> what changed. See §22 for the full list.

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Technology stack](#2-technology-stack)
3. [Repository and file locations](#3-repository-and-file-locations)
4. [Google Sheets — workbook structure](#4-google-sheets--workbook-structure)
5. [Complete schema reference](#5-complete-schema-reference)
6. [Formula reference](#6-formula-reference)
7. [Named ranges reference](#7-named-ranges-reference)
8. [Apps Script modules](#8-apps-script-modules)
9. [Expense PWA — screens and API](#9-expense-pwa--screens-and-api)
10. [Projects PWA — screens and API](#10-projects-pwa--screens-and-api)
11. [Google Doc templates](#11-google-doc-templates)
12. [Xero integration](#12-xero-integration)
13. [Status lifecycles](#13-status-lifecycles)
14. [Role and access matrix](#14-role-and-access-matrix)
15. [Config tab reference](#15-config-tab-reference)
16. [Constants reference](#16-constants-reference)
17. [Writing to Sheets — rules that bite](#17-writing-to-sheets--rules-that-bite)
18. [Known constraints and limitations](#18-known-constraints-and-limitations)
19. [Modification playbooks](#19-modification-playbooks)
20. [Troubleshooting index](#20-troubleshooting-index)
21. [Changelog](#21-changelog)
22. [Corrections made in v3.0](#22-corrections-made-in-v30)

---

## 1. System overview

A Google Sheets-centred operations system for a contractor and renovation business.
Handles project tracking, expense management, timesheets, payroll, invoicing and
reporting.

**Design principles**
- Google Sheets is the single source of truth for all operational data
- Scripts read tab names from the `System config` tab — nothing hardcoded
- Data source functions are isolated so input channels can be swapped
- Xero is the accounting layer for **receipted** expenses only
- Two PWAs share the workbook and one service account

**Two apps, deliberately separate**

| App | Owns | Writes to |
|---|---|---|
| **Expense PWA** | Receipted expenses, with receipt images | `Receipted expenses` tab + Xero |
| **Projects PWA** | Non-receipted project costs, invoiced tracking | `Project costs` + `Projects` tabs |

The Projects PWA makes **no Xero API calls**. It reads the `Receipted expenses` tab so a
project's total cost is complete, but never writes there.

**Not in this system, by design:** CPF calculation, client portal, automated payslip
delivery, bank reconciliation in Sheets, WhatsApp parser.

---

## 2. Technology stack

| Layer | Tool | Purpose | Cost |
|---|---|---|---|
| Data | Google Sheets (main workbook) | All operational data | ~$6/mo |
| Data | Google Sheets (Payslips workbook) | One tab per worker | Included |
| Documents | Google Docs | Invoice and payslip templates | Included |
| Mobile input | Expense PWA (Next.js 15) | Receipted expenses → Xero | Free (Vercel) |
| Mobile input | Projects PWA (Next.js 16) | Projects and non-receipted costs | Free (Vercel) |
| Automation | Apps Script | Auto ID generation | Included |
| Accounting | Xero Standard | Bills, bank feed, GST F5 | ~$50/mo |

**~$56 SGD/month.** Receipts attach directly to Xero bills; no third-party file storage.

---

## 3. Repository and file locations

```
Google Drive: [Company] Operations/
├── Main workbook (Google Sheets)      — all operational data
├── Payslips workbook (Google Sheets)  — one tab per worker
├── Invoice templates/Invoice_Template.gdoc
└── Payslip templates/Payslip_Template.gdoc
```

| App | Repo | Local path |
|---|---|---|
| Expense PWA | `jiahyphenyee/expensing_pwa` (private) | `~/Developer/expense-pwa` |
| Projects PWA | `jiahyphenyee/projects-pwa` (private) | `~/Developer/projects-pwa` |

Both deploy to Vercel on push to `main`. Apps Script is bound to the main workbook
(Extensions → Apps Script).

---

## 4. Google Sheets — workbook structure

Tabs in order:

| Tab | Type | Purpose |
|---|---|---|
| START HERE | Guide | Orientation |
| System config | Config | Constants, tab names, PWA users, Xero tokens |
| Projects | Core | All projects |
| **Project costs** | Core | **Non-receipted costs (new in v3.0)** |
| Workers | Core | Worker details, rates, levy |
| Contacts | Core | Clients, suppliers, subcontractors |
| Timesheets | Core | Manual daily entries |
| **Receipted expenses** | Core | **Renamed from `Expenses` in v3.0** |
| Categories | Reference | Work category list |
| Public holidays | Reference | SG MOM list |
| Rest days | Reference | Per-worker rest day |
| Invoices | Output | Line items, status, payment tracking |
| Payments | Output | Payments received |
| Payment allocations | Output | Links payments to invoices |
| Payroll | Output | Monthly calculations |
| Reports | Output | Formula-driven P&L, GST |
| Plumbing Job Report | Ad hoc | |
| Plumbing Price List | Ad hoc | |

> **[corrected] Note rows live inside data ranges.** `Projects` has an `ℹ` row at row 2;
> `Receipted expenses` has a blank row 3 and an `ℹ` row 4 *between* data rows. Never
> `.slice(1)` — filter on the ID column (`/^PRJ-/`, `/^EXP-/`, `/^PC-/`).

**Workbook settings:** locale `en_US`, timezone **Asia/Singapore** (corrected from
America/Los_Angeles on 2026-08-08). Write dates as ISO `YYYY-MM-DD`, which parses
unambiguously regardless of locale.

---

## 5. Complete schema reference

### 5.1 System config

Key/value table, one row per constant. `TAB_*` keys are read at runtime by both apps.

| Key | Value | Notes |
|---|---|---|
| TAB_PROJECTS | Projects | |
| TAB_CONTACTS | Contacts | |
| TAB_WORKERS | Workers | |
| TAB_TIMESHEETS | Timesheets | |
| TAB_EXPENSES | **Receipted expenses** | Renamed v3.0 |
| TAB_INVOICES | Invoices | |
| TAB_PAYMENTS | Payments | |
| TAB_ALLOCATIONS | Payment allocations | |
| TAB_PAYROLL | Payroll | |
| TAB_REPORTS | Reports | |
| TAB_CATEGORIES | Categories | |
| TAB_PH | Public holidays | |
| TAB_RESTDAYS | Rest days | |
| **TAB_PROJECT_COSTS** | **Project costs** | **New v3.0** |
| XERO_ACCESS_TOKEN / REFRESH_TOKEN / TOKEN_EXPIRY | *(auto)* | Written by the expense PWA |
| GST_RATE | 0.09 | |
| INVOICE_PREFIX | **INV-2026** | *[corrected] — doc said `INV-`* |
| COMPANY_NAME / COMPANY_UEN | | |
| DRIVE_RECEIPTS_FOLDER_ID | *(id)* | *[corrected] — was undocumented* |
| DRIVE_PAYSLIPS_FOLDER_ID | *(id)* | |
| PWA_USER_1 / PWA_USER_2 | `name\|PIN\|role` | Both currently `admin` |
| RULE_EXPENSES | *(reminder)* | |

**Renaming a tab:** update its `TAB_*` key immediately after. Both apps cache config for
~5 minutes, so allow that before judging whether it worked.

### 5.2 Categories

| Column | Notes |
|---|---|
| A `category_code` | Short code, no spaces |
| B `category_name` | Display name |
| C **`active_codes`** | *[corrected] — doc called this `is_active`.* String `"TRUE"` |

**Live list (14, all active):** PLMB Plumbing · TILE Tiling · PAINT Painting ·
ELEC Electrical · CARP Carpentry · DISP Disposal · HACK Hacking · GENL General ·
CEIL Ceiling & Partition · WRKR Worker · TRANS Worker Transport · CLEAN Cleaning ·
OTHR Others · VEHIC Company Vehicle

> **[corrected] There is no `MATL` category.** The old starter list is obsolete.

### 5.3 Public holidays / 5.4 Rest days

Unchanged. `ph_date` must be Date format, not Text. Rest days is a satellite of Workers;
a worker with no row there never gets `is_rest_day = TRUE`.

### 5.5 Projects

| Col | Field | Notes |
|---|---|---|
| A | `project_code` | `PRJ-001`… Non-contiguous — currently to `PRJ-066` |
| B | `display_address` | **Required. Never change after use.** |
| C | `client_id` | **[corrected] FORMULA, and a protected range** — see below |
| D | `client_name` | **The typed value.** Must match `Contacts.company_name` exactly |
| E | `project_name` | Copy of `display_address` |
| F | `start_date` | |
| G | `end_date` | |
| H | `status` | active / on-hold / closed |
| I | `closed_date` | |
| J | `drive_folder_url` | *[corrected] — was undocumented* |
| K | `notes` | |

> **[corrected] Column C runs the opposite way to the old doc.** It is a self-populating
> formula deriving the ID *from* the name, and is protected under the name "autofilled":
> ```
> =IFERROR(INDEX(Contacts!A:A, MATCH(D42, Contacts!B:B, 0)), "")
> ```
> Writing to it is unnecessary **and blocked**. See §17.

**Special project:** `GEN-000` "General / No project" — catch-all for company overheads.
Browsable and can hold costs, but **must be excluded from every cross-project rollup**.

**A blank client is meaningful:** it denotes a job taken directly by the company rather
than through an interior designer or main contractor. Not missing data.

### 5.6 Contacts

`contact_id` · `company_name` · `contact_person` · `email` · `whatsapp_number` ·
`contact_types` · `notes`. Types are comma-separated: `client`, `supplier`,
`subcontractor`. Never delete a row. Note row at row 5.

### 5.7 Workers

`worker_id` · `full_name` · `phone_number` · `monthly_basic_salary` · `daily_rate` ·
`ot_hourly_rate` · `levy_amount` · `pay_structure_type` · `join_date` · `status`.
Never change `worker_id`; set `status = inactive` rather than deleting.

### 5.8 Timesheets

`row_id` · `date` · `worker_id` · `worker_name` · `project_code` · `display_address` ·
`regular_hours` · `ot_hours` · `is_rest_day` · `is_public_holiday` · `category` · `notes`.

### 5.9 Receipted expenses  *(renamed from `Expenses`)*

Written by the **Expense PWA**, pushed to Xero. Read-only to the Projects PWA.

| Col | Field | Notes |
|---|---|---|
| A | `expense_id` | See ID format below |
| B | `date` | |
| C | `project_code` | `GEN-000` general, `UNLINKED` freetext |
| D | `display_address` | |
| E | `category` | |
| F | `description` | |
| G | `amount` | |
| H–J | `payee_id`, `payee_name`, `payee_type` | |
| K | `receipt_urls` | Blank — receipts live on the Xero bill |
| L | `submitted_by` | |
| M | `admin_status` | pending / approved / rejected |
| N–O | `approved_by`, `approved_date` | |
| P–R | `xero_bill_id`, `xero_sync_status`, `xero_sync_error` | Script-written |

> **[corrected] Expense IDs are not max+1.** The code uses a row count plus a timestamp
> suffix: `` `EXP-${rowCount}-${Date.now().slice(-4)}` `` — hence `EXP-092-2143`. Row
> count is not deletion-safe; the timestamp makes collisions unlikely in practice.

**Never delete a row here** — the Xero bill would be orphaned. Set `admin_status = rejected`.

**Current state:** 140 rows, ~$13,236. 75 linked to `PRJ-` codes, 54 `GEN-000`, 10 `UNLINKED`.

### 5.10 Project costs  *(new in v3.0)*

**Non-receipted** costs — labour, transport, materials bought without a receipt. Owned by
the **Projects PWA**. **Not linked to Xero.** Header row 1, `ℹ` note row 2, data from row 3.

| Col | Field | Notes |
|---|---|---|
| A | `cost_id` | `PC-0001`, max+1 over surviving rows |
| B | `created_at` | ISO 8601 with `+08:00`; stays text |
| C | `project_code` | FK → Projects |
| D | `display_address` | Snapshot at entry |
| E | `cost_date` | Real date, `d mmm yyyy` |
| F | `cost_type` | `material` \| `labour` \| `transport` |
| G | `category_code` | FK → Categories |
| H | `category_name` | Plain-text snapshot, **not** a formula |
| I | `description` | The row's label in the app |
| J | `amount` | SGD |
| K | `invoiced` | Checkbox |
| L | `invoiced_date` | Stamped on tick, cleared on untick |
| M | `invoice_ref` | Reserved, unused |
| N | `created_by` | PWA user |
| O | `updated_at` | ISO 8601 with `+08:00` |

**Two dimensions by design:** `cost_type` is the nature of the spend, `category_code` the
trade. A plumbing job's labour is `labour` + `PLMB`.

### 5.11–5.14 Invoices / Payments / Payment allocations / Payroll / Reports

Unchanged from v2.1. Payroll formulas use DATE-range matching, not TEXT conversion.

---

## 6. Formula reference

Unchanged from v2.1, with one correction: the `Reports` expense formulas now reference
`'Receipted expenses'` (Sheets rewrote them automatically on rename).

```
is_rest_day:        =IFERROR(IF(TEXT(B2,"dddd")=VLOOKUP(C2,'Rest days'!A:C,3,0),TRUE,FALSE),FALSE)
is_public_holiday:  =IF(COUNTIF('Public holidays'!A:A,B2)>0,TRUE,FALSE)
Projects.client_id: =IFERROR(INDEX(Contacts!A:A, MATCH(D42, Contacts!B:B, 0)), "")
gst_amount:         =H2 * VLOOKUP("GST_RATE", 'System config'!A:B, 2, 0)
unallocated:        =D2 - IFERROR(SUMIF('Payment allocations'!B:B, A2, 'Payment allocations'!E:E), 0)
```

---

## 7. Named ranges reference

> **[corrected] The workbook has ZERO named ranges.** The five previously documented
> (`ActiveProjects`, `ClientContacts`, `SupplierContacts`, `ActiveWorkers`,
> `ActiveCategories`) do not exist and never did. Every consumer filters in code —
> see `app/api/dropdowns/route.js` in the expense PWA and `lib/sheets.js` in both.

---

## 8. Apps Script modules

Bound to the main workbook. `getConfig(key)` scans `System config` by key.

**Auto ID generation (onEdit):** writes the next ID when column A is blank, for
`Projects`, `Contacts`, `Workers`, `Invoices`, `Payments`, `Payment allocations`,
`Timesheets`.

> **onEdit does NOT fire on API writes.** Both PWAs therefore generate their own IDs.
> Expense IDs come from the expense PWA; `PC-` and `PRJ-` codes from the Projects PWA.

> ⚠️ **Unverified:** bound Apps Script cannot be read through the Sheets API. After the
> `Expenses` → `Receipted expenses` rename, check Extensions → Apps Script for the literal
> string `Expenses`.

---

## 9. Expense PWA — screens and API

Next.js 15, App Router, inline styles. PIN auth, `sessionStorage` session.

```
app/
├── page.js              PIN login
├── home/ new/ confirm/ history/
└── api/  auth · dropdowns · submit · attach · history
lib/     google · sheets · session · xero · constants
```

**Env:** `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`,
`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_TENANT_ID`. Xero access/refresh tokens live
in `System config`, not env, because Vercel env vars cannot be written at runtime.

**Submission flow:** generate ID → write row → create Xero draft bill → attach receipts →
write `xero_bill_id` back.

---

## 10. Projects PWA — screens and API

Next.js 16, App Router, inline styles from `lib/theme.js`. PIN auth against the same
`PWA_USER_*` rows; `localStorage` session with a 7-day expiry.

```
app/
├── page.js                 PIN login
├── home/                   recent 5, search, new project
├── projects/               full list, paged client-side
├── projects/[code]/        totals, costs, invoiced toggle, receipted section
├── projects/new/           create project
└── api/  auth · projects · costs · reference
lib/  google · sheets · projects · costs · expenses · rollups · dates ·
      localCache · recents · useProjects · useOnline · session · theme · constants
public/sw.js                service worker (production only)
```

**Env:** the three Google variables only. **No Xero variables.**

**Features:** recent projects (localStorage, per user), punctuation-insensitive search
(`0990` finds `#09-90`), project creation, cost entry with type + category, per-line and
bulk invoiced marking, edit and delete, project totals combining own costs with receipted
spend, offline reads.

---

## 11. Google Doc templates

Unchanged from v2.1. `{{PLACEHOLDER}}` syntax, filled via Find and replace. Never edit the
master — File → Make a copy first.

---

## 12. Xero integration

**One-way push from the Expense PWA only.** Sheets remains the source of truth.

| Field | Value |
|---|---|
| Type | ACCPAY (bill), DRAFT |
| Contact | Matched by `payee_name`, created if absent |
| LineAmountTypes | Inclusive |
| AccountCode | 310 |
| Tracking | `Service` → mapped option |

> **[corrected] Bill references do NOT contain the project code.** The old doc claimed
> `{CategoryName} - {ProjectCode} - {ExpenseID}`. Live references read
> `{receipt number} - {supplier}`, e.g. `2078461 - B&S Painting Materials`.
>
> **Consequence: Xero has no project dimension.** Its only tracking category is `Service`
> (trade). **Per-project spend can only come from the `project_code` column in Sheets.**

**Tracking options under `Service`** (verified 2026-08-09): Carpentry, Cleaning, Company
Vehicle, Disposal, Electrical, General, Hacking, Painting, Partition / Ceiling,
Plastering, Plumbing, Tiling, Worker, Worker Transport.

Option names are **not** the sheet's `category_name` — `CEIL` is "Ceiling & Partition" in
the sheet but "Partition / Ceiling" in Xero. An unmatched name is not fatal: the bill is
created untagged with a warning. `Plastering` has no category row mapped to it.

**Tokens** expire every 30 minutes, are stored in `System config`, and refresh tokens are
single-use. Re-initialise with `node scripts/xero-auth.mjs`.

---

## 13. Status lifecycles

**Receipted expense** — `admin_status`: pending → approved / rejected. `xero_sync_status`:
synced / error.

**Project cost** — `invoiced`: FALSE → TRUE (with `invoiced_date`), reversible.

**Invoice** — draft → sent → partial → paid, plus void and written-off.

**Project** — active / on-hold / closed. *In practice nothing is ever closed: all 39
projects are `active`.*

---

## 14. Role and access matrix

Both current PWA users are `admin`. Neither app enforces role gating today; the Projects
PWA carries `role` on the session so gating can be added without touching auth.

> ⚠️ **Both apps' API routes are unauthenticated.** The PIN gate is client-side only —
> anyone with the deployed URL can call the API directly. Acceptable for internal tools on
> unguessable URLs; revisit before either app exposes payroll or P&L.

---

## 15. Config tab reference

| Key | Who changes | Risk if wrong |
|---|---|---|
| `TAB_*` | Developer | Both apps fall back to a default name, then fail |
| `GST_RATE` | Admin | New invoices miscalculate GST |
| `INVOICE_PREFIX` | Admin | Stale IDs mid-stream |
| `PWA_USER_*` | Admin | Controls login to both apps |
| `XERO_*` | Expense PWA only | Manual edits are overwritten or break rotation |

---

## 16. Constants reference

**Expense PWA** — `GENERAL_PROJECT`, `UNLINKED_PROJECT`, `DEFAULT_PAYEE`, `ADMIN_ROLES`,
`ADMIN_STATUSES`, `XERO_SYNC_STATUSES`, `XERO_ACCOUNT_CODE` (310),
`XERO_TRACKING_CATEGORY` (`Service`), `CATEGORY_TO_TRACKING`.

**Projects PWA** — `SESSION_TTL_DAYS` (7), `ADMIN_ROLES`, `GENERAL_PROJECT_CODE`,
`PROJECT_STATUSES`, `COST_TYPES`, `DEFAULT_COST_TYPE` (`material`), `RECENTS_LIMIT` (5).

Neither holds tab names — those come from `getTab()`.

---

## 17. Writing to Sheets — rules that bite

Every rule here was found by hitting it.

1. **Never `.slice(1)`.** Note rows sit inside data. Filter by ID prefix.
2. **Never write `Projects` column C.** Protected and self-populating. Write `A:B` and `D:K`.
3. **Never insert or delete rows in `Projects`.** Structural changes hit the protected
   column and are rejected — including `insertDataOption: 'INSERT_ROWS'`. Clear values instead.
4. **Never `append` into a tab with a checkbox column.** A checkbox reports `FALSE` on
   every formatted row, so table detection thinks the table is 1000 rows long and writes
   below it — outside the date and currency formatting. Compute the row after the last ID.
5. **Always quote tab names.** `'Receipted expenses'!A:R` is valid; unquoted is a 400.
6. **Always sanitise strings.** A leading `= + - @ |` is parsed as a formula.
7. **Read numerically when sorting or summing.** Formatted reads give display strings, and
   `"10 Aug 2026"` sorts before `"9 Aug 2026"`.
8. **Write dates as ISO `YYYY-MM-DD`**; timestamps as ISO 8601 *with offset* so they stay text.
9. **IDs are max+1 over existing rows**, never row counts.

---

## 18. Known constraints and limitations

| Constraint | Impact | Mitigation |
|---|---|---|
| Sheets has no server-side filtering | Every query reads the whole range | Fetch once, cache, filter client-side |
| Xero has no project dimension | Per-project spend only from Sheets | Documented in §12 |
| Apps Script `onEdit` ignores API writes | IDs must be app-generated | Both apps do this |
| Deleting a `PC-` cost frees its ID for reuse | Only matters if quoted externally | Accepted |
| Deleted costs leave no audit trail | Hard delete was chosen over soft void | One function + one column to change |
| API routes unauthenticated | See §14 | Revisit before payroll data |
| Row selection for `Project costs` is not atomic | Two simultaneous writers could collide | Readback verification returns 409 |
| No offline writes | Costs need a connection | Reads work offline |
| ~5,000 rows | Formula recalculation degrades | Migrate to a database |

---

## 19. Modification playbooks

**Add a worker** — Workers row → Rest days row → `PWA_USER_*` → Payslips tab.

**Remove a worker** — `status = inactive`, delete their `PWA_USER_*` row. Never delete the row.

**Add a category** — Categories row with `active_codes = TRUE` → add to
`CATEGORY_TO_TRACKING` in the expense PWA if a matching Xero option exists → redeploy.
The Projects PWA picks it up with no code change.

**Rename a tab** — ⚠️ ordering matters:
1. Confirm both apps read that tab via `getTab()`
2. Deploy first if either still hardcodes it
3. Rename the tab
4. Update its `TAB_*` key **immediately**
5. Allow ~5 min for the config cache

**Add a column** — rightmost only, never insert in the middle. Update both apps' column
index maps.

---

## 20. Troubleshooting index

| Symptom | Cause | Fix |
|---|---|---|
| Rows appear at row 1001+ | `append` into a checkbox tab | Use row-after-last-ID |
| Dates stored as text | Row written outside the formatted range | Same as above |
| 400 "Unable to parse range" | Unquoted tab name with a space | Use `range()` |
| "Trying to edit a protected cell" | Writing `Projects` column C, or a row insert/delete | Write around it |
| Junk rows in a list | `.slice(1)` instead of ID filtering | Filter by prefix |
| `client_id` blank on a new project | `client_name` doesn't match Contacts exactly | Correct the name |
| Bill created untagged | Category not in `CATEGORY_TO_TRACKING`, or name mismatch | Check §12 |
| Xero 401 | Access token expired, refresh failed | `node scripts/xero-auth.mjs` |
| Sorting looks wrong | Sorting formatted date strings | Read raw, sort ISO |
| Config change not taking effect | ~5-minute cache | Wait or redeploy |
| PWA offline changes lost | No offline writes by design | Reconnect |

---

## 21. Changelog

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2025 | Initial build |
| 2.0 | 2026-06 | Expense PWA + Xero integration; receipts moved to Xero attachments |
| 2.1 | 2026-06 | Expense PWA UX fixes: share sheet, iOS picker, history pagination |
| **3.0** | **2026-08-09** | **Projects PWA built.** New `Project costs` tab and `TAB_PROJECT_COSTS`. `Expenses` renamed to `Receipted expenses`; both apps made config-driven so tab names resolve at runtime. Workbook timezone corrected to Asia/Singapore. Fixed junk note rows leaking into expense history. Corrected the Xero tracking map against the live category list (`WRKR`, `CLEAN` added; `MATL`, `WTRP` removed). Nine documentation corrections — see §22. |

---

## 22. Corrections made in v3.0

Each verified against the live workbook, not inferred.

1. **`Projects.client_id` runs the opposite way** — it is a protected, self-populating
   formula deriving the ID from `client_name`, not a typed value with a name lookup.
2. **Row insertion and deletion fail on `Projects`** — the column C protection rejects
   structural changes. Rows there cannot be deleted via the API at all.
3. **No named ranges exist** — all five previously documented are fictional.
4. **Note rows sit inside data ranges** — `Projects` row 2, `Receipted expenses` row 4.
   This was a live bug in the expense PWA's history, now fixed.
5. **`Categories` column C is `active_codes`**, not `is_active`, and there is no `MATL`
   category.
6. **Xero bill references carry no project code** — so Xero cannot report per-project spend.
7. **Expense IDs are row count + timestamp**, not max+1.
8. **Config keys differed** — `INVOICE_PREFIX` is `INV-2026`; `DRIVE_RECEIPTS_FOLDER_ID`
   was undocumented.
9. **Workbook timezone was America/Los_Angeles** for a Singapore business — every
   `TODAY()`/`NOW()` was up to 15 hours out. Corrected.

---

*Keep this file with the main workbook. Update §21 and §22 whenever the system changes.*
