/* Al-Haytham Library — service worker offline */
const CACHE_NAME = "al-haytham-library-v1";

/* Install: pre-cache aset pdf.js dan halaman utama (tahan gagal per item). */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try { await cache.add("/pdf.worker.min.mjs"); } catch (error) { /* abaikan */ }
      try { await cache.add("/"); } catch (error) { /* abaikan */ }
    }).then(() => self.skipWaiting())
  );
});

/* Handle skip-waiting message from client. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* Activate: bersihkan cache lama dan langsung menguasai halaman. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const cachePut = (response) => {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined));
  };

  /* Worker pdf.js / wasm: cache-first (kunci agar flipbook jalan offline). */
  if (url.pathname.includes("pdf.worker") || url.pathname.endsWith(".wasm")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          event.waitUntil(fetch(request).then(cachePut).catch(() => undefined));
          return cached;
        }
        return fetch(request).then((response) => {
          if (response.ok) cachePut(response);
          return response;
        });
      })
    );
    return;
  }

  /* Navigasi halaman: network-first, fallback ke cache. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) cachePut(response);
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  /* Aset lain (JS, CSS, gambar): stale-while-revalidate. */
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cachePut(response);
          return response;
        })
        .catch(() => undefined);
      return cached || network;
    })
  );
});
