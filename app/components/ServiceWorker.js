'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker in production only.
 *
 * Deliberately not in development: the dev server serves unhashed, constantly changing
 * assets, and a caching worker in front of that produces stale-module errors that look
 * like real bugs. To exercise offline behaviour locally, run `npm run build && npm start`.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        // Offline caching is an enhancement — the app works fine without it
        console.warn('Service worker registration failed:', err.message);
      });
    };

    // Wait for load so registration never competes with the first render
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
