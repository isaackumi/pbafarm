/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s) for the
 * authenticator-app factor (ENT-003). Web Crypto only, so it runs in queries,
 * mutations and actions.
 */
import { sha256Hex } from './tokens'

export const TOTP_PERIOD_S = 30
export const TOTP_DIGITS = 6
/** Codes from one step either side are accepted (clock drift). */
export const TOTP_WINDOW = 1
export const RECOVERY_CODE_COUNT = 10

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx < 0) throw new Error('Invalid base32 secret')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** A new 160-bit secret, base32 (what authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)))
}

/** HOTP (RFC 4226) for one counter value. */
export async function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): Promise<string> {
  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i -= 1) {
    msg[i] = c & 0xff
    c = Math.floor(c / 256)
  }
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const offset = mac[mac.length - 1] & 0x0f
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_S)
}

/**
 * The time step the code matches (within ±TOTP_WINDOW), or null. Steps at or
 * before `afterStep` are refused so a code cannot be replayed.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  afterStep?: number,
): Promise<number | null> {
  const clean = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return null
  const secret = base32Decode(secretBase32)
  const current = totpStep(nowMs)
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta
    if (afterStep !== undefined && step <= afterStep) continue
    if ((await hotp(secret, step)) === clean) return step
  }
  return null
}

/** otpauth:// URI for the QR code an authenticator app scans. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'PBA Farm'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Ten codes like "k7m2-9qxp", unambiguous characters, shown once. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const codes: string[] = []
  for (let i = 0; i < count; i += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
    codes.push(`${chars.slice(0, 4)}-${chars.slice(4)}`)
  }
  return codes
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export async function hashRecoveryCode(userId: string, code: string): Promise<string> {
  return await sha256Hex(`recovery:${userId}:${normalizeRecoveryCode(code)}`)
}
