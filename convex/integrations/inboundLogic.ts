/**
 * Inbound signed webhooks (INT-003, doc 09 §7): signature, timestamp and
 * event-id rules. Pure (Web Crypto only); `now` is passed in.
 *
 * Senders sign exactly like our outbound webhooks (webhookLogic):
 *   X-PBA-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *   X-PBA-Event-Id:  <unique id per event>   (or `id` in the JSON body)
 *   X-PBA-Event-Type: <type>                 (optional, or `type` in the body)
 *
 * Replay protection: the timestamp must be within TOLERANCE_SEC of now, and
 * an event id is processed once per webhook (inboundWebhookEvents). A
 * captured request replayed later fails the timestamp; replayed at once, it
 * is a duplicate.
 */
import { hmacSha256Hex } from './webhookLogic'

export const SIGNATURE_HEADER = 'X-PBA-Signature'
export const EVENT_ID_HEADER = 'X-PBA-Event-Id'
export const EVENT_TYPE_HEADER = 'X-PBA-Event-Type'
export const TOLERANCE_SEC = 300
export const MAX_INBOUND_BYTES = 256 * 1024
export const MAX_STORED_PAYLOAD = 64 * 1024
export const MAX_INBOUND_PER_COMPANY = 10
export const PUBLIC_ID_RE = /^inw_[A-Za-z0-9]{24}$/
const EVENT_ID_RE = /^[A-Za-z0-9_\-:.]{1,200}$/
const EVENT_TYPE_RE = /^[A-Za-z0-9_\-:.]{1,100}$/

export function inboundAad(companyId: string, webhookId: string) {
  return `${companyId}:inboundWebhooks:${webhookId}`
}

export type SignatureCheck =
  | { ok: true; signedAt: number }
  | { ok: false; reason: 'missing_signature' | 'malformed_signature' | 'stale_timestamp' | 'bad_signature' }

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Check `X-PBA-Signature` over the raw body; several `v1=` values are allowed (secret rotation on the sender). */
export async function checkSignature(
  secret: string,
  rawBody: string,
  header: string | null,
  nowMs: number,
  toleranceSec = TOLERANCE_SEC,
): Promise<SignatureCheck> {
  if (!header || !header.trim()) return { ok: false, reason: 'missing_signature' }
  let t: number | null = null
  const sigs: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const val = part.slice(i + 1).trim()
    if (k === 't' && /^\d{1,12}$/.test(val)) t = Number(val)
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(val)) sigs.push(val.toLowerCase())
  }
  if (t === null || !sigs.length) return { ok: false, reason: 'malformed_signature' }
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return { ok: false, reason: 'stale_timestamp' }
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`)
  return sigs.some((s) => sameHex(expected, s)) ? { ok: true, signedAt: t } : { ok: false, reason: 'bad_signature' }
}

export const REJECT_MESSAGES: Record<Exclude<SignatureCheck, { ok: true }>['reason'], string> = {
  missing_signature: `Send the ${SIGNATURE_HEADER} header`,
  malformed_signature: `${SIGNATURE_HEADER} must be t=<unix seconds>,v1=<hex HMAC-SHA256>`,
  stale_timestamp: `Signature timestamp is more than ${TOLERANCE_SEC} seconds from now`,
  bad_signature: 'Signature does not match',
}

/** Event id and type from the headers, else from the body's `id` / `type`. */
export function eventIdentity(
  headers: { get(name: string): string | null },
  body: Record<string, unknown>,
): { ok: true; externalId: string; eventType?: string } | { ok: false; message: string } {
  const rawId = headers.get(EVENT_ID_HEADER) ?? (typeof body.id === 'string' || typeof body.id === 'number' ? String(body.id) : '')
  const externalId = rawId.trim()
  if (!EVENT_ID_RE.test(externalId)) {
    return { ok: false, message: `Send a unique event id (${EVENT_ID_HEADER} header or "id"): 1–200 letters, digits, _-:.` }
  }
  const rawType = (headers.get(EVENT_TYPE_HEADER) ?? (typeof body.type === 'string' ? body.type : '')).trim()
  if (rawType && !EVENT_TYPE_RE.test(rawType)) return { ok: false, message: 'Event type: 1–100 letters, digits, _-:.' }
  return { ok: true, externalId, eventType: rawType || undefined }
}

/** Sender-side helper (docs, tests): the header for a body. */
export async function signInbound(secret: string, rawBody: string, nowMs: number) {
  const t = Math.floor(nowMs / 1000)
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${rawBody}`)}`
}
