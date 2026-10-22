// Cache only this app's public shell, assets and validated news snapshots.
const CACHE_VERSION = "sea-kayak-v2"
const LIVE_NEWS = "https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json"
const MAX_BYTES = 16 * 1024 * 1024
const MAX_ASSETS = 150

async function download(request, timeout = 4000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  let reader
  try {
    const response = await fetch(request, { signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Unavailable public resource")
    reader = response.body?.getReader()
    const chunks = []
    let length = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BYTES) throw new Error("Public resource exceeds cache limit")
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const headers = new Headers(response.headers)
    headers.delete("content-encoding")
    headers.delete("content-length")
    return new Response(bytes, { status: response.status, headers })
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (reader) { try { await reader.cancel() } catch {} reader.releaseLock() }
  }
}

async function validateNews(response) {
  const items = await response.clone().json()
  if (!Array.isArray(items) || !items.length || items.length > 20000) throw new Error("Invalid news snapshot")
  const usable = items.some(item => {
    const raw = typeof item === "string" ? { url: item } : item
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.url !== "string" || /[\u0000-\u0020\u007f]/.test(raw.url)) return false
    if ([raw.title, raw.description, raw.published, raw.citation].some(field => field != null && typeof field !== "string")) return false
    try { const url = new URL(raw.url); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password } catch { return false }
  })
  if (!usable) throw new Error("News snapshot has no usable links")
  return response
}

async function trim(cache) {
  const keys = (await cache.keys()).filter(key => new URL(key.url).pathname.startsWith("/_next/static/"))
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map(key => cache.delete(key)))
}

async function storeShell(cache, response) {
  const html = await response.clone().text()
  const resources = [...new Set([...html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)].map(match => match[1].replaceAll("&amp;", "&")))]
  if (!resources.length || resources.length > 100) throw new Error("Unsupported app shell")
  // Publish cached HTML only after its scripts, styles and fonts are available.
  for (let start = 0; start < resources.length; start += 4) {
    await Promise.all(resources.slice(start, start + 4).map(async url => {
      if (!(await cache.match(url))) await cache.put(url, await download(url))
    }))
  }
  await cache.put("/", response)
  await trim(cache)
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION)
    await storeShell(cache, await download("/"))
    await cache.put("/routes.json", await validateNews(await download("/routes.json")))
    for (const url of ["/sea-kayak.png", "/manifest.webmanifest"]) await cache.put(url, await download(url))
    await self.skipWaiting()
  })())
})

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith("sea-kayak-") && key !== CACHE_VERSION).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", event => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  const local = url.origin === self.location.origin

  if (url.href === LIVE_NEWS) {
    const work = (async () => {
      const response = await validateNews(await download(request))
      const cache = await caches.open(CACHE_VERSION)
      try { await cache.put("/routes.json", response.clone()) } catch { /* Online news remains usable when storage is full. */ }
      return response
    })()
    event.respondWith(work)
    event.waitUntil(work.then(() => undefined).catch(() => undefined))
    return
  }
  if (!local) return

  if (url.pathname === "/routes.json") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION)
      return await cache.match("/routes.json") || await validateNews(await download(request))
    })())
    return
  }

  if (request.mode === "navigate") {
    const work = (async () => {
      const cache = await caches.open(CACHE_VERSION)
      let response
      try { response = await download(request) } catch {
        return await cache.match("/") || Response.error()
      }
      if (url.pathname === "/") { try { await storeShell(cache, response.clone()) } catch { /* Preserve the previous complete offline shell. */ } }
      return response
    })()
    event.respondWith(work)
    event.waitUntil(work.then(() => undefined))
    return
  }

  const cacheable = url.pathname.startsWith("/_next/static/") || ["/sea-kayak.png", "/manifest.webmanifest"].includes(url.pathname)
  if (!cacheable) return
  const work = (async () => {
    const cache = await caches.open(CACHE_VERSION)
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await download(request)
    try { await cache.put(request, response.clone()); await trim(cache) } catch { /* Serve the public asset even if it cannot be cached. */ }
    return response
  })()
  event.respondWith(work)
  event.waitUntil(work.then(() => undefined).catch(() => undefined))
})
