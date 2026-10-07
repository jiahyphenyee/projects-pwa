'use client';

// The project's quote and its payment schedule. The screen itself is QuoteScreen, shared
// with variation orders.

import { use } from 'react';
import QuoteScreen from '@/app/components/quote/QuoteScreen';

export default function QuotePage({ params }) {
  const { code } = use(params);
  return <QuoteScreen code={decodeURIComponent(code)} />;
}
