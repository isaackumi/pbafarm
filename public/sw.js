/* PBA Farm service worker: keeps the app shell available with weak signal.
 * Data never goes through here. Convex runs on another origin and is skipped,
 * and unsent field entries live in the page's own outbox (lib/offlineOutbox.js).
 *
 * The page registers `/sw.js?v=<Next build id>` (pages/_app.js), so every
 * deploy installs a new worker with its own cache, and `activate` deletes the
 * caches of older builds (old hashed chunks no longer pile up on the phone).
 */
const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev'
const PREFIX = 'pbafarm-'
const VERSION = `${PREFIX}${BUILD}`

// Pages a field worker needs with no signal. Their JS/CSS chunks are read
// from the HTML and cached too, so a cold start offline can run them.
const SHELL_PAGES = [
  '/daily-entry',
  '/biweekly-entry',
  '/feed-issue',
  '/harvest',
  '/water-entry',
  '/inspection-entry',
  '/outbox',
  '/scan',
  '/dashboard',
  '/login',
]
const SHELL_FILES = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

// Runtime entries (pages visited, lazy chunks) beyond the precache are capped
// so a long-lived install does not grow without bound.
const MAX_ENTRIES = 250
const KEEP = new Set([...SHELL_PAGES, ...SHELL_FILES])

async function putBounded(key, res) {
  const cache = await caches.open(VERSION)
  await cache.put(key, res)
  const keys = await cache.keys()
  const extra = keys.length - MAX_ENTRIES
  if (extra <= 0) return
  // cache.keys() is in insertion order: drop the oldest non-shell entries.
  const victims = keys.filter((k) => !KEEP.has(new URL(k.url).pathname)).slice(0, extra)
  await Promise.all(victims.map((k) => cache.delete(k)))
}

function cacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected
}

async function precache() {
  const cache = await caches.open(VERSION)
  const assets = new Set(SHELL_FILES)
  await Promise.all(
    SHELL_PAGES.map(async (path) => {
      try {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
        if (!cacheable(res)) return
        const html = await res.clone().text()
        await cache.put(path, res)
        for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
          assets.add(m[1])
        }
      } catch {
        // offline during install: the page is cached on the next visit
      }
    }),
  )
  await Promise.all(
    [...assets].map(async (url) => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' })
        if (cacheable(res)) await cache.put(url, res)
      } catch {
        // best effort
      }
    }),
  )
}

// First install takes over at once. A newer build waits while an older one
// controls open pages; the page offers "Reload" (components/AppUpdatePrompt.js)
// and sends SKIP_WAITING, so nobody loses a half-filled form to an update.
self.addEventListener('install', (event) => {
  event.waitUntil(
    precache().then(() => {
      if (!self.registration.active) return self.skipWaiting()
      return undefined
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PREFIX) && k !== VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname === '/sw.js') return

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.match(/\.(svg|png|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (cacheable(res)) putBounded(req, res.clone()).catch(() => {})
            return res
          }),
      ),
    )
    return
  }

  // Pages: network first, fall back to the last good copy, then to daily entry.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable(res)) putBounded(url.pathname, res.clone()).catch(() => {})
          return res
        })
        .catch(() =>
          caches
            .match(url.pathname, { ignoreSearch: true })
            .then((hit) => hit || caches.match('/daily-entry')),
        ),
    )
  }
})
