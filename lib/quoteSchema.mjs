// The shape of the quote and billing tabs, shared by the setup script (which creates them)
// and the server modules (which assert their headers on first use). One place, so the
// sheet and the code cannot drift apart. No imports, so plain Node scripts can load it.
//
// Every tab: header row 1, ℹ note row 2, data from row 3 — the same shape as Project
// costs. No checkbox columns anywhere: booleans are the text TRUE / FALSE, because a
// checkbox column defeats the API's append detection for the whole tab.

export const FIRST_DATA_ROW = 3;

export const QUOTES_COLUMNS = [
  ['id',              'quote_id'],
  ['projectCode',     'project_code'],
  ['kind',            'kind'],               // quote | vo
  ['voNumber',        'vo_number'],          // 1, 2, … for a vo; blank for the quote
  ['propertyType',    'property_type'],      // copied from the project at save time
  ['showUnit',        'show_unit'],
  ['discountMode',    'discount_mode'],      // $ | % | blank
  ['discountValue',   'discount_value'],
  ['subtotal',        'subtotal'],
  ['contractSum',     'contract_sum'],
  ['status',          'status'],             // draft | billed
  ['currentVersion',  'current_version'],    // which Quote lines version is live
  ['nextLineNo',      'next_line_no'],       // per-quote counter; line IDs are never reused
  ['xeroInvoiceId',   'xero_invoice_id'],    // a VO is billed as one invoice
  ['xeroInvoiceNumber', 'xero_invoice_number'],
  ['billedAmount',    'billed_amount'],
  ['billedAt',        'billed_at'],
  ['billedBy',        'billed_by'],
  ['createdAt',       'created_at'],
  ['createdBy',       'created_by'],
  ['updatedAt',       'updated_at'],
  ['updatedBy',       'updated_by'],
  ['issueVersion',    'issue_version'],      // W — the client-facing v1, v2… on the PDF; blank = 1.
                                             // Raised by hand, never by a save: not current_version
  // VO settlement (2026-10-19). Appended, never inserted: the setup script adds them to an
  // existing tab in this order, after W.
  ['voReason',          'vo_reason'],          // X — extra work | omitted | changed | goodwill | blank
  ['voTitle',           'vo_title'],           // Y — the VO's line on the final invoice; blank = first item
  ['settledOnStageId',  'settled_on_stage_id'], // Z — the final stage (ST-…) or progress claim (CLM-…) whose invoice carried it
  // The client's answer to the quote or VO, kept apart from `status` (our billing state).
  ['clientStatus',      'client_status'],      // AA — blank | sent | accepted | declined
  ['clientSentAt',      'client_sent_at'],     // AB — YYYY-MM-DD the quote went to the client
  ['clientAcceptedAt',  'client_accepted_at'], // AC — YYYY-MM-DD the client accepted (or declined)
  // Several quotes per project (2026-11-08). Appended after AC by the setup script.
  ['title',             'title'],              // AD — a quote's name, e.g. "Aircon works"; blank = "Quote Q-…"
  ['trade',             'trade'],              // AE — a quote's Categories code; costs with it land on this quote
  ['parentQuoteId',     'parent_quote_id'],    // AF — a VO's quote; blank = the project's first quote (VOs from before)
];

/** The reasons a variation order can carry, shown in its list. Free to extend; stored as text. */
export const VO_REASONS = ['extra work', 'omitted', 'changed', 'goodwill'];

export const QUOTE_LINES_COLUMNS = [
  ['id',          'line_id'],      // Q-0012-L7: stable across versions of the same quote
  ['quoteId',     'quote_id'],
  ['version',     'version'],      // every save writes a new version; see lib/quotes.js
  ['position',    'position'],
  ['kind',        'kind'],         // item | title
  ['description', 'description'],
  ['service',     'service'],      // Categories.category_code
  ['qty',         'qty'],
  ['unit',        'unit'],
  ['unitPrice',   'unit_price'],
  ['amount',      'amount'],
];

