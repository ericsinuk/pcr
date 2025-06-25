self.addEventListener("install", e => {
  e.waitUntil(
    caches.open("pcr-pcn-cache").then(cache => cache.addAll([
      "/",
      "/index.html",
      "/app.js",
      "/manifest.webmanifest"
    ]))
  );
});
self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(response => response || fetch(e.request))
  );
});
