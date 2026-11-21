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

  test('Telegram: unaddressed group text is dropped; callback queries become buttons', () => {
    expect(parseTelegram({ update_id: 1, message: { date: 1, chat: { id: 5, type: 'group' }, text: 'hi' } })).toBeNull()
    expect(
      parseTelegram({ update_id: 2, callback_query: { id: 'cb', data: 'ok:abc', from: { id: 5 }, message: { chat: { id: 5, type: 'private' } } } }),
    ).toMatchObject({ kind: 'button', buttonId: 'ok:abc', callbackQueryId: 'cb', address: '5' })
  })

  test('Telegram groups: only mentions, replies to the bot and commands for it get through', () => {
    const bot = { id: '123', username: 'askAnowa_bot' }
    const now = Math.floor(Date.now() / 1000)
    const msg = (text: string, extra: Record<string, unknown> = {}) => ({
      update_id: 9,
      message: { message_id: 4, date: now, text, chat: { id: -100, type: 'supergroup', title: 'Crew' }, from: { id: 77, first_name: 'Kofi', username: 'kofi_a' }, ...extra },
    })
    expect(parseTelegram(msg('summary from offshore'), bot)).toBeNull()
    expect(parseTelegram(msg('/today@otherBot'), bot)).toBeNull()
    expect(parseTelegram(msg('@askAnowa_bot get me summary from offshore'), bot)).toMatchObject({
      kind: 'text', text: 'get me summary from offshore', chatType: 'group', address: '-100', senderId: '77', senderUsername: 'kofi_a', messageId: 4,
    })
    expect(parseTelegram(msg('/summary@askAnowa_bot offshore'), bot)).toMatchObject({ text: '/summary offshore' })
    expect(parseTelegram(msg('/today'), bot)).toMatchObject({ text: '/today' })
    expect(parseTelegram(msg('and yesterday?', { reply_to_message: { message_id: 3, from: { id: 123, is_bot: true } } }), bot)).toMatchObject({
      text: 'and yesterday?',
    })
    // Entities are authoritative when present: a mention of someone else is not for the bot.
    expect(parseTelegram(msg('@kofi_a summary', { entities: [{ type: 'mention', offset: 0, length: 7 }] }), bot)).toBeNull()
    // Channels never.
    expect(parseTelegram({ update_id: 9, message: { date: now, text: '/today', chat: { id: -5, type: 'channel' } } }, bot)).toBeNull()
  })

  test('Telegram my_chat_member: the bot added to or removed from a group', () => {
    const update = (status: string) => ({
      update_id: 10,
      my_chat_member: {
        date: Math.floor(Date.now() / 1000), chat: { id: -100, type: 'group', title: 'Crew' }, from: { id: 77, first_name: 'Ama' },
        new_chat_member: { status, user: { id: 123, is_bot: true } },
      },
    })
    expect(parseTelegram(update('kicked'))).toMatchObject({ kind: 'member', member: 'removed', address: '-100', senderId: '77' })
    expect(parseTelegram(update('left'))).toMatchObject({ kind: 'member', member: 'removed' })
    expect(parseTelegram(update('member'))).toMatchObject({ kind: 'member', member: 'added', chatTitle: 'Crew' })
    expect(parseTelegram(update('restricted'))).toBeNull()
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
