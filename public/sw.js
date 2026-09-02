// Susu service worker.
//
// ─────────────────────────────────────────────────────────────────────────────
// v2 — WHY THE OFFLINE FALLBACK IS GONE
//
// v1 ended its fetch handler with:
//
//     .catch(() => caches.match(request).then((r) => r || caches.match('/')))
//
// If the network hiccuped and the request was not cached, it answered with the
// HTML DOCUMENT — whatever had been asked for. A request for a JavaScript chunk
// received HTML, the browser tried to parse it as JavaScript, and the app died
// on hydration with "Application error: a client-side exception has occurred".
//
// It hit both portals, on real phones, while every server-side check passed:
// curl has no service worker. v1 also cached whatever came back, so one bad
// moment on a weak connection stayed broken until the cache was cleared.
//
// The offline shell it existed to provide was never worth much — every screen
// in this app needs the network, so an offline shell can only say "no
// connection", which is what the browser already says. It is removed rather
// than repaired: a fallback that can serve the wrong content type is a bigger
// risk than the convenience is worth.
//
// What remains is the minimum for installability: a registered worker with a
// fetch handler, caching static assets only, and never inventing a response.
//
// The cache name changed, so `activate` deletes every v1 cache — including the
// poisoned ones already on people's phones. Browsers re-check this file on
// navigation independently of page JavaScript, so a device stuck on v1
// recovers on its next visit without anyone clearing anything by hand.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE = 'susu-v2'

self.addEventListener('install', () => {
  // Nothing is pre-cached. v1 listed '/login', which this app has never served,
  // and `addAll` rejects if any single entry 404s — so install failed and the
  // worker never reached skipWaiting. Precaching bought nothing anyway.
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Never touch Supabase or any other origin — always straight to the network.
  if (url.origin !== self.location.origin) return

  // Documents and data always come from the network, never from a cache. This
  // is a money product: a balance one day old is worse than no balance.
  const cacheable = ['script', 'style', 'font', 'image'].includes(request.destination)
  if (!cacheable) return

  e.respondWith(
    fetch(request)
      .then((res) => {
        // Store only what is safe to replay: a complete, same-origin 200.
        // Opaque, partial and redirected responses pass through uncached —
        // caching a redirect is how a cache starts answering questions it was
        // never asked.
        if (res && res.status === 200 && res.type === 'basic' && !res.redirected) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
        }
        return res
      })
      // A cached asset if we have the exact one, otherwise a real network
      // error. Never a substitute, and never a document.
      .catch(() => caches.match(request).then((hit) => hit || Response.error()))
  )
})
