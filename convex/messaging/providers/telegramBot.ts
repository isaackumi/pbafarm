import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import type { FetchFn } from '../../lib/effectHttp'
import { decodeBody, providerPost, runSend, SEND_TIMEOUT_MS } from './send'
import type { HttpPolicy, HttpTransportError } from '../../lib/effectHttp'
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
 *
 * Verified 2026-11-21 (morning round, T1a/T1b):
 * - POST …/editMessageText { chat_id, message_id, text, parse_mode?, reply_markup? }
 *   edits a bot message in place; answer { ok: true, result: Message }.
 *   An edit with the same text and keyboard fails 400 "Bad Request: message
 *   is not modified" (treated as done). "message to edit not found" and
 *   "message can't be edited" (deleted, or older than 48 h) mean: send anew.
 * - parse_mode "HTML" allows <b>, <i>, <pre>, <code>, <blockquote>; every
 *   other "<", ">" and "&" must be escaped (escapeHtml). Telegram cannot
 *   colour text or buttons, so the round card uses bold, monospace bars and
 *   leading markers instead.
 * - An inline keyboard is rows of buttons; we keep at most 100 buttons.
 *
 * Verified 2026-11-21 (group chats, VFQ-1):
 * - sendMessage works the same in groups and supergroups (negative chat id).
 *   reply_parameters { message_id, allow_sending_without_reply } quotes the
 *   message being answered.
 * - answerCallbackQuery { callback_query_id, text (0-200 chars), show_alert }
 *   shows the text to the person who tapped only (a toast, or a dialog).
 * - parse_mode HTML <a href="tg://user?id=123">Name</a> mentions a user
 *   without a @username; they are notified when they are in the group.
 * - Updates a bot gets with privacy mode on: /commands, @mentions, replies to
 *   its own messages, service messages; my_chat_member when the bot is added
 *   or removed (must be listed in setWebhook allowed_updates).
 */
const TgError = Schema.Struct({ description: Schema.optional(Schema.String) })
const TgSent = Schema.Struct({
  result: Schema.optional(Schema.Struct({ message_id: Schema.optional(Schema.Number) })),
})

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Escape user or record text for parse_mode HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Most buttons we put on one message (Telegram allows 100). */
export const MAX_KEYBOARD_BUTTONS = 100

const tgButton = (b: { id: string; title: string }) => ({ text: clip(b.title, 64), callback_data: b.id.slice(0, 64) })

/** The sendMessage body for a chat message (exported for tests). */
export function telegramPayload(chatId: string, message: ChatMessage): Record<string, unknown> {
  if (message.kind === 'keyboard') {
    let left = MAX_KEYBOARD_BUTTONS
    const rows: ReturnType<typeof tgButton>[][] = []
    for (const row of message.rows) {
      const cut = row.slice(0, Math.max(0, left)).map(tgButton)
      if (!cut.length) break
      rows.push(cut)
      left -= cut.length
    }
    return {
      chat_id: chatId,
      text: clip(message.text, 4096),
      ...(message.html ? { parse_mode: 'HTML' } : {}),
      ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
    }
  }
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
                ? buttons.map((b) => [tgButton(b)])
                : [buttons.slice(0, 3).map(tgButton)],
          },
        }
      : {}),
  }
}

function tgPost(token: string, method: string, body: unknown, policy?: HttpPolicy) {
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
    policy,
  )
}

/** Send a farm-bot message to a private chat or a group (`replyTo` quotes a group message). Never throws. */
export async function sendTelegramChat(
  token: string,
  chatId: string,
  message: ChatMessage,
  fetchImpl?: FetchFn,
  opts: { replyTo?: number } = {},
): Promise<SendResult> {
  const body = {
    ...telegramPayload(chatId, message),
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
  }
  const program = Effect.gen(function* () {
    const res = yield* tgPost(token, 'sendMessage', body)
    const id = decodeBody(TgSent, res)?.result?.message_id
    return { providerMessageId: id != null ? String(id) : undefined }
  })
  return runSend(program, fetchImpl)
}

/**
 * Acknowledge a button tap (best effort), optionally with a note only the
 * person who tapped sees ("Only Kofi can save this"). Never throws.
 */
export async function answerTelegramCallback(
  token: string,
  callbackQueryId: string,
  fetchImpl?: FetchFn,
  note?: { text: string; alert?: boolean },
) {
  const body = {
    callback_query_id: callbackQueryId,
    ...(note?.text ? { text: clip(note.text, 200), ...(note.alert ? { show_alert: true } : {}) } : {}),
  }
  return runSend(tgPost(token, 'answerCallbackQuery', body).pipe(Effect.as({})), fetchImpl)
}

/** Tag a person in a group: their @username, else an HTML text mention (parse_mode HTML). */
export function telegramMention(p: { userId: string; username?: string | null; name: string }): string {
  if (p.username && /^[A-Za-z0-9_]{5,32}$/.test(p.username)) return `@${p.username}`
  if (!/^\d{1,20}$/.test(p.userId)) return escapeHtml(p.name)
  return `<a href="tg://user?id=${p.userId}">${escapeHtml(p.name || 'there')}</a>`
}

/**
 * Edits are idempotent (the same text twice is "not modified"), so unlike a
 * send they are retried on a timeout as well as on 5xx and network errors.
 */
export const EDIT_POLICY: HttpPolicy = {
  timeoutMs: SEND_TIMEOUT_MS,
  retries: 2,
  retryBaseDelayMs: 300,
  retryOn: (error: HttpTransportError) =>
    error._tag === 'HttpNetworkError' ||
    error._tag === 'HttpTimeoutError' ||
    (error._tag === 'HttpStatusError' && error.status >= 500),
}

export type EditResult =
  | { ok: true; notModified: boolean }
  /** `gone`: the message cannot be edited any more (deleted, too old): send a new one. */
  | { ok: false; error: string; gone: boolean }

const NOT_MODIFIED = /message is not modified/i
const GONE = /message to edit not found|message can't be edited|message_id_invalid|MESSAGE_ID_INVALID/i

/**
 * Edit a message the bot sent (text and inline keyboard) in place. "Not
 * modified" counts as done. Never throws.
 */
export async function editTelegramChat(
  token: string,
  chatId: string,
  messageId: number,
  message: ChatMessage,
  fetchImpl?: FetchFn,
): Promise<EditResult> {
  const body = { ...telegramPayload(chatId, message), message_id: messageId }
  const program = tgPost(token, 'editMessageText', body, EDIT_POLICY).pipe(
    Effect.as({} as { providerMessageId?: string }),
    Effect.catchTag('ProviderRejected', (e) =>
      NOT_MODIFIED.test(e.message) ? Effect.succeed({ providerMessageId: 'not_modified' }) : Effect.fail(e),
    ),
  )
  const r = await runSend(program, fetchImpl)
  if (r.ok) return { ok: true, notModified: r.providerMessageId === 'not_modified' }
  return { ok: false, error: r.error, gone: GONE.test(r.error) || !r.retryable }
}
