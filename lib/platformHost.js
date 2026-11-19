/**
 * Host routing for the platform console (PLAT-101, docs/architecture/22-platform-console-billing.md §2).
 *
 * The console is served on its own host (console.heitechinc.com). On that
 * host only the console, the sign-in pages and static assets are reachable;
 * everything else goes to /platform. On the tenant app host /platform is a
 * 404. This is presentation only: every console function checks platform
 * admin + verified second factor on the server (convex/platform/access.ts).
 */

export const DEFAULT_CONSOLE_HOSTS = 'console.heitechinc.com,console.localhost'

/** Paths the console host serves besides /platform/**: sign-in, second factor, password reset, own account. */
const CONSOLE_AUTH_PATHS = ['/login', '/verify', '/verify-email', '/reset-password', '/account', '/404', '/500', '/_error']

/** Parse NEXT_PUBLIC_PLATFORM_CONSOLE_HOST: comma-separated hosts, with or without port, case-insensitive. */
export function parseConsoleHosts(raw = DEFAULT_CONSOLE_HOSTS) {
  return String(raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

/** Whether `host` (Host header, may carry a port) is a console host. */
export function isConsoleHost(host, consoleHosts) {
  const full = String(host ?? '').trim().toLowerCase()
  if (!full) return false
  const bare = full.replace(/:\d+$/, '')
  return consoleHosts.some((h) => h === full || h === bare)
}

function isPlatformPath(pathname) {
  return pathname === '/platform' || pathname.startsWith('/platform/')
}

function isStaticPath(pathname) {
  if (pathname.startsWith('/_next/') || pathname.startsWith('/__nextjs')) return true
  // Files in public/ (favicon.ico, manifest.json, sw.js, icons/*.png ...).
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return /\.[a-z0-9]{1,8}$/i.test(last)
}

/**
 * Where a request goes:
 *   { action: 'next' }                  serve it
 *   { action: 'redirect', to: '/platform' }
 *   { action: 'not_found' }             tenant host asking for the console
 */
export function routeForHost({ host, pathname, consoleHosts }) {
  const path = pathname || '/'
  if (isConsoleHost(host, consoleHosts)) {
    if (isPlatformPath(path) || isStaticPath(path)) return { action: 'next' }
    if (path.startsWith('/api/')) return { action: 'not_found' }
    if (CONSOLE_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return { action: 'next' }
    return { action: 'redirect', to: '/platform' }
  }
  if (isPlatformPath(path)) return { action: 'not_found' }
  return { action: 'next' }
}
