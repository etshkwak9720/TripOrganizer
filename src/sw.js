/* Minimal offline-first service worker.
 * Written by hand instead of workbox's generateSW: the generated worker failed
 * to evaluate in this Vite build (split-chunk AMD factory never ran; the
 * inlined variant threw on evaluation), so precaching silently never happened.
 * vite-plugin-pwa (injectManifest) replaces self.__WB_MANIFEST below.
 */
/* eslint-disable no-restricted-globals */
const MANIFEST = self.__WB_MANIFEST || [];
const ASSETS = [...new Set(MANIFEST.map((e) => (typeof e === 'string' ? e : e.url)))];

// Cache name must change whenever the build does, otherwise `activate` keeps
// the previous cache and stale hashed assets are served forever.
const BUILD_ID = ASSETS.join('|').split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
const CACHE = `yeojeong-precache-${BUILD_ID}`;

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

  // ignoreSearch below would let one query's API response answer another's.
  if (new URL(req.url).pathname.startsWith('/api/')) return;

  // ignoreVary: the SW's install fetch sends no Origin header while page
  // requests do, so a `Vary: Origin` response would otherwise never match.
  const MATCH = { ignoreSearch: true, ignoreVary: true };

  // SPA navigations -> network first, so a new deploy's index.html (which
  // points at freshly hashed assets) always wins over the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(CACHE);
            await cache.put('index.html', res.clone());
          }
          return res;
        } catch {
          return (await caches.match('index.html', MATCH)) || new Response('offline', { status: 503 });
        }
      })(),
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
    // Tile <img> requests are cross-origin and un-annotated (no crossorigin
    // attribute), so the browser would normally fetch them in 'no-cors' mode,
    // giving the SW an *opaque* Response (status 0, res.ok always false) that
    // hides the real HTTP status — a transient 429/500 tile would then look
    // identical to a 200 and get cached forever. The OSM tile server sends
    // `Access-Control-Allow-Origin: *`, so we re-issue the request ourselves
    // as a CORS fetch to read the real status before deciding to cache.
    const res = await fetch(req.url, { mode: 'cors' });
    if (res.ok) {
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
