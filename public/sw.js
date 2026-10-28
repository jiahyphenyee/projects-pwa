// Hand-written service worker. next-pwa is not maintained against the current App
// Router, and the caching this app needs is about sixty lines.
//
// Bump CACHE_VERSION on any change to this file — the name is what invalidates old
// caches, and a stale shell paired with fresh chunks is the classic PWA failure.

const CACHE_VERSION = 'v5';
const CACHE = `projects-pwa-${CACHE_VERSION}`;

// Screens worth having available cold. Data still comes from the API caches below.
const SHELL = [
  '/', '/home', '/projects', '/manifest.json',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one 404 cannot fail the whole install
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Cache-first: hashed build assets never change under a given URL. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Network-first with a cached fallback. Used for pages and API reads, so a connected
 * user always sees live data and an offline one sees the last copy rather than an error.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;

    // A navigation with nothing cached for this exact URL still beats a browser error
    if (request.mode === 'navigate') {
      const shell = await caches.match('/home') || await caches.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never touch cross-origin, and never cache anything that changes state
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return;

  // Auth must always hit the network — a cached identity is a security problem
  if (url.pathname.startsWith('/api/auth')) return;

  // Invoice PDFs come live from Xero. A cached copy offline could be a draft that has
  // since changed, with nothing to say it is stale — so never cache them.
  if (url.pathname.startsWith('/api/invoices/pdf')) return;
  // Receipts come from Xero on demand and are never kept by the app
  if (url.pathname.startsWith('/api/costs/receipt')) return;
  // Same for Xero quote PDFs.
  if (url.pathname.startsWith('/api/quotes/xero') && url.searchParams.has('pdf')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Page navigations, and the RSC payloads client-side routing fetches
  if (request.mode === 'navigate' || url.searchParams.has('_rsc')) {
    event.respondWith(networkFirst(request));
  }
});
