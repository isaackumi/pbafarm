/**
 * Farm bot webhooks (BOT-001, doc 23 §2):
 *   GET  /channels/whatsapp  Meta's verify-token handshake
 *   POST /channels/whatsapp  X-Hub-Signature-256 over the raw body (app secret)
 *   POST /channels/telegram  X-Telegram-Bot-Api-Secret-Token
 *
 * Verification happens on the raw bytes before parsing and before any
 * database write. Valid requests are stored by `inbound.ingest` (idempotent
 * per provider message id) and answered 200 at once; no LLM runs here.
 */
import { httpAction } from '../_generated/server'
import { internal } from '../_generated/api'
import {
  MAX_BODY_BYTES,
  metaHandshake,
  parseTelegram,
  parseWhatsApp,
  telegramBotSelf,
  verifyMetaSignature,
  verifyTelegramSecret,
} from './verify'

const ok = () => new Response('ok', { status: 200 })
const deny = (status: number) => new Response(null, { status })

/** The raw body, or null when it is over the cap (declared or actual). */
async function rawBody(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return null
  const buf = new Uint8Array(await request.arrayBuffer())
  return buf.byteLength > MAX_BODY_BYTES ? null : buf
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export const whatsappVerify = httpAction(async (_ctx, request) => {
  const challenge = metaHandshake(new URL(request.url).searchParams, process.env.WHATSAPP_VERIFY_TOKEN)
  if (challenge === null) return deny(403)
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
})

export const whatsappWebhook = httpAction(async (ctx, request) => {
  const body = await rawBody(request)
  if (!body) return deny(413)
  const signed = await verifyMetaSignature(body, request.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET)
  if (!signed) return deny(401)
  const json = parseJson(body)
  if (json === null) return ok()
  const { events, statuses } = parseWhatsApp(json, process.env.WHATSAPP_BOT_PHONE_NUMBER_ID)
  if (events.length || statuses.length) await ctx.runMutation(internal.bot.inbound.ingest, { events, statuses })
  return ok()
})

export const telegramWebhook = httpAction(async (ctx, request) => {
  if (!verifyTelegramSecret(request.headers.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return deny(401)
  }
  const body = await rawBody(request)
  if (!body) return deny(413)
  const event = parseTelegram(
    parseJson(body),
    telegramBotSelf(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_BOT_USERNAME),
  )
  if (event) await ctx.runMutation(internal.bot.inbound.ingest, { events: [event], statuses: [] })
  return ok()
})
