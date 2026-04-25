// Sea Kayak service worker — minimal offline cache.
// Bumping CACHE_VERSION invalidates the previous cache on next install.
const CACHE_VERSION = "sea-kayak-v1"
const PRECACHE_URLS = [
  "/",
  "/routes.json",
  "/sea-kayak.png",
  "/manifest.webmanifest",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)),
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return

  const url = new URL(req.url)
  // Only handle same-origin requests; let cross-origin (Open-Meteo, etc.) pass through.
  if (url.origin !== self.location.origin) return

  // Stale-while-revalidate for routes.json so freshly scraped data lands on next visit.
  if (url.pathname === "/routes.json") {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req)
        const networkPromise = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone())
            return res
          })
          .catch(() => cached) // fall back to cache if offline
        return cached || networkPromise
      }),
    )
    return
  }

  // Cache-first for the document shell + static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req)
        .then((res) => {
          if (res.ok && (req.destination === "document" || req.destination === "image" || req.destination === "script" || req.destination === "style" || req.destination === "font")) {
            const copy = res.clone()
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match("/")) // offline fallback for navigations
    }),
  )
})
