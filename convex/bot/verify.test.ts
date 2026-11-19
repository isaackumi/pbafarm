import { describe, expect, test } from 'vitest'
import { hmacSha256HexBytes, metaHandshake, parseTelegram, parseWhatsApp, verifyMetaSignature, verifyTelegramSecret } from './verify'
import { telegramPayload } from '../messaging/providers/telegramBot'
import { whatsappChatPayload } from '../messaging/providers/whatsappCloud'

const enc = (s: string) => new TextEncoder().encode(s)

describe('webhook verification', () => {
  test('Meta signature over raw bytes', async () => {
    const body = enc('{"a":1}')
    const sig = await hmacSha256HexBytes('secret', body)
    expect(await verifyMetaSignature(body, `sha256=${sig}`, 'secret')).toBe(true)
    expect(await verifyMetaSignature(enc('{"a": 1}'), `sha256=${sig}`, 'secret')).toBe(false)
    expect(await verifyMetaSignature(body, `sha256=${sig}`, 'other')).toBe(false)
    expect(await verifyMetaSignature(body, sig, 'secret')).toBe(false)
    expect(await verifyMetaSignature(body, null, 'secret')).toBe(false)
    expect(await verifyMetaSignature(body, `sha256=${sig}`, undefined)).toBe(false)
  })

  test('Telegram secret and Meta handshake fail closed without config', () => {
    expect(verifyTelegramSecret('s', 's')).toBe(true)
    expect(verifyTelegramSecret('s', undefined)).toBe(false)
    expect(verifyTelegramSecret(null, 's')).toBe(false)
    const p = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 't', 'hub.challenge': 'c' })
    expect(metaHandshake(p, 't')).toBe('c')
    expect(metaHandshake(p, undefined)).toBeNull()
    expect(metaHandshake(p, 'x')).toBeNull()
  })
})

describe('parsing', () => {
  test('WhatsApp ignores other phone numbers and caps text', () => {
    const body = (pnid: string) => ({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: pnid },
        messages: [{ id: 'w1', from: '233200000001', timestamp: '1', type: 'text', text: { body: 'x'.repeat(5000) } }],
        statuses: [{ id: 'o1', status: 'delivered', pricing: { billable: true, category: 'utility', pricing_model: 'PMP' } }],
      } }] }],
    })
    const r = parseWhatsApp(body('PNID'), 'PNID')
    expect(r.events[0]).toMatchObject({ address: '+233200000001', kind: 'text', externalId: 'w1' })
    expect(r.events[0].text).toHaveLength(2000)
    expect(r.statuses[0]).toMatchObject({ providerMessageId: 'o1', category: 'utility', billable: true })
    expect(parseWhatsApp(body('OTHER'), 'PNID')).toEqual({ events: [], statuses: [] })
    expect(parseWhatsApp(body('PNID'), undefined)).toEqual({ events: [], statuses: [] })
  })

  test('Telegram private chats only; callback queries become buttons', () => {
    expect(parseTelegram({ update_id: 1, message: { date: 1, chat: { id: 5, type: 'group' }, text: 'hi' } })).toBeNull()
    expect(
      parseTelegram({ update_id: 2, callback_query: { id: 'cb', data: 'ok:abc', from: { id: 5 }, message: { chat: { id: 5, type: 'private' } } } }),
    ).toMatchObject({ kind: 'button', buttonId: 'ok:abc', callbackQueryId: 'cb', address: '5' })
  })
})

describe('outbound payloads', () => {
  const msg = { kind: 'buttons' as const, text: 'Save?', buttons: [{ id: 'ok:1', title: 'Save' }, { id: 'no:1', title: 'Cancel' }] }
  test('WhatsApp interactive reply buttons', () => {
    const p = whatsappChatPayload('233200000001', msg) as { type: string; interactive: { action: { buttons: unknown[] } } }
    expect(p.type).toBe('interactive')
    expect(p.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'ok:1', title: 'Save' } },
      { type: 'reply', reply: { id: 'no:1', title: 'Cancel' } },
    ])
  })
  test('Telegram inline keyboard', () => {
    expect(telegramPayload('5', msg)).toEqual({
      chat_id: '5',
      text: 'Save?',
      reply_markup: { inline_keyboard: [[{ text: 'Save', callback_data: 'ok:1' }, { text: 'Cancel', callback_data: 'no:1' }]] },
    })
  })
})
