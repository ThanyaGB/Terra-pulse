/* Vayu-Swachh service worker.
 *  - app shell + built assets: cache-first (hashed filenames never change)
 *  - navigations: network-first, falling back to the cached shell so /citizen opens offline
 *  - GET /api/* (citizen snapshot, advice, areas): network-first, falling back to the last good response
 * The citizen app also keeps its own copy of the last AQI snapshot and advice in localStorage.
 */
const VERSION = 'v1';
const SHELL = `vs-shell-${VERSION}`;
const ASSETS = `vs-assets-${VERSION}`;
const DATA = `vs-data-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(request)) || (fallbackUrl ? await caches.match(fallbackUrl) : undefined) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, '/'));
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA));
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.woff2')) {
    event.respondWith(cacheFirst(request, ASSETS));
  }
});
