/* Service Worker: macht die App offlinefähig (nur beim Betrieb über http/https). */
const CACHE = 'rechnung-v1';
const DATEIEN = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ereignis) => {
  if (ereignis.request.method !== 'GET') return;
  ereignis.respondWith(
    fetch(ereignis.request)
      .then((antwort) => {
        const kopie = antwort.clone();
        caches.open(CACHE).then((cache) => cache.put(ereignis.request, kopie)).catch(() => {});
        return antwort;
      })
      .catch(() => caches.match(ereignis.request).then((treffer) => treffer || caches.match('./index.html'))),
  );
});
