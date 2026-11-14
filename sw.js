/* ==========================================================================
   sw.js — service worker: makes the app load instantly and work offline.

   How updates work: the browser re-downloads this file in the background.
   If ANY byte differs, the new worker installs, re-caches every app file,
   and takes over. So after changing any app file:

       >>> bump CACHE_VERSION on every deploy <<<

   (Your peeps and counts are in IndexedDB, not in this cache, so bumping
   the version never touches your data.)
   ========================================================================== */

const CACHE_VERSION = 'v3';
const CACHE_NAME = `kid-tally-${CACHE_VERSION}`;

// Every file the app needs, as relative URLs (works under /<repo>/ on Pages).
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'db.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

// Install: download and cache all app files, then activate straight away.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' skips the browser's HTTP cache, so we really get the new files.
    await cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

// Activate: delete caches from older versions, then take control of open pages.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('kid-tally-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Fetch: answer from the cache first, fall back to the network.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (err) {
      // Offline and not cached: for page loads, fall back to the app shell.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

// Lets the page ask which version is running (shown at the bottom of the app).
self.addEventListener('message', event => {
  if (event.data === 'version' && event.ports[0]) event.ports[0].postMessage(CACHE_VERSION);
});
