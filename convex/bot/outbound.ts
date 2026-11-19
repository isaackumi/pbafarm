/**
 * Sending farm-bot replies (doc 23 §6). Platform bot credentials come from
 * the deployment env; nothing here reads the message content beyond sending
 * it. WhatsApp sends are recorded per org so Meta's status webhooks can attach
 * pricing (cost tracking).
 */
import type { ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { sendWhatsAppChat } from '../messaging/providers/whatsappCloud'
import { answerTelegramCallback, sendTelegramChat } from '../messaging/providers/telegramBot'
import type { ChatMessageValue, Target } from './validators'

export function whatsappBotConfig() {
  const phoneNumberId = process.env.WHATSAPP_BOT_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_BOT_ACCESS_TOKEN
  return phoneNumberId && accessToken ? { phoneNumberId, accessToken } : null
}

export function telegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || null
}

/** Send messages in order; stops at the first failure. Returns sent count and the first error. */
export async function deliver(
  ctx: ActionCtx,
  target: Pick<Target, 'provider' | 'address' | 'callbackQueryId' | 'companyId' | 'bindingId'>,
  messages: ChatMessageValue[],
): Promise<{ sent: number; error: string | null }> {
  let sent = 0
  if (target.provider === 'telegram') {
    const token = telegramBotToken()
    if (!token) return { sent, error: 'TELEGRAM_BOT_TOKEN is not set' }
    if (target.callbackQueryId) await answerTelegramCallback(token, target.callbackQueryId)
    for (const m of messages) {
      const r = await sendTelegramChat(token, target.address, m)
      if (!r.ok) return { sent, error: r.error }
      sent++
    }
    return { sent, error: null }
  }
  const config = whatsappBotConfig()
  if (!config) return { sent, error: 'WhatsApp bot credentials are not set' }
  const to = target.address.replace(/^\+/, '')
  for (const m of messages) {
    const r = await sendWhatsAppChat(config, to, m)
    if (!r.ok) return { sent, error: r.error }
    sent++
    if (r.providerMessageId && target.companyId) {
      await ctx.runMutation(internal.bot.inbound.recordSent, {
        provider: 'whatsapp',
        providerMessageId: r.providerMessageId,
        companyId: target.companyId,
        bindingId: target.bindingId,
        kind: m.kind === 'template' ? 'template' : 'free_form',
      })
    }
  }
  return { sent, error: null }
}
