'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the browser believes it is online.
 *
 * Starts optimistic: navigator.onLine is unavailable during prerender, and assuming
 * offline would flash a warning banner on every cold load. It also only reports whether
 * a network interface exists — a captive portal or a dead server still reads as online,
 * which is why failed requests are handled on their own terms too.
 */
export function useOnline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);

    const goOnline  = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