export const PAYMENT_STAGES_COLUMNS = [
  ['id',                'stage_id'],
  ['quoteId',           'quote_id'],
  ['position',          'position'],
  ['name',              'name'],
  ['sharePct',          'share_pct'],
  ['isFinal',           'is_final'],
  ['billedAmount',      'billed_amount'],
  ['billedAt',          'billed_at'],
  ['billedBy',          'billed_by'],
  ['xeroInvoiceId',     'xero_invoice_id'],
  ['xeroInvoiceNumber', 'xero_invoice_number'],
  ['xeroSyncStatus',    'xero_sync_status'],   // blank | sending:<claim token> | billed | error (number kept = outcome unknown)
  ['quoteVersion',      'quote_version'],      // the lines version live when it was billed
  ['updatedAt',         'updated_at'],
  ['pdfAttachedAt',     'pdf_attached_at'],    // O — the quote PDF went onto this stage's invoice
];

// Progress claims (Proposal 03, 2026-10-27): one row per claim on a main quote.
export const PROGRESS_CLAIMS_COLUMNS = [
  ['id',                'claim_id'],           // CLM-0001
  ['quoteId',           'quote_id'],
  ['claimNo',           'claim_no'],           // 1, 2, … per quote
  ['pctDone',           'pct_done'],           // % of the work done, 0–100
  ['contractSum',       'contract_sum'],       // the main quote's contract sum when claimed
  ['grossToDate',       'gross_to_date'],      // pct_done × contract_sum
  ['billedBefore',      'billed_before'],      // main quote already billed (stages + earlier claims)
  ['mainAmount',        'main_amount'],        // gross_to_date − billed_before
  ['voIds',             'vo_ids'],             // VOs on this claim, comma separated, full amounts
  ['voAmount',          'vo_amount'],
  ['total',             'total'],              // main_amount + vo_amount: the invoice total
  ['xeroInvoiceId',     'xero_invoice_id'],
  ['xeroInvoiceNumber', 'xero_invoice_number'],
  ['xeroSyncStatus',    'xero_sync_status'],   // sending:<token> | billed | error (number kept = outcome unknown) | cancelled
  ['billedAt',          'billed_at'],
  ['billedBy',          'billed_by'],
  ['createdAt',         'created_at'],
  ['createdBy',         'created_by'],
  ['updatedAt',         'updated_at'],
];

export const PRICE_HISTORY_COLUMNS = [
  ['id',            'history_id'],
  ['description',   'description'],
  ['service',       'service'],
  ['unit',          'unit'],
  ['unitPrice',     'unit_price'],
  ['qty',           'qty'],
  ['propertyType',  'property_type'],
  ['client',        'client'],
  ['quotedAt',      'quoted_at'],
  ['source',        'source'],            // quote | vo | xero_import
  ['quoteId',       'quote_id'],
  ['lineId',        'line_id'],           // upsert key for quote and vo rows
  ['xeroInvoiceId', 'xero_invoice_id'],
  ['xeroLineId',    'xero_line_id'],      // upsert key for imported rows
];

const headersOf = cols => cols.map(([, h]) => h);

