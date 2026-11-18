/**
 * Only allow same-origin paths for post-login redirects (`?next=`).
 *
 * Accepts "/dashboard", "/cages/abc?tab=x". Rejects absolute URLs,
 * protocol-relative "//evil.com", "/\evil.com" (browsers treat "\" as "/"),
 * and anything with control characters or whitespace.
 */
export function safeNextPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.includes('\\')) return fallback
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return fallback
  try {
    const base = 'https://same-origin.invalid'
    const url = new URL(value, base)
    if (url.origin !== base) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
