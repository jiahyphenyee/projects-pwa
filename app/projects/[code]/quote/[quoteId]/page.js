'use client';

// One of the project's quotes, by id; "new" for a blank quote. /projects/<code>/quote
// (no id) opens the project's first quote, as it always has.

import { use } from 'react';
import QuoteScreen from '@/app/components/quote/QuoteScreen';

export default function OneQuotePage({ params }) {
  const { code, quoteId } = use(params);
  return <QuoteScreen code={decodeURIComponent(code)} quoteId={decodeURIComponent(quoteId)} />;
}
