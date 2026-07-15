// Susu service worker.
// Deliberately network-first: this is a money product, and a cached balance
// that is one day old is worse than no balance at all. The cache exists only
// so the shell opens offline and can tell the user it needs a connection.
const CACHE = 'susu-v1'
const SHELL = ['/', '/login', '/manifest.json']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
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
  // Never cache Supabase / API traffic — always hit the network
  if (url.origin !== self.location.origin) return

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
        return res
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/')))
  )
})
