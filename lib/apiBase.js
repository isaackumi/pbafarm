/**
 * Base URL of the Convex HTTP endpoints (public API, webhooks): the
 * deployment's `.convex.site` host, derived from NEXT_PUBLIC_CONVEX_URL
 * (`https://<name>.convex.cloud`). NEXT_PUBLIC_CONVEX_SITE_URL wins if set.
 */
export function convexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const url = process.env.NEXT_PUBLIC_CONVEX_URL || ''
  return url.replace(/\.convex\.cloud\/?$/, '.convex.site').replace(/\/$/, '')
}
