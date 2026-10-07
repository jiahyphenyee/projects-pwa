// The quote PDF for a saved quote or variation order: gathers the quote, its live lines,
// its schedule and the company details from System config into the model
// lib/quotePdf.mjs draws. Used by the download route and by billing, which attaches it to
// the first stage invoice.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadQuote, getConfig } from '@/lib/quotes';
import { renderQuotePdf } from '@/lib/quotePdf.mjs';

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
  const [name, uen, address, phone, email, terms, logo] = await Promise.all([
    getConfig('COMPANY_NAME'), getConfig('COMPANY_UEN'), getConfig('COMPANY_ADDRESS'),
    getConfig('COMPANY_PHONE'), getConfig('COMPANY_EMAIL'), getConfig('QUOTE_TERMS'), readLogo(),
  ]);
  const isVo = quote.kind === 'vo';
  const discount = Math.round((quote.subtotal - quote.contractSum) * 100) / 100;
  const model = {
    heading:  isVo ? `VARIATION ORDER VO${quote.voNumber}` : 'QUOTATION',
    number:   quote.id,
    date:     String(quote.updatedAt || quote.createdAt).slice(0, 10),
    company:  { name: real(name), uen: real(uen), address: real(address), phone: real(phone), email: real(email) },
    client:   project?.clientName || '',
    project:  project?.address || '',
    propertyType: quote.propertyType,
    showUnit: quote.showUnit,
    lines,
    totals: {
      subtotal: quote.subtotal,
      discount,
      discountLabel: quote.discountMode === '%' ? `Discount (${Number(quote.discountValue)}%)` : 'Discount',
      contractSum: quote.contractSum,
    },
    // The schedule as it stands: billed stages at what was invoiced, the rest from the sum
    schedule: isVo ? null : schedule?.stages.map(s => ({ name: s.name, sharePct: s.sharePct, amount: s.amount, isFinal: s.isFinal })),
    terms:    real(terms),
    logo,
  };
  const bytes = await renderQuotePdf(model);
  const fileName = `${isVo ? `VO${quote.voNumber}` : 'Quote'} ${quote.id} - ${project?.address || quote.projectCode}.pdf`
    .replace(/[\\/:*?"<>|#%]+/g, '-');
  return { bytes, fileName, quote };
}
