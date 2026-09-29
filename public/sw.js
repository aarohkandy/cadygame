// public/sw.js (WP-D, SCOPE 4.2)
// TORQUE LIMIT service worker. The game makes no network calls once it is running, so "works offline" is
// entirely a question of whether its files are on disk: the app shell, mujoco.wasm, the MJCF/STL arena and
// robot models, and the .woff faces. This worker puts all of them in one versioned cache at install, then
// serves same-origin GETs from it.
//
// The two placeholders below are filled in by scripts/app-sw.mjs against the real export, because the hashed
// chunk names only exist after the build. An unstamped copy (the one `next dev` serves from /public) keeps
// working: it precaches nothing and falls back to runtime caching, which is the right behaviour in dev.
const BUILD_ID = "__TL_BUILD_ID__";
const PRECACHE = /* __TL_PRECACHE__ */ { shell: [], bulk: [] };

const CACHE = `torque-limit-${BUILD_ID}`;
// The prerendered entry point. Every navigation resolves to it: the game is one client route.
const SHELL_URL = "./index.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The shell is the game. If any of it fails to cache, the install must fail so the previous worker (and
    // its complete cache) stays in charge rather than a half-populated one taking over.
    if (PRECACHE.shell.length > 0) await cache.addAll(PRECACHE.shell);
    // The bulk tier is tens of megabytes of physics and geometry. One failed request there must not cost the
    // player their offline install, so these are added individually and retried later by the fetch handler.
    const failed = [];
    await Promise.all(PRECACHE.bulk.map(async (url) => {
      try {
        // Plain cache.add, NOT { cache: "reload" }. "reload" bypasses the HTTP cache, so on a first visit the
        // worker re-downloaded the entire bulk tier — tens of MB — a second time while the page's own boot
        // fetches were still in flight, roughly doubling first-visit load. The cache key already carries
        // BUILD_ID and chunk names are content-hashed, so freshness never depended on "reload".
        await cache.add(url);
      } catch {
        failed.push(url);
      }
    }));
    if (failed.length > 0) console.warn(`[tl-sw] ${failed.length} asset(s) not precached; will cache on first use`, failed.slice(0, 5));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n.startsWith("torque-limit-") && n !== CACHE ? caches.delete(n) : undefined)));
    await self.clients.claim();
  })());
});

// A new build is installed but waiting. The page asks for the swap explicitly (pwa-register.tsx does it only
// when nothing is in play), so a deploy can never reload the tab mid-match.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "TL_SKIP_WAITING") void self.skipWaiting();
});

/** Same-origin GETs are the only thing this worker owns; everything else goes straight to the network. */
function isCacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // Range requests (media seeking) must not be answered from a whole-file cache entry.
  return !request.headers.has("range");
}

/**
 * Replays a cached response as a brand-new one. A Response taken out of the Cache API carries the URL it was
 * stored under, and a worker takes its location from the response URL — so handing the stored object straight
 * to a worker request drops whatever the app put in the URL's query or fragment. Next's worker entry point
 * reads its bootstrap config from exactly there (`turbopack-worker-<hash>.js#params=...`), and without this
 * every worker started offline threw "Missing worker bootstrap config". A synthesized Response has no URL of
 * its own, so the worker keeps the URL it was constructed with.
 */
async function replay(response) {
  return new Response(await response.blob(), { status: 200, statusText: "OK", headers: response.headers });
}

const CARRIES_URL_STATE = new Set(["worker", "sharedworker"]);

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return CARRIES_URL_STATE.has(request.destination) ? replay(hit) : hit;
  try {
    const response = await fetch(request);
    // Opaque and error responses are never stored: caching a 404 for mujoco.wasm would brick every later load.
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  } catch (offline) {
    // Offline, and the exact URL is not in the cache. Chunk names are content-hashed, so an entry that differs
    // only in its query string is the same file, and replaying it keeps the query the caller asked for.
    const sameFile = await cache.match(request, { ignoreSearch: true });
    if (sameFile) return replay(sameFile);
    throw offline;
  }
}

async function navigationResponse(request) {
  const cache = await caches.open(CACHE);
  try {
    // Online, prefer the network so a redeploy is seen immediately; the export is one small HTML file.
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(SHELL_URL, response.clone());
      return response;
    }
  } catch {
    // Offline: fall through to the cached shell.
  }
  const cached = await cache.match(SHELL_URL) || await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  return new Response("TORQUE LIMIT is offline and has not been installed yet.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }
  if (!isCacheable(request)) return;
  event.respondWith(cacheFirst(request));
});
