/* PBA Farm service worker: keeps the app shell available with weak signal.
 * Data never goes through here. Convex runs on another origin and is skipped,
 * and unsent daily entries live in the page's own outbox (lib/offlineOutbox.js).
 */
const VERSION = 'pbafarm-v1'
const SHELL = ['/daily-entry', '/dashboard', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.match(/\.(svg|png|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(req, copy))
            return res
          }),
      ),
    )
    return
  }

  // Pages: network first, fall back to the last copy, then to daily entry.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy))
          return res
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('/daily-entry')),
        ),
    )
  }
})
