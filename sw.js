// Offline shell. Local files are served from the cache first and refreshed in
// the background; template and font requests always go to the network.

const CACHE = 'memeforge-v5';

const SHELL = [
  './',
  './index.html',
  './app.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/workbench.js',
  './js/advanced.js',
  './js/creative.js',
  './js/flashbang.js',
  './js/studio.js',
  './js/panels.js',
  './js/inspector.js',
  './js/sources.js',
  './js/fonts.js',
  './js/store.js',
  './js/media.js',
  './js/util.js',
  './vendor/fabric.min.mjs',
  './vendor/fuse.min.mjs',
  './vendor/gifuct.mjs',
  './vendor/idb-keyval.mjs',
  './vendor/sortable.esm.js',
  './vendor/gif.js',
  './vendor/gif.worker.js',
  './vendor/fonts/archivo-latin-wght-normal.woff2',
  './vendor/fonts/anton-latin-400-normal.woff2',
  './vendor/fonts/ibm-plex-mono-latin-400-normal.woff2',
  './vendor/fonts/ibm-plex-mono-latin-500-normal.woff2',
  './assets/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // templates, fonts, feeds

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((cache) => cache.put(request, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
