/**
 * Public API scope catalog (INT-004, doc 09 §8). A key carries a subset;
 * each /api/v1 route requires exactly one scope.
 */
export const API_SCOPES = {
  'cages:read': 'Read cages',
  'daily:read': 'Read daily records',
  'daily:write': 'Create daily records',
  'sampling:read': 'Read sampling',
  'sampling:write': 'Create sampling',
  'harvest:read': 'Read harvests',
  'inventory:read': 'Read feed stock',
  'sales:read': 'Read sales',
  'ingest:write': 'Send sensor readings',
} as const

export type ApiScope = keyof typeof API_SCOPES

export function isApiScope(s: string): s is ApiScope {
  return Object.prototype.hasOwnProperty.call(API_SCOPES, s)
}

export const API_KEY_PREFIX_LENGTH = 10
export const API_KEY_SECRET_LENGTH = 32
export const API_KEY_PATTERN = /^pbk_([A-Za-z0-9]{10})_([A-Za-z0-9]{32})$/

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Uniform base62 string from crypto.getRandomValues (actions only). */
export function randomBase62(length: number): string {
  let out = ''
  const buf = new Uint8Array(1)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    // 248 = 4 * 62: reject the top bytes so every character is equally likely.
    if (buf[0] >= 248) continue
    out += BASE62[buf[0] % 62]
  }
  return out
}

/** Compare two equal-length strings without an early exit. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
