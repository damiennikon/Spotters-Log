/* Photo Log SW 0.6.4.12-ios-layout-20261121 */
const CACHE = "photolog-0.6.4.12-ios-layout-20261121";
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./dialogs.css?v=20261121-ios-layout",
  "./dialogs.js?v=20261121-ios-layout",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
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
      Promise.all(keys.map((k) => (k.startsWith("photolog-") && k !== CACHE ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigations, cache-first for everything else.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

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
