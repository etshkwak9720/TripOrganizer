/* Minimal offline-first service worker.
 * Written by hand instead of workbox's generateSW: the generated worker failed
 * to evaluate in this Vite build (split-chunk AMD factory never ran; the
 * inlined variant threw on evaluation), so precaching silently never happened.
 * vite-plugin-pwa (injectManifest) replaces self.__WB_MANIFEST below.
 */
/* eslint-disable no-restricted-globals */
const CACHE = 'yeojeong-precache-v1';
const MANIFEST = self.__WB_MANIFEST || [];
const ASSETS = [...new Set(MANIFEST.map((e) => (typeof e === 'string' ? e : e.url)))];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // add one-by-one so a single failure can't abort the whole install
      await Promise.all(
        ASSETS.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res.ok) await cache.put(url, res);
          } catch { /* skip un-cacheable asset */ }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // OSM tiles: cache-first with a size cap, so previously-seen map areas
  // keep working offline.
  if (req.method === 'GET' && /tile\.openstreetmap\.org/.test(req.url)) {
    event.respondWith(tileCacheFirst(req));
    return;
  }

  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // ignoreVary: the SW's install fetch sends no Origin header while page
  // requests do, so a `Vary: Origin` response would otherwise never match.
  const MATCH = { ignoreSearch: true, ignoreVary: true };

  // SPA navigations -> cached app shell
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => (await caches.match('index.html', MATCH)) || fetch(req).catch(() => new Response('offline', { status: 503 })))(),
    );
    return;
  }

  // cache-first for everything precached, fall back to network
  event.respondWith(
    (async () => {
      const hit = await caches.match(req, MATCH);
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch {
        return new Response('', { status: 504 });
      }
    })(),
  );
});

const TILE_CACHE = 'osm-tiles-v1';
const TILE_MAX = 300;

async function tileCacheFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Tile <img> requests are cross-origin and un-annotated (no crossorigin
    // attribute), so the browser fetches them in 'no-cors' mode and the SW
    // sees an *opaque* Response: status 0, res.ok is always false even on a
    // real 200. Caching must key off res.type instead, or tiles are silently
    // never cached (verified empirically against the real tile server).
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > TILE_MAX) {
        await Promise.all(keys.slice(0, keys.length - TILE_MAX).map((k) => cache.delete(k)));
      }
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}
