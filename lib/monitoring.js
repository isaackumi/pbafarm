/**
 * Browser error reporting (OPS-001). No-op unless NEXT_PUBLIC_SENTRY_DSN is
 * set at build time. See convex/lib/monitoring.ts for what is (not) sent.
 */
import { reportError } from '../convex/lib/monitoring'

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN
const ENVIRONMENT = process.env.NEXT_PUBLIC_APP_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV
const RELEASE = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA

/** At most this many reports per page load, so a render loop cannot flood. */
const MAX_REPORTS = 20
let sent = 0

export function monitoringEnabled() {
  return Boolean(DSN)
}

/** Report an unexpected error. Safe to call anywhere; never throws. */
export function captureException(error, { source = 'client', tags } = {}) {
  if (!DSN || typeof window === 'undefined' || sent >= MAX_REPORTS) return
  sent += 1
  reportError(DSN, error, {
    transaction: window.location.pathname,
    environment: ENVIRONMENT,
    release: RELEASE,
    tags: { source, ...(tags || {}) },
  })
}

let installed = false

/** window.onerror and unhandled promise rejections. Idempotent. */
export function installGlobalErrorHandlers() {
  if (installed || !DSN || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => captureException(event.error || event.message, { source: 'window.error' }))
  window.addEventListener('unhandledrejection', (event) =>
    captureException(event.reason, { source: 'unhandledrejection' }),
  )
}
