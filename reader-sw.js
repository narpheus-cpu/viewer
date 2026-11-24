/* App files only. User books remain in the reader's existing local database. */
const CACHE = 'ebook-reader-app-mobile-22';
const CORE = [
  './manifest.webmanifest', './reader-app.webmanifest', './reader-pwa.css?v=1', './reader-pwa.js?v=4',
  './icons/reader.svg', './icons/reader-192.png', './icons/reader-512.png', './icons/reader-maskable-512.png',
  './sounds/standalone-title.mp3', './sounds/bracket-title.mp3', './sounds/quote-revised.mp3', './sounds/summary.mp3',
  './', './index.html', './reader-speech.js?v=21', './reader-speech.css?v=8',
  './reader-insights.css?v=9', './reader-insights-data.js?v=15',
  './reader-insights.js?v=15', './reader-insights-nav.js?v=11',
  './supertonic3/browser-worker.mjs?v=3', './supertonic3/asset-list.mjs', './supertonic3/upstream.mjs?v=2',
  './supertonic3/runtime/ort.wasm.min.mjs', './supertonic3/runtime/ort-wasm-simd-threaded.mjs'
];
addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE.map(path => new Request(new URL(path,location.href),{cache:'reload'})));
  await skipWaiting();
})()));
addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys())
    if (key.startsWith('ebook-reader-app-') && key !== CACHE) await caches.delete(key);
  await clients.claim();
})()));
addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin ||
      !url.pathname.startsWith(new URL('./', location.href).pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    if (event.request.mode !== 'navigate' && hit) return hit;
    try {
      const response = await fetch(event.request,event.request.mode === 'navigate' ? {cache:'no-cache'} : undefined);
      if (response.ok && (event.request.mode === 'navigate' ||
          /\.(?:js|mjs|css|json)$/.test(url.pathname))) await cache.put(event.request,response.clone());
      return response;
    } catch (error) {
      if (hit) return hit;
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw error;
    }
  })());
});

