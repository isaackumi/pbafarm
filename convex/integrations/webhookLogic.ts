/**
 * Outbound webhook rules (INT-005, doc 09 §7): URL policy, signing, retry
 * timing. Pure functions; signing uses Web Crypto (actions and tests).
 */

export const SIGNATURE_HEADER = 'X-PBA-Signature'
export const MAX_ENDPOINTS_PER_COMPANY = 10
export const MAX_EVENT_TYPES = 30
/** Failed attempts in a row (no success between) that disable an endpoint. */
export const DISABLE_AFTER_FAILURES = 20
/** Per-attempt timeout for the customer's endpoint. */
export const DELIVERY_TIMEOUT_MS = 10_000

/**
 * Delay before attempt n+1 after attempt n failed (n = 1..). Seven attempts
 * over about 19 hours; then the delivery is `failed` and can be redelivered
 * by hand. (Within one attempt, network errors and 5xx are also retried
 * twice with jittered backoff by effectHttp.)
 */
export const RETRY_DELAYS_MS = [
  60_000, // 1 min
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  12 * 60 * 60_000,
]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1

export function nextRetryDelay(attemptsSoFar: number): number | null {
  return attemptsSoFar >= 1 && attemptsSoFar <= RETRY_DELAYS_MS.length
    ? RETRY_DELAYS_MS[attemptsSoFar - 1]
    : null
}

export function endpointAad(companyId: string, endpointId: string) {
  return `${companyId}:webhookEndpoints:${endpointId}`
}

function isIpv4Literal(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  return !!m
}

/**
 * Null when the URL is acceptable, otherwise the reason. https only; no IP
 * literals, localhost or internal names; ports 443 or 8443. DNS rebinding to
 * an internal address cannot be fully excluded (doc 09 §7); only the status
 * code is ever shown back to the tenant.
 */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return 'Enter a full URL starting with https://'
  }
  if (url.protocol !== 'https:') return 'The URL must start with https://'
  if (url.username || url.password) return 'The URL cannot contain a user name or password'
  if (url.port && url.port !== '443' && url.port !== '8443') return 'Use port 443 or 8443'
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return 'The URL has no host name'
  if (host.startsWith('[') || host.includes(':')) return 'Use a host name, not an IP address'
  if (isIpv4Literal(host) || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return 'Use a host name, not an IP address'
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa') ||
    !host.includes('.')
  ) {
    return 'The URL must be a public internet address'
  }
  if (raw.length > 500) return 'The URL is too long'
  return null
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Hex HMAC-SHA256 of `${timestamp}.${body}`. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

/** `t=<unix seconds>,v1=<hex>` for the X-PBA-Signature header. */
export async function signatureHeader(secret: string, body: string, nowMs: number): Promise<string> {
  const t = Math.floor(nowMs / 1000)
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${body}`)}`
}

/**
 * Receiver-side check (documented for customers, used in tests): the
 * signature matches and the timestamp is within `toleranceSec` of now.
 */
export async function verifySignature(
  secret: string,
  body: string,
  header: string,
  nowMs: number,
  toleranceSec = 300,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const t = Number(parts.t)
  if (!Number.isFinite(t) || !parts.v1) return false
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false
  const expected = await hmacSha256Hex(secret, `${t}.${body}`)
  if (expected.length !== parts.v1.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i)
  return diff === 0
}
