'use client';

// A variation order: the same editor as the quote, billed in full as its own invoice.
// `id` is the VO's quote_id, or "new" for a blank one that is numbered on first save.

import { use } from 'react';
import QuoteScreen from '@/app/components/quote/QuoteScreen';

export default function VariationOrderPage({ params }) {
  const { code, id } = use(params);
  return <QuoteScreen code={decodeURIComponent(code)} voId={decodeURIComponent(id)} />;
}
