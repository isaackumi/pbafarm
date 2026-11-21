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
  kind: 'text' | 'button' | 'image' | 'audio' | 'member' | 'unsupported'
  text?: string
  buttonId?: string
  callbackQueryId?: string
  profileName?: string
  /** Photo (BOT-006) or voice note (BOT-005): WhatsApp media id / Telegram file_id, declared type and size. Untrusted. */
  mediaId?: string
  mediaMime?: string
  mediaSize?: number
  /**
   * Telegram group chats (groups and supergroups). Absent for a private chat,
   * where the chat id is the sender's own id.
   */
  chatType?: 'group'
  /** Telegram sender (from.id) and @username, untrusted display data except the id Telegram signs for us. */
  senderId?: string
  senderUsername?: string
  chatTitle?: string
  /** Group message id (quoted in the reply), or the bot message a button sat on (edited in place). */
  messageId?: number
  /** kind 'member': the bot was added to or removed from the group, or the group became a supergroup. */
  member?: 'added' | 'removed' | 'migrated'
  migrateTo?: string
  sentAt: number
}

/** The bot itself, to tell which group messages are meant for it. */
export type TelegramBotSelf = { username?: string | null; id?: string | null }

/** The bot's numeric id is the part of the token before the colon. */
export function telegramBotSelf(token: string | undefined, username: string | undefined): TelegramBotSelf {
  const id = token && /^\d+:/.test(token) ? token.slice(0, token.indexOf(':')) : null
  return { username: username ? username.replace(/^@/, '') : null, id }
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
        } else if (type === 'audio') {
          // A voice note or audio file (BOT-005); the type is checked from the bytes later.
          const media = obj(m.audio)
          const mediaId = cap(str(media?.id), 200)
          if (mediaId) events.push({ ...base, kind: 'audio', mediaId, mediaMime: cap(str(media?.mime_type), 100)?.toLowerCase() })
          else events.push({ ...base, kind: 'unsupported' })
        } else if (type === 'image' || type === 'document') {
          // A logbook photo (BOT-006); a document only when it says it is an image (or audio, BOT-005).
          const media = obj(type === 'image' ? m.image : m.document)
          const mediaId = cap(str(media?.id), 200)
          const mime = cap(str(media?.mime_type), 100)?.toLowerCase()
          if (mediaId && (type === 'image' || mime?.startsWith('image/'))) {
            events.push({ ...base, kind: 'image', mediaId, mediaMime: mime, text: cap(str(media?.caption), MAX_TEXT_CHARS) })
          } else if (mediaId && mime?.startsWith('audio/')) {
            events.push({ ...base, kind: 'audio', mediaId, mediaMime: mime })
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

/** A voice note, an audio file, or an audio document (BOT-005). */
function telegramAudio(message: Obj): { mediaId: string; mediaMime?: string; mediaSize?: number } | null {
  for (const key of ['voice', 'audio', 'document'] as const) {
    const m = obj(message[key])
    const id = str(m?.file_id)
    const mime = cap(str(m?.mime_type), 100)?.toLowerCase()
    if (!m || !id) continue
    if (key === 'document' && !mime?.startsWith('audio/')) continue
    return { mediaId: cap(id, 200)!, mediaMime: mime, mediaSize: typeof m.file_size === 'number' ? m.file_size : undefined }
  }
  return null
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a group message is for the bot (Telegram privacy mode delivers
 * these): an @mention of the bot, a reply to one of its messages, or a
 * /command that is not addressed to another bot. Returns the text with the
 * mention and the command's @bot suffix removed, or null when it is not
 * for us.
 */
export function addressedText(message: Obj, bot: TelegramBotSelf): string | null {
  const raw = str(message.text) ?? str(message.caption) ?? ''
  const name = bot.username?.toLowerCase() ?? null
  const entities = arr(message.entities ?? message.caption_entities).map(obj).filter((e): e is Obj => !!e)
  let addressed = false
  for (const e of entities) {
    const at = Number(e.offset ?? -1)
    const len = Number(e.length ?? 0)
    if (at < 0 || len <= 0) continue
    const piece = raw.slice(at, at + len)
    if (e.type === 'mention' && name && piece.toLowerCase() === `@${name}`) addressed = true
    if (e.type === 'bot_command' && at === 0) {
      const target = piece.includes('@') ? piece.slice(piece.indexOf('@') + 1).toLowerCase() : null
      if (target === null || (name && target === name)) addressed = true
    }
  }
  // Without entities (edited clients, tests): the same rules on the text.
  if (!entities.length) {
    if (name && new RegExp(`(^|\\s)@${escapeRe(name)}\\b`, 'i').test(raw)) addressed = true
    const cmd = /^\/[a-z0-9_]+(?:@([a-z0-9_]+))?/i.exec(raw)
    if (cmd && (!cmd[1] || (name && cmd[1].toLowerCase() === name))) addressed = true
  }
  const replyFrom = obj(obj(message.reply_to_message)?.from)
  if (replyFrom) {
    const id = str(replyFrom.id)
    const uname = str(replyFrom.username)?.toLowerCase()
    if ((bot.id && id === bot.id) || (name && replyFrom.is_bot === true && uname === name)) addressed = true
  }
  if (!addressed) return null
  let out = raw
  if (name) {
    out = out.replace(new RegExp(`^(\\/[a-z0-9_]+)@${escapeRe(name)}\\b`, 'i'), '$1')
    out = out.replace(new RegExp(`(^|\\s)@${escapeRe(name)}\\b[:,]?`, 'gi'), '$1')
  }
  return out.replace(/\s+/g, ' ').trim()
}

function telegramGroup(updateId: string, u: Obj, bot: TelegramBotSelf): InboundEvent | null {
  const mcm = obj(u.my_chat_member)
  if (mcm) {
    const chat = obj(mcm.chat)
    const chatId = str(chat?.id)
    if (!chatId || (chat?.type !== 'group' && chat?.type !== 'supergroup')) return null
    const status = str(obj(mcm.new_chat_member)?.status)
    const member = status === 'left' || status === 'kicked' ? 'removed' : status === 'member' || status === 'administrator' ? 'added' : null
    if (!member) return null
    const from = obj(mcm.from)
    return {
      provider: 'telegram',
      externalId: updateId,
      address: chatId,
      kind: 'member',
      member,
      chatType: 'group',
      senderId: cap(str(from?.id), 32),
      chatTitle: cap(str(chat?.title), 120),
      profileName: cap(str(from?.first_name), 80),
      sentAt: Number(str(mcm.date) ?? '0') * 1000 || Date.now(),
    }
  }
  const message = obj(u.message)
  if (message) {
    const chat = obj(message.chat)
    const chatId = str(chat?.id)
    const from = obj(message.from)
    if (!chatId || from?.is_bot === true) return null
    const sentAt = Number(str(message.date) ?? '0') * 1000 || Date.now()
    const migrateTo = str(message.migrate_to_chat_id)
    if (migrateTo) {
      return { provider: 'telegram', externalId: updateId, address: chatId, kind: 'member', member: 'migrated', migrateTo: cap(migrateTo, 32), chatType: 'group', sentAt }
    }
    const text = addressedText(message, bot)
    if (text === null) return null
    const media = !!(message.photo || message.voice || message.audio || message.document || message.video)
    return {
      provider: 'telegram',
      externalId: updateId,
      address: chatId,
      // Photos and voice notes are read in the private chat only.
      kind: media ? 'unsupported' : str(message.text) !== undefined ? 'text' : 'unsupported',
      text: cap(text, MAX_TEXT_CHARS),
      chatType: 'group',
      senderId: cap(str(from?.id), 32),
      senderUsername: cap(str(from?.username), 64),
      chatTitle: cap(str(chat?.title), 120),
      messageId: typeof message.message_id === 'number' ? message.message_id : undefined,
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
    const from = obj(cb.from)
    if (!chatId || !cbId) return null
    return {
      provider: 'telegram',
      externalId: updateId,
      address: chatId,
      kind: data ? 'button' : 'unsupported',
      buttonId: data,
      callbackQueryId: cbId,
      chatType: 'group',
      senderId: cap(str(from?.id), 32),
      senderUsername: cap(str(from?.username), 64),
      chatTitle: cap(str(chat?.title), 120),
      messageId: typeof msg?.message_id === 'number' ? msg.message_id : undefined,
      profileName: cap(str(from?.first_name), 80),
      sentAt: Date.now(),
    }
  }
  return null
}

/** The chat type of an update: private, group (group or supergroup), or other (channels). */
function chatKind(u: Obj): 'private' | 'group' | 'other' {
  const chat = obj(obj(u.message)?.chat) ?? obj(obj(obj(u.callback_query)?.message)?.chat) ?? obj(obj(u.my_chat_member)?.chat)
  const type = str(chat?.type)
  if (type === 'private') return 'private'
  if (type === 'group' || type === 'supergroup') return 'group'
  return 'other'
}

/**
 * One Telegram update. Private chats bind a person; groups and supergroups
 * are handled by convex/bot/chatGroups.ts and only messages meant for the
 * bot get through (see addressedText). Channels are ignored.
 */
export function parseTelegram(body: unknown, bot: TelegramBotSelf = {}): InboundEvent | null {
  const u = obj(body)
  const updateId = str(u?.update_id)
  if (!u || !updateId) return null
  const kind = chatKind(u)
  if (kind === 'group') return telegramGroup(updateId, u, bot)
  if (kind !== 'private') return null
  const message = obj(u.message)
  if (message) {
    const chat = obj(message.chat)
    const chatId = str(chat?.id)
    if (!chatId) return null
    const from = obj(message.from)
    if (from?.is_bot === true) return null
    const username = cap(str(from?.username), 64)
    const who = { profileName: cap(str(from?.first_name), 80), ...(username ? { senderUsername: username } : {}) }
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
        ...who,
        sentAt,
      }
    }
    const audio = telegramAudio(message)
    if (audio) {
      return {
        provider: 'telegram',
        externalId: updateId,
        address: chatId,
        kind: 'audio',
        ...audio,
        ...who,
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
      ...who,
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
    if (!chatId || !cbId) return null
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
