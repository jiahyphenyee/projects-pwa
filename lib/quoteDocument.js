// The quote PDF for a saved quote or variation order: gathers the quote, its live lines,
// its schedule and the company details from System config into the model
// lib/quotePdf.mjs draws. Used by the download route and by billing, which attaches it to
// the first stage invoice.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadQuote, getConfig } from '@/lib/quotes';
import { renderQuotePdf, quoteFileName } from '@/lib/quotePdf.mjs';

async function readLogo() {
  for (const name of ['quote-logo.png', 'quote-logo.jpg', 'quote-logo.jpeg']) {
    try { return await readFile(path.join(process.cwd(), 'assets', name)); } catch { /* try the next */ }
  }
  return null;
}

/** Treat the "[UEN Number]" style placeholders in System config as not set. */
const real = v => {
  const t = String(v ?? '').trim();
  return /^\[.*\]$/.test(t) ? '' : t;
};

export async function buildQuotePdf(quoteId) {
  const loaded = await loadQuote(quoteId);
  if (!loaded) return null;
  const { quote, lines, project, schedule } = loaded;
  const [name, uen, phone, email, terms, validityDays, filePrefix, logo] = await Promise.all([
    getConfig('COMPANY_NAME'), getConfig('COMPANY_UEN'),
    getConfig('COMPANY_PHONE'), getConfig('COMPANY_EMAIL'), getConfig('QUOTE_TERMS'),
    getConfig('QUOTE_VALIDITY_DAYS'), getConfig('QUOTE_FILE_PREFIX'), readLogo(),
  ]);
  const date = String(quote.updatedAt || quote.createdAt).slice(0, 10);
  const days = Number(real(validityDays));
  const isVo = quote.kind === 'vo';
  const discount = Math.round((quote.subtotal - quote.contractSum) * 100) / 100;
  const model = {
    heading:  isVo ? `VARIATION ORDER VO${quote.voNumber}` : 'QUOTATION',
    // The client-facing version, raised by hand on the quote screen. A VO is named by its
    // VO number alone: the Q-number is an internal key and means nothing to a client.
    version:  isVo ? '' : `v${quote.issueVersion}`,
    date,
    validityDays: Number.isFinite(days) && days > 0 ? days : 0,
    company:  { name: real(name), uen: real(uen), phone: real(phone), email: real(email) },
    client:   project?.clientName || '',
    project:  project?.address || '',
    showUnit: quote.showUnit,
    lines,
    totals: {
      subtotal: quote.subtotal,
      discount,
      discountLabel: quote.discountMode === '%' ? `Discount (${Number(quote.discountValue)}%)` : 'Discount',
      contractSum: quote.contractSum,
    },
    // The schedule as it stands: billed stages at what was invoiced, the rest from the sum.
    // The final payment prints its balance of the quote, not the VOs it will also settle:
    // the quote PDF is the client's quote, and variation orders have their own.
    schedule: isVo ? null : schedule?.stages.map(s => ({
      name: s.name, sharePct: s.sharePct, isFinal: s.isFinal,
      amount: s.isFinal && s.balance !== undefined ? s.balance : s.amount,
    })),
    terms:    real(terms),
    logo,
  };
  const bytes = await renderQuotePdf(model);
  const fileName = quoteFileName({
    prefix: real(filePrefix) || 'HFC', kind: quote.kind, voNumber: quote.voNumber,
    issueVersion: quote.issueVersion, address: project?.address || quote.projectCode,
  });
  return { bytes, fileName, quote };
}

/**
 * What the PDF will be missing, in words for the quote screen, so a gap is seen before a
 * quote goes to a client rather than after. Empty when everything is set.
 */
export async function pdfSetupGaps() {
  const [uen, terms, validity, logo] = await Promise.all([
    getConfig('COMPANY_UEN'), getConfig('QUOTE_TERMS'), getConfig('QUOTE_VALIDITY_DAYS'), readLogo(),
  ]);
  const gaps = [];
  if (!logo) gaps.push('logo (assets/quote-logo.png)');
  if (!real(terms)) gaps.push('T&Cs (QUOTE_TERMS)');
  if (!(Number(real(validity)) > 0)) gaps.push('validity (QUOTE_VALIDITY_DAYS)');
  if (!real(uen)) gaps.push('UEN (COMPANY_UEN)');
  return gaps;
}
