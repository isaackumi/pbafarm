/**
 * Escaping for the email templates. Every dynamic value goes through one of
 * these before it reaches HTML; plain-text parts use `oneLine`/`cleanText`.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

/** Text content and attribute values. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c])
}

// Control characters, line/paragraph separators and bidi overrides.
const CONTROL = /[\u0000-\u001F\u007F\u0085\u2028\u2029\u202A-\u202E\u2066-\u2069]/g

/** One line of text: no CR/LF or other control characters, collapsed spaces. */
export function oneLine(value: unknown, max = 500): string {
  return String(value ?? '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Subject header: one line, at most 200 characters (header injection guard). */
export function cleanSubject(value: unknown): string {
  return oneLine(value, 200) || 'Anowa'
}

/** Multi-line text (keeps newlines, drops other control characters). */
export function cleanText(value: unknown, max = 20_000): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, ' ')
    .slice(0, max)
}

/**
 * An absolute http(s) URL, or null. Emails only link to the app (built from
 * SITE_URL plus a relative path) and to the asset host.
 */
export function safeHttpUrl(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/** A relative app path ("/approvals"), never a protocol-relative or absolute URL. */
export function safePath(path: string | undefined | null): string | null {
  if (!path) return null
  const p = path.trim()
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) return null
  if (/[\u0000-\u001F\u007F\s]/.test(p)) return null
  return p
}
