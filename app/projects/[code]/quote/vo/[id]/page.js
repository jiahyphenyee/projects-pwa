'use client';

// A variation order: the same editor as the quote, billed in full as its own invoice.
// `id` is the VO's quote_id, or "new" for a blank one that is numbered on first save; a new
// one takes ?parent=<quote id> for the quote it changes.

import { use } from 'react';
import QuoteScreen from '@/app/components/quote/QuoteScreen';

export default function VariationOrderPage({ params, searchParams }) {
  const { code, id } = use(params);
  // A new VO names its quote: vo/new?parent=Q-0011 (else the project's first quote)
  const { parent } = use(searchParams);
  return <QuoteScreen code={decodeURIComponent(code)} voId={decodeURIComponent(id)} parentId={parent || undefined} />;
}