export const QUOTE_TAB_SPECS = [
  {
    key: 'QUOTES', configKey: 'TAB_QUOTES', title: 'Quotes',
    headers: headersOf(QUOTES_COLUMNS),
    note: 'ℹ  One row per quote or variation order. Written by the Projects PWA only — do not edit by hand. Money columns are plain numbers, no GST.',
  },
  {
    key: 'QUOTE_LINES', configKey: 'TAB_QUOTE_LINES', title: 'Quote lines',
    headers: headersOf(QUOTE_LINES_COLUMNS),
    note: 'ℹ  Every version of every quote\'s lines. Only the version named in Quotes.current_version is live; older ones are kept while a billed invoice refers to them. Written by the Projects PWA only.',
  },
  {
    key: 'PAYMENT_STAGES', configKey: 'TAB_PAYMENT_STAGES', title: 'Payment stages',
    headers: headersOf(PAYMENT_STAGES_COLUMNS),
    note: 'ℹ  One row per stage of a quote\'s payment schedule. A row with an xero_invoice_id has been invoiced and is locked. Written by the Projects PWA only.',
  },
  {
    key: 'PROGRESS_CLAIMS', configKey: 'TAB_PROGRESS_CLAIMS', title: 'Progress claims',
    headers: headersOf(PROGRESS_CLAIMS_COLUMNS),
    note: 'ℹ  One row per progress claim (bill by % of work done). A row with an xero_invoice_id has been invoiced and is locked; cancelled rows never reached Xero. Written by the Projects PWA only.',
  },
  {
    key: 'PRICE_HISTORY', configKey: 'TAB_PRICE_HISTORY', title: 'Price history',
    headers: headersOf(PRICE_HISTORY_COLUMNS),
    note: 'ℹ  Every item ever quoted or invoiced, for price suggestions. Rows with a blank property_type come from past Xero invoices and are shown for reference only.',
  },
];

// Quote-feature settings held in the workbook, not in code. Blank STAGE_TRACKING_OPTION
// means stage invoices carry no Service tracking (William, 2026-10-06).
export const QUOTE_CONFIG_DEFAULTS = {
  // Company details and T&Cs printed on the quote PDF. Blank lines are left off the PDF.
  // COMPANY_ADDRESS is no longer printed (JY, 2026-10-16) but stays for anything else that reads it.
  COMPANY_ADDRESS:         '',
  COMPANY_PHONE:           '',
  COMPANY_EMAIL:           '',
  QUOTE_TERMS:             '',
  QUOTE_VALIDITY_DAYS:     '',   // "This quotation is valid for N days." before the T&Cs; blank = not printed
  QUOTE_FILE_PREFIX:       'HFC',  // PDF file names: HFCQuote_v1_<address>.pdf, HFCVO1_<address>.pdf
  XERO_SALES_ACCOUNT_CODE: '200',
  INVOICE_DUE_DAYS:        '14',
  QUOTE_UNITS:             'pcs, sqft, ft run, lot, room, lumpsum',
  QUOTE_PROPERTY_TYPES:    'HDB, Condo, Commercial',
  STAGE_TRACKING_OPTION:   '',
};

export const OBSOLETE_TABS = ['Invoices', 'Payments', 'Payment allocations', 'Reports'];
export const OBSOLETE_CONFIG_KEYS = [
  'TAB_INVOICES', 'TAB_PAYMENTS', 'TAB_ALLOCATIONS', 'TAB_REPORTS', 'INVOICE_PREFIX', 'GST_RATE',
];

export const PROJECTS_PROPERTY_TYPE_HEADER = 'property_type';
export const CATEGORIES_TRACKING_HEADER    = 'xero_tracking_option';
// Project costs O (2026-11-08): the quote a cost counts towards when picked by hand. Must
// match the last entry of COLUMNS in lib/costs.js, which asserts it.
export const PROJECT_COSTS_QUOTE_HEADER    = 'quote_id';

// Category code → Xero "Service" tracking option name. Seeds the Categories column once;
// after that the column is the source of truth and this map is not read by the app.
// From expense-pwa/lib/constants.js (verified against Xero 2026-08-09) plus AIRC, which
// that map was missing although Xero has an "Aircon" option (checked 2026-10-05).
export const CATEGORY_TO_TRACKING = {
  PLMB:  'Plumbing',
  TILE:  'Tiling',
  PAINT: 'Painting',
  ELEC:  'Electrical',
  CARP:  'Carpentry',
  HACK:  'Hacking',
  GENL:  'General',
  DISP:  'Disposal',
  CEIL:  'Partition / Ceiling',
  AIRC:  'Aircon',
  WRKR:  'Worker',
  TRANS: 'Worker Transport',
  CLEAN: 'Cleaning',
  VEHIC: 'Company Vehicle',
  OTHR:  null,
};
