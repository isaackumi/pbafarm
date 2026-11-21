/** Random tokens and their hashes (invite links, verification codes). */

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 32 random bytes as 64 hex characters, for links. */
export function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/** A numeric one-time code (default 6 digits), easy to type on a phone. */
export function randomDigits(length = 6): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => String(b % 10)).join('')
}

/**
 * Letters and digits a person can read off a screen and type without mixing
 * them up: no 0/O, 1/I/L. 31 symbols, so 6 of them are about 29.7 bits.
 */
export const SHORT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/**
 * A one-time code like "K7Q42P" (shown as "K7Q-42P"). Always mixes letters and
 * digits, so an ordinary word typed to the bot ("THANKS") is never read as one.
 */
export function randomShortCode(length = 6): string {
  const n = SHORT_CODE_ALPHABET.length
  // Rejection sampling keeps every symbol equally likely (256 % 31 != 0).
  const limit = 256 - (256 % n)
  for (;;) {
    let out = ''
    while (out.length < length) {
      const bytes = new Uint8Array(length * 2)
      crypto.getRandomValues(bytes)
      for (const b of bytes) {
        if (b < limit && out.length < length) out += SHORT_CODE_ALPHABET[b % n]
      }
    }
    if (/[0-9]/.test(out) && /[A-Z]/.test(out)) return out
  }
}

/** "K7Q42P" -> "K7Q-42P" for display. */
export function formatShortCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code
}

/**
 * Reads a typed short code back: case, spaces and one dash are forgiven.
 * Returns the canonical "K7Q42P" or null when the text is not a code.
 */
export function parseShortCode(text: string): string | null {
  const m = /^([a-z0-9]{3})[\s-]?([a-z0-9]{3})$/i.exec(text.trim())
  if (!m) return null
  const code = `${m[1]}${m[2]}`.toUpperCase()
  if (![...code].every((c) => SHORT_CODE_ALPHABET.includes(c))) return null
  if (!/[0-9]/.test(code) || !/[A-Z]/.test(code)) return null
  return code
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toHex(new Uint8Array(digest))
}
