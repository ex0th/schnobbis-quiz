// Schnobbis Quiz – Service Worker
// Build-ID und Asset-Liste setzt der Server beim Start ein (Hash über alle Dateien) –
// keine Versionsnummer mehr von Hand hochzählen.
const CACHE = 'schnobbis-quiz-__BUILD_ID__';
const ASSETS = '__ASSETS__';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Einzeln cachen: eine fehlende Datei darf nicht die ganze Installation kippen
    await Promise.all(ASSETS.map(a => c.add(a).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Netzwerk zuerst (immer aktuell), offline aus dem Cache. API und WebSocket nie cachen.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname === '/healthz') return;
  const isPage = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && !isPage) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(isPage ? '/' : e.request, { ignoreSearch: true })) || caches.match('/'))
  );
});
