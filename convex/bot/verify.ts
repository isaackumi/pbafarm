/**
 * Webhook verification and payload parsing for the farm bot (BOT-001).
 * Pure functions: no Convex ctx, so they are unit tested directly.
 *
 * Meta (WhatsApp Cloud API) signs every POST with
 *   X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body, app secret>
 * and verifies the callback URL with GET ?hub.mode=subscribe&hub.verify_token
 * =…&hub.challenge=… (echo the challenge).
 * Telegram sends the secret given to setWebhook in
 *   X-Telegram-Bot-Api-Secret-Token.
 */

export type BotProvider = 'whatsapp' | 'telegram'

/** One inbound message, provider-neutral. Text and button ids are untrusted. */
export type InboundEvent = {
  provider: BotProvider
  externalId: string
  address: string
  kind: 'text' | 'button' | 'image' | 'unsupported'
  text?: string
  buttonId?: string
  callbackQueryId?: string
  profileName?: string
  /** Photo (BOT-006): WhatsApp media id / Telegram file_id, declared type and size. Untrusted. */
  mediaId?: string
  mediaMime?: string
  mediaSize?: number
  sentAt: number
}

/** A WhatsApp delivery status with Meta's pricing block. */
export type StatusEvent = {
  providerMessageId: string
  status: string
  billable?: boolean
  pricingModel?: string
  category?: string
  pricingType?: string
}

export const MAX_TEXT_CHARS = 2000
export const MAX_BUTTON_ID_CHARS = 64
export const MAX_EVENTS_PER_REQUEST = 50
/** Webhook bodies larger than this are refused before parsing. */
export const MAX_BODY_BYTES = 256 * 1024
/** Older messages are dropped: Meta retries for up to 7 days, and dedupe rows live 30. */
export const MAX_EVENT_AGE_MS = 14 * 24 * 60 * 60 * 1000

const encoder = new TextEncoder()

/** Constant-time comparison of two strings (length leaks, content does not). */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hmacSha256HexBytes(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return toHex(await crypto.subtle.sign('HMAC', key, body as BufferSource))
}

/** Check Meta's X-Hub-Signature-256 over the raw request bytes. */
export async function verifyMetaSignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string | undefined,
): Promise<boolean> {
  if (!appSecret || !header) return false
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())
  if (!match) return false
  const expected = await hmacSha256HexBytes(appSecret, rawBody)
  return safeEqual(expected, match[1].toLowerCase())
}

/** Check Telegram's X-Telegram-Bot-Api-Secret-Token. */
export function verifyTelegramSecret(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  return safeEqual(header, secret)
}

/** Meta's GET handshake: the challenge to echo, or null to refuse. */
export function metaHandshake(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null
  if (params.get('hub.mode') !== 'subscribe') return null
  const token = params.get('hub.verify_token') ?? ''
  const challenge = params.get('hub.challenge')
  if (!challenge || !safeEqual(token, verifyToken)) return null
  return challenge.slice(0, 200)
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)
const cap = (s: string | undefined, n: number) => (s === undefined ? undefined : s.slice(0, n))

/** WhatsApp ids are digits; we store E.164 with '+'. */
export function e164FromWaId(waId: string): string | null {
  const digits = waId.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `+${digits}`
}

/**
 * Messages and statuses from a WhatsApp Business Account webhook. Only
 * messages to `botPhoneNumberId` are taken (none when it is unset): the same Meta app may
 * also carry organizations' own numbers used for one-time codes.
 */
