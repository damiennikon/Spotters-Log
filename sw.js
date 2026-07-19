/* Photo Log SW 0.6.3.1 */
const CACHE = "photolog-0.6.4.8";
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigations, cache-first for everything else.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Never cache the proxy endpoint (always hit network).
  if (url.pathname.endsWith("/proxy.php") || url.pathname.endsWith("/proxy.ph1")) {
    e.respondWith(fetch(req));
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});