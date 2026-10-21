/* ============================================================
 * Offline cache for the installable web app (only when BLOCKFIRE
 * is served over http(s); file:// never registers it).
 *
 * Every file the game loads from its own site is kept in the cache.
 * Requests are answered from the cache straight away (so the game
 * starts offline) and refreshed from the network in the background,
 * so the next launch picks up a new version. Other sites (the online
 * matchmaking server) are never cached.
 * ============================================================ */
const CACHE = 'blockfire-v9';   // bump when the files change shape (new scripts, new assets)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || new Response('Offline', { status: 503 });
  }));
});