export function parseWhatsApp(
  body: unknown,
  botPhoneNumberId: string | undefined,
): { events: InboundEvent[]; statuses: StatusEvent[] } {
  const events: InboundEvent[] = []
  const statuses: StatusEvent[] = []
  const root = obj(body)
  // Fail closed: without the bot's number id we cannot tell bot traffic from an org's own number.
  if (!botPhoneNumberId || !root || root.object !== 'whatsapp_business_account') return { events, statuses }
  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change)
      if (c?.field !== 'messages') continue
      const value = obj(c.value)
      if (!value) continue
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id)
      if (phoneNumberId !== botPhoneNumberId) continue
      const names = new Map<string, string>()
      for (const contact of arr(value.contacts)) {
        const waId = str(obj(contact)?.wa_id)
        const name = str(obj(obj(contact)?.profile)?.name)
        if (waId && name) names.set(waId, name)
      }
      for (const raw of arr(value.messages)) {
        const m = obj(raw)
        const id = str(m?.id)
        const from = str(m?.from)
        const address = from ? e164FromWaId(from) : null
        if (!m || !id || !from || !address) continue
        const sentAt = Number(str(m.timestamp) ?? '0') * 1000 || Date.now()
        const base = { provider: 'whatsapp' as const, externalId: cap(id, 200)!, address, sentAt, profileName: cap(names.get(from), 80) }
        const type = str(m.type)
        if (type === 'text') {
          events.push({ ...base, kind: 'text', text: cap(str(obj(m.text)?.body) ?? '', MAX_TEXT_CHARS) })
        } else if (type === 'interactive') {
          const i = obj(m.interactive)
          const reply = obj(i?.button_reply) ?? obj(i?.list_reply)
          const buttonId = cap(str(reply?.id), MAX_BUTTON_ID_CHARS)
          if (buttonId) events.push({ ...base, kind: 'button', buttonId, text: cap(str(reply?.title), 100) })
          else events.push({ ...base, kind: 'unsupported' })
        } else if (type === 'button') {
          // Quick reply on a template message: the payload we set.
          const b = obj(m.button)
          const buttonId = cap(str(b?.payload), MAX_BUTTON_ID_CHARS)
          if (buttonId) events.push({ ...base, kind: 'button', buttonId, text: cap(str(b?.text), 100) })
          else events.push({ ...base, kind: 'text', text: cap(str(b?.text) ?? '', MAX_TEXT_CHARS) })
        } else if (type === 'image' || type === 'document') {
          // A logbook photo (BOT-006); a document only when it says it is an image.
          const media = obj(type === 'image' ? m.image : m.document)
          const mediaId = cap(str(media?.id), 200)
          const mime = cap(str(media?.mime_type), 100)?.toLowerCase()
          if (mediaId && (type === 'image' || mime?.startsWith('image/'))) {
            events.push({ ...base, kind: 'image', mediaId, mediaMime: mime, text: cap(str(media?.caption), MAX_TEXT_CHARS) })
          } else {
            events.push({ ...base, kind: 'unsupported' })
          }
        } else {
          events.push({ ...base, kind: 'unsupported' })
        }
      }
      for (const raw of arr(value.statuses)) {
        const s = obj(raw)
        const id = str(s?.id)
        if (!s || !id) continue
        const pricing = obj(s.pricing)
        statuses.push({
          providerMessageId: cap(id, 200)!,
          status: cap(str(s.status) ?? 'unknown', 40)!,
          billable: typeof pricing?.billable === 'boolean' ? pricing.billable : undefined,
          pricingModel: cap(str(pricing?.pricing_model), 40),
          category: cap(str(pricing?.category), 40),
          pricingType: cap(str(pricing?.type), 40),
        })
      }
    }
  }
  return { events: events.slice(0, MAX_EVENTS_PER_REQUEST), statuses: statuses.slice(0, MAX_EVENTS_PER_REQUEST) }
}

/** Telegram keeps photos under this size for bots to download. */
const TELEGRAM_PHOTO_CAP = 5 * 1024 * 1024

/**
 * A photo (largest size that fits the cap, else the largest, which is then
 * refused as too large) or an image sent as a document.
 */
function telegramPhoto(message: Obj): { mediaId: string; mediaMime?: string; mediaSize?: number } | null {
  const sizes = arr(message.photo)
    .map(obj)
    .filter((p): p is Obj => !!p && !!str(p.file_id))
    .map((p) => ({ id: str(p.file_id)!, size: typeof p.file_size === 'number' ? p.file_size : undefined, area: Number(p.width ?? 0) * Number(p.height ?? 0) }))
    .sort((a, b) => b.area - a.area)
  if (sizes.length) {
    const pick = sizes.find((p) => p.size === undefined || p.size <= TELEGRAM_PHOTO_CAP) ?? sizes[0]
    return { mediaId: cap(pick.id, 200)!, mediaMime: 'image/jpeg', mediaSize: pick.size }
  }
  const doc = obj(message.document)
  const mime = cap(str(doc?.mime_type), 100)?.toLowerCase()
  const id = str(doc?.file_id)
  if (doc && id && mime?.startsWith('image/')) {
    return { mediaId: cap(id, 200)!, mediaMime: mime, mediaSize: typeof doc.file_size === 'number' ? doc.file_size : undefined }
  }
  return null
}

/**
 * One Telegram update. Private chats only: a bot added to a group must not
 * bind or answer the group (the binding is per person).
 */
export function parseTelegram(body: unknown): InboundEvent | null {
  const u = obj(body)
  const updateId = str(u?.update_id)
  if (!u || !updateId) return null
  const message = obj(u.message)
  if (message) {
    const chat = obj(message.chat)
    const chatId = str(chat?.id)
    if (!chatId || chat?.type !== 'private') return null
    const from = obj(message.from)
    if (from?.is_bot === true) return null
    const sentAt = Number(str(message.date) ?? '0') * 1000 || Date.now()
    const photo = telegramPhoto(message)
    if (photo) {
      return {
        provider: 'telegram',
        externalId: updateId,
        address: chatId,
        kind: 'image',
        ...photo,
        text: cap(str(message.caption), MAX_TEXT_CHARS),
        profileName: cap(str(from?.first_name), 80),
        sentAt,
      }
    }
    const text = str(message.text)
    return {
      provider: 'telegram',
      externalId: updateId,
      address: chatId,
      kind: text !== undefined ? 'text' : 'unsupported',
      text: cap(text, MAX_TEXT_CHARS),
      profileName: cap(str(from?.first_name), 80),
      sentAt,
    }
  }
  const cb = obj(u.callback_query)
  if (cb) {
    const msg = obj(cb.message)
    const chat = obj(msg?.chat)
    const chatId = str(chat?.id)
    const data = cap(str(cb.data), MAX_BUTTON_ID_CHARS)
    const cbId = cap(str(cb.id), 100)
    if (!chatId || !cbId || chat?.type !== 'private') return null
    return {
      provider: 'telegram',
      externalId: updateId,
      address: chatId,
      kind: data ? 'button' : 'unsupported',
      buttonId: data,
      callbackQueryId: cbId,
      profileName: cap(str(obj(cb.from)?.first_name), 80),
      sentAt: Date.now(),
    }
  }
  return null
}
