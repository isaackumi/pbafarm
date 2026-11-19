/**
 * Device registry and authentication (CF-008). Each device has a KV record
 * under `device:<deviceId>` holding either an HMAC secret or the SHA-256 of
 * a bearer token, never both required:
 *
 *   HMAC:  X-Device-Id: <id>
 *          X-Device-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *          (same scheme as inbound webhooks, INT-003; 300 s tolerance)
 *   Token: X-Device-Id: <id>
 *          Authorization: Bearer <token>   (constant-time compare of SHA-256)
 *
 * A device may be pinned to a unit (`cageId`) or site (`siteId`); its readings
 * are attributed there whatever the body says, and `deviceId` always comes
 * from the authenticated header.
 */
import { checkSignature, REJECT_MESSAGES } from '../../../convex/integrations/inboundLogic'

export type DeviceRecord = {
  /** HMAC-SHA256 secret (HMAC mode). */
  secret?: string
  /** Lower-case hex SHA-256 of the bearer token (token mode). */
  tokenSha256?: string
  cageId?: string
  siteId?: string
  disabled?: boolean
}

/** The KV methods the Worker uses (Cloudflare's KVNamespace satisfies this). */
export type DeviceStore = { get(key: string, type: 'json'): Promise<unknown> }

export const DEVICE_ID_RE = /^[A-Za-z0-9_\-:.]{1,100}$/

export type DeviceAuth =
  | { ok: true; deviceId: string; device: DeviceRecord }
  | { ok: false; status: 401 | 403; message: string }

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function asRecord(value: unknown): DeviceRecord | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const str = (k: string) => (typeof r[k] === 'string' && r[k] ? (r[k] as string) : undefined)
  return {
    secret: str('secret'),
    tokenSha256: str('tokenSha256')?.toLowerCase(),
    cageId: str('cageId'),
    siteId: str('siteId'),
    disabled: r.disabled === true,
  }
}

const DENIED = { ok: false as const, status: 401 as const, message: 'Unknown device or bad credentials' }

export async function authenticateDevice(
  store: DeviceStore,
  headers: Headers,
  rawBody: string,
  nowMs: number,
): Promise<DeviceAuth> {
  const deviceId = (headers.get('X-Device-Id') ?? '').trim()
  if (!DEVICE_ID_RE.test(deviceId)) return { ok: false, status: 401, message: 'Send X-Device-Id' }
  const device = asRecord(await store.get(`device:${deviceId}`, 'json'))
  if (!device) return DENIED
  if (device.disabled) return { ok: false, status: 403, message: 'This device is disabled' }

  const signature = headers.get('X-Device-Signature')
  if (signature && device.secret) {
    const check = await checkSignature(device.secret, rawBody, signature, nowMs)
    if (!check.ok) {
      return { ok: false, status: 401, message: REJECT_MESSAGES[check.reason].replace('X-PBA-Signature', 'X-Device-Signature') }
    }
    return { ok: true, deviceId, device }
  }
  const auth = headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (token && device.tokenSha256) {
    return sameHex(await sha256Hex(token), device.tokenSha256) ? { ok: true, deviceId, device } : DENIED
  }
  return DENIED
}
