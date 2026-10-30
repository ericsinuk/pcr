const CACHE = "pcr-pcn-v2.20";
const ASSETS = ["./", "./index.html", "./app.js", "./pcr-core.js", "./airfields.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Only handle same-origin GETs. Anything else (cross-origin data fetches, and
  // the admin page's POST/PUT calls to the GitHub API) goes straight to the
  // network untouched — a cache can't store those, and routing them through
  // here only added a failure point.
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    // cache:"no-cache" forces revalidation with the server (cheap 304s),
    // so a deploy is picked up on next load instead of heuristic HTTP caching
    fetch(e.request, { cache: "no-cache" })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
