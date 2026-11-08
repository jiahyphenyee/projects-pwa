// Several quotes per project (billing-redesign-brief.md, phase 2). A project holds any number
// of quotes (kind "quote"), one per agreed piece of work, each with its own VOs, stages,
// claims and invoices. A VO belongs to the quote named in its parent_quote_id. VOs saved
// before 2026-11-08 have none: they belong to the project's FIRST quote, which was the only
// one a project could have then. Pure, so it is tested with node --test.

const byId = (a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true });

/** A project's quotes (not VOs), oldest first. */
export function projectQuotes(quotes, projectCode) {
  return quotes.filter(q => q.projectCode === projectCode && q.kind === 'quote').sort(byId);
}

/** The project's first quote, or null. The default when nothing names a quote. */
export function firstQuote(quotes, projectCode) {
  return projectQuotes(quotes, projectCode)[0] || null;
}

/** The quote a VO belongs to: its parent_quote_id on the same project, else the project's first quote. */
export function parentOf(vo, quotes) {
  if (!vo) return null;
  const mine = projectQuotes(quotes, vo.projectCode);
  return mine.find(q => q.id === vo.parentQuoteId) || mine[0] || null;
}

/** A quote's VOs by number. `quote` is the quote row (or its id with `quotes` giving the rest). */
export function vosOf(quotes, quote) {
  if (!quote) return [];
  return quotes
    .filter(q => q.kind === 'vo' && q.projectCode === quote.projectCode && parentOf(q, quotes)?.id === quote.id)
    .sort((a, b) => (a.voNumber ?? 0) - (b.voNumber ?? 0));
}

/** How a quote is named on screen: its title, else "Quote Q-0011". */
export function quoteLabel(quote) {
  if (!quote) return '';
  return String(quote.title || '').trim() || `Quote ${quote.id}`;
}
