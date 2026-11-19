import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import type { FetchFn } from '../../lib/effectHttp'
import { decodeBody, providerPost, runSend } from './send'
import { providerError, type SendResult } from './types'
import type { ChatMessage } from './whatsappCloud'

/**
 * Telegram Bot API for the farm bot (BOT-008, doc 23).
 *
 * Verified 2026-11-19 against https://core.telegram.org/bots/api:
 * - POST https://api.telegram.org/bot<token>/sendMessage
 *   { chat_id, text, reply_markup: { inline_keyboard: [[{ text, callback_data }]] } }
 *   callback_data is 1-64 bytes; answer: { ok: true, result: { message_id } }.
 * - POST …/answerCallbackQuery { callback_query_id } stops the button spinner.
 * - Errors: { ok: false, error_code, description }.
 * Telegram has no 24-hour window or templates: a template renders as its
 * fallback text and buttons.
 */
const TgError = Schema.Struct({ description: Schema.optional(Schema.String) })
const TgSent = Schema.Struct({
  result: Schema.optional(Schema.Struct({ message_id: Schema.optional(Schema.Number) })),
})

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The sendMessage body for a chat message (exported for tests). */
export function telegramPayload(chatId: string, message: ChatMessage): Record<string, unknown> {
  const text =
    message.kind === 'template' ? message.fallbackText : message.text
  const buttons =
    message.kind === 'buttons'
      ? message.buttons
      : message.kind === 'list'
        ? message.rows
        : message.kind === 'template'
          ? message.fallbackButtons
          : []
  return {
    chat_id: chatId,
    text: clip(text, 4096),
    ...(buttons.length
      ? {
          reply_markup: {
            // Pick lists one per row; up to 3 action buttons side by side.
            inline_keyboard:
              message.kind === 'list'
                ? buttons.map((b) => [{ text: clip(b.title, 64), callback_data: b.id.slice(0, 64) }])
                : [buttons.slice(0, 3).map((b) => ({ text: clip(b.title, 64), callback_data: b.id.slice(0, 64) }))],
          },
        }
      : {}),
  }
}

function tgPost(token: string, method: string, body: unknown) {
  return providerPost(
    {
      url: `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    (status, json, text) => {
      const decoded = Schema.decodeUnknownOption(TgError)(json)
      const description = decoded._tag === 'Some' ? decoded.value.description : undefined
      // Never echo the URL: it carries the bot token.
      return description ? `Telegram ${status}: ${description.slice(0, 160)}` : providerError(status, text)
    },
  )
}

/** Send a farm-bot message to a private chat. Never throws. */
export async function sendTelegramChat(
  token: string,
  chatId: string,
  message: ChatMessage,
  fetchImpl?: FetchFn,
): Promise<SendResult> {
  const program = Effect.gen(function* () {
    const res = yield* tgPost(token, 'sendMessage', telegramPayload(chatId, message))
    const id = decodeBody(TgSent, res)?.result?.message_id
    return { providerMessageId: id != null ? String(id) : undefined }
  })
  return runSend(program, fetchImpl)
}

/** Acknowledge a button tap (best effort). Never throws. */
export async function answerTelegramCallback(token: string, callbackQueryId: string, fetchImpl?: FetchFn) {
  return runSend(
    tgPost(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId }).pipe(Effect.as({})),
    fetchImpl,
  )
}
