/**
 * Credential encryption for integrations (INT-001, D-009, doc 18 §4).
 *
 * AES-256-GCM through Web Crypto. The 32-byte key comes from the Convex
 * environment variable INTEGRATIONS_ENCRYPTION_KEY (base64). Use these helpers
 * from actions only: encryption needs a fresh random IV, and decrypted
 * credentials must never pass through a query or mutation result.
 *
 * Additional authenticated data binds a ciphertext to its row
 * (`companyId:channelId`), so a ciphertext copied onto another company's or
 * channel's row fails to decrypt.
 */

export const ENCRYPTION_KEY_ENV = 'INTEGRATIONS_ENCRYPTION_KEY'

/** Bumped when a second key is introduced for rotation (doc 18 §4.3). */
export const CURRENT_KEY_VERSION = 1

export const MISSING_KEY_MESSAGE =
  'Credentials cannot be saved yet: the platform encryption key ' +
  `(${ENCRYPTION_KEY_ENV}) is not set on this deployment. ` +
  'Ask the platform operator to set it, then try again.'

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** The raw key bytes, or null when the variable is missing or not 32 bytes. */
export function readEncryptionKey(
  raw: string | undefined = process.env[ENCRYPTION_KEY_ENV],
): Uint8Array | null {
  if (!raw || !raw.trim()) return null
  try {
    const bytes = fromBase64(raw.trim())
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

export function encryptionConfigured(): boolean {
  return readEncryptionKey() !== null
}

async function importKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export type EncryptedSecret = { ciphertext: string; iv: string; keyVersion: number }

/** Encrypt a JSON-serializable value. Throws MISSING_KEY_MESSAGE without a key. */
export async function encryptJson(
  value: unknown,
  aad: string,
  rawKey: Uint8Array | null = readEncryptionKey(),
): Promise<EncryptedSecret> {
  if (!rawKey) throw new Error(MISSING_KEY_MESSAGE)
  const key = await importKey(rawKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    plaintext,
  )
  return {
    ciphertext: toBase64(new Uint8Array(sealed)),
    iv: toBase64(iv),
    keyVersion: CURRENT_KEY_VERSION,
  }
}

/** Decrypt what encryptJson produced. Throws on a wrong key, AAD or tampering. */
export async function decryptJson<T = unknown>(
  secret: { ciphertext: string; iv: string },
  aad: string,
  rawKey: Uint8Array | null = readEncryptionKey(),
): Promise<T> {
  if (!rawKey) throw new Error(MISSING_KEY_MESSAGE)
  const key = await importKey(rawKey)
  const opened = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(secret.iv),
      additionalData: new TextEncoder().encode(aad),
    },
    key,
    fromBase64(secret.ciphertext),
  )
  return JSON.parse(new TextDecoder().decode(opened)) as T
}

/** "…4F2a" from the last characters of a secret, for the write-only UI. */
export function secretHint(secret: string | undefined): string | undefined {
  if (!secret) return undefined
  const s = secret.trim()
  if (s.length < 8) return '…' // too short to reveal any of it
  return `…${s.slice(-4)}`
}

/** Hex SHA-256 of a string (one-time-code hashes). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Uniform random 6-digit code from crypto.getRandomValues (actions only). */
export function randomDigits(length = 6): string {
  let out = ''
  const buf = new Uint32Array(1)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    // Reject the top sliver so every digit is equally likely.
    if (buf[0] >= 4_294_967_290) continue
    out += String(buf[0] % 10)
  }
  return out
}
