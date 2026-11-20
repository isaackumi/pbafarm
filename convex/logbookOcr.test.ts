/// <reference types="vite/client" />
/**
 * BOT-006: a logbook photo over WhatsApp/Telegram becomes drafts, saved only
 * on a tap. Network is a scripted fake on global fetch: Meta media + sends,
 * Telegram getFile + file + sends, and Gemini (the server key) for vision.
 */
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { Doc, Id } from './_generated/dataModel'
import { hmacSha256HexBytes } from './bot/verify'

const modules = import.meta.glob('./**/*.ts')

const ENV = {
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_BOT_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BOT_ACCESS_TOKEN: 'wa-token',
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_WEBHOOK_SECRET: 'tg-secret',
  GEMINI_API_KEY: 'test-key',
}
const PHONE = '+233200000001'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])

type Sent = { url: string; body: Record<string, unknown> }
let sent: Sent[] = []
let visionCalls = 0
let mediaDownloads = 0
/** What the vision model answers next. */
let visionText = ''
let mediaSize = JPEG.length

beforeEach(() => {
  for (const [k, val] of Object.entries(ENV)) vi.stubEnv(k, val)
  sent = []
  visionCalls = 0
  mediaDownloads = 0
  mediaSize = JPEG.length
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        visionCalls++
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: visionText }] } }],
            usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 80 },
          }),
          { status: 200 },
        )
      }
      if (url.startsWith('https://graph.facebook.com/v27.0/MEDIA')) {
        return new Response(
          JSON.stringify({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', file_size: mediaSize }),
          { status: 200 },
        )
      }
      if (url.startsWith('https://lookaside.fbsbx.com/') || url.startsWith('https://api.telegram.org/file/')) {
        mediaDownloads++
        return new Response(JPEG, { status: 200 })
      }
      if (url.includes('/getFile')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/p.jpg', file_size: mediaSize } }), { status: 200 })
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      sent.push({ url, body })
      if (url.includes('graph.facebook.com')) {
        return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 })
    }),
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function setup(opts: { aiEnabled?: boolean } = {}) {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: opts.aiEnabled ?? true },
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River', code: 'RIVER', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const siteA1 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const siteA2 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'South', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B site', active: true, updatedAt: now })
    const staff = await ctx.db.insert('users', {
      email: 'staff@a.com', name: 'Ama', role: 'user', companyId: companyA, phone: PHONE, phoneVerificationTime: now,
    })
    await ctx.db.insert('memberships', {
      userId: staff, companyId: companyA, roleKey: 'field_staff', allLocations: false, locationIds: [siteA1],
      status: 'active', updatedAt: now,
    })
    const other = await ctx.db.insert('users', { email: 'kofi@b.com', name: 'Kofi', role: 'user', companyId: companyB })
    await ctx.db.insert('memberships', {
      userId: other, companyId: companyB, roleKey: 'field_staff', allLocations: true, status: 'active', updatedAt: now,
    })
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10,
        stockingDate: '2026-10-01', companyId, locationId, updatedAt: now,
      })
    const cageA1 = await cage('A1', companyA, siteA1)
    const cageC10 = await cage('C10', companyA, siteA1)
    await cage('A2', companyA, siteA2)
    await cage('B1', companyB, siteB)
    await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 500, minimumStock: 10, pricePerKg: 10, active: true,
      bagSizeKg: 20, companyId: companyA, updatedAt: now,
    })
    const waBinding = await ctx.db.insert('channelBindings', {
      provider: 'whatsapp', address: PHONE, userId: staff, companyId: companyA, verifiedAt: now,
    })
    const tgBinding = await ctx.db.insert('channelBindings', {
      provider: 'telegram', address: '777', userId: staff, companyId: companyA, verifiedAt: now,
    })
    const otherBinding = await ctx.db.insert('channelBindings', {
      provider: 'telegram', address: '888', userId: other, companyId: companyB, verifiedAt: now,
    })
    return { companyA, companyB, staff, cageA1, cageC10, waBinding, tgBinding, otherBinding }
  })
  return { t, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

let seq = 0
function waPayload(message: Record<string, unknown>, id = `wamid.in${++seq}`) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'PNID' },
              contacts: [{ wa_id: PHONE.slice(1), profile: { name: 'Ama' } }],
              messages: [{ id, from: PHONE.slice(1), timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
            },
          },
        ],
      },
    ],
  }
}
const waPhoto = (id?: string) => waPayload({ type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg' } }, id)
const waButton = (buttonId: string) =>
  waPayload({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } } })

async function postWhatsApp(s: S, payload: unknown) {
  const raw = JSON.stringify(payload)
  const sig = await hmacSha256HexBytes(ENV.WHATSAPP_APP_SECRET, new TextEncoder().encode(raw))
  return await s.t.fetch('/channels/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}` },
    body: raw,
  })
}

let updateId = 1000
async function postTelegram(s: S, update: Record<string, unknown>) {
  return await s.t.fetch('/channels/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': ENV.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({ update_id: ++updateId, ...update }),
  })
}
const tgMessage = (chatId: string, extra: Record<string, unknown>) => ({
  message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: Number(chatId), type: 'private' }, from: { id: 1 }, ...extra },
})

/** Run the scheduled processing and return what the bot sent back (text + button ids). */
async function drain(s: S) {
  const before = sent.length
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  return sent.slice(before).filter((m) => !m.url.includes('answerCallbackQuery')).map((m) => {
    const b = m.body as {
      text?: string | { body?: string }
      interactive?: { body?: { text?: string }; action?: { buttons?: { reply: { id: string } }[] } }
      reply_markup?: { inline_keyboard: { callback_data: string }[][] }
    }
    const text = typeof b.text === 'string' ? b.text : (b.text?.body ?? b.interactive?.body?.text ?? '')
    const buttons = [
      ...(b.interactive?.action?.buttons?.map((x) => x.reply.id) ?? []),
      ...(b.reply_markup?.inline_keyboard.flat().map((x) => x.callback_data) ?? []),
    ]
    return { text, buttons }
  })
}

type Table = 'pendingBotActions' | 'dailyRecords' | 'logbookScans' | 'files' | 'llmUsage' | 'channelInbound'
const rows = <T extends Table>(s: S, table: T): Promise<Doc<T>[]> =>
  s.t.run(async (ctx) => (await ctx.db.query(table).collect()) as Doc<T>[])

const PAGE = JSON.stringify({
  date: null,
  rows: [
    { unit: 'A1', feedType: 'Grower', feedKg: 25, mortality: 2, dissolvedOxygen: 5.1, temperatureC: 28 },
    { unit: 'CIO', feedKg: 12, mortality: 0 },
    { unit: 'A2', feedKg: 10, mortality: 1 },
    { unit: 'B1', feedKg: 40, mortality: 0 },
    { unit: 'Z99', feedKg: 3 },
  ],
})

describe('BOT-006 logbook photo OCR', () => {
  test('a WhatsApp photo becomes drafts; nothing is saved until Save all', async () => {
    const s = await setup()
    visionText = PAGE
    expect((await postWhatsApp(s, waPhoto())).status).toBe(200)
    const replies = await drain(s)

    expect(visionCalls).toBe(1)
    const drafts = await rows(s, 'pendingBotActions')
    // A1 exact, CIO → C10 (look-alike). A2 is another site, B1 another organization, Z99 unknown.
    expect(drafts.map((d) => d.payload.kind === 'daily_entry' && d.payload.cageName).sort()).toEqual(['A1', 'C10'])
    expect(drafts.every((d) => d.status === 'pending' && d.scanId)).toBe(true)
    const a1 = drafts.find((d) => d.payload.kind === 'daily_entry' && d.payload.cageName === 'A1')!
    expect(a1.payload).toMatchObject({ feedKg: 25, mortality: 2, dissolvedOxygen: 5.1, temperatureC: 28, feedTypeName: 'Grower' })
    expect(drafts.find((d) => d !== a1)!.summary).toMatch(/read as "CIO"/)
    expect(await rows(s, 'dailyRecords')).toHaveLength(0)

    const [scan] = await rows(s, 'logbookScans')
    expect(scan).toMatchObject({ status: 'ready', rowCount: 5, draftCount: 2 })
    expect(scan.flagged!.map((f) => f.unit).sort()).toEqual(['A2', 'B1', 'Z99'])
    const [file] = await rows(s, 'files')
    expect(file).toMatchObject({ companyId: s.companyA, entityType: 'logbookScans', entityId: scan._id, mime: 'image/jpeg' })
    const usage = await rows(s, 'llmUsage')
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ feature: 'ocr', ok: true, inputTokens: 1000, companyId: s.companyA })

    expect(replies).toHaveLength(1)
    expect(replies[0].text).toMatch(/Nothing is saved yet/)
    expect(replies[0].text).toMatch(/"B1"/)
    expect(replies[0].buttons).toEqual([`lba:${scan._id}`, `lbr:${scan._id}`, `lbx:${scan._id}`])

    await postWhatsApp(s, waButton(`lba:${scan._id}`))
    const saved = await drain(s)
    expect(saved[0].text).toMatch(/Saved 2 of 2/)
    const records = await rows(s, 'dailyRecords')
    expect(records.map((r) => r.cageId).sort()).toEqual([s.cageA1, s.cageC10].sort())
    expect(records.find((r) => r.cageId === s.cageA1)).toMatchObject({ feedAmount: 25, mortality: 2, dissolvedOxygen: 5.1 })

    // A second tap writes nothing more.
    await postWhatsApp(s, waButton(`lba:${scan._id}`))
    await drain(s)
    expect(await rows(s, 'dailyRecords')).toHaveLength(2)
  })

  test('Review each and Discard all; discarded drafts never save', async () => {
    const s = await setup()
    visionText = PAGE
    await postWhatsApp(s, waPhoto())
    await drain(s)
    const [scan] = await rows(s, 'logbookScans')
    await postWhatsApp(s, waButton(`lbr:${scan._id}`))
    const review = await drain(s)
    expect(review).toHaveLength(2)
    expect(review[0].buttons[0]).toMatch(/^ok:/)

    await postWhatsApp(s, waButton(`lbx:${scan._id}`))
    expect((await drain(s))[0].text).toMatch(/Discarded 2 drafts/)
    expect((await rows(s, 'pendingBotActions')).every((d) => d.status === 'cancelled')).toBe(true)
    await postWhatsApp(s, waButton(`lba:${scan._id}`))
    expect((await drain(s))[0].text).toMatch(/No drafts from this page/)
    expect(await rows(s, 'dailyRecords')).toHaveLength(0)
  })

  test('webhook retry of the same message reads the photo once', async () => {
    const s = await setup()
    visionText = PAGE
    await postWhatsApp(s, waPhoto('wamid.retry'))
    await postWhatsApp(s, waPhoto('wamid.retry'))
    await drain(s)
    expect(await rows(s, 'channelInbound')).toHaveLength(1)
    expect(await rows(s, 'logbookScans')).toHaveLength(1)
    expect(visionCalls).toBe(1)
    expect(await rows(s, 'pendingBotActions')).toHaveLength(2)
  })

  test('AI disabled for the organization: no download, no model call, no drafts', async () => {
    const s = await setup({ aiEnabled: false })
    visionText = PAGE
    await postWhatsApp(s, waPhoto())
    const replies = await drain(s)
    expect(replies[0].text).toMatch(/not enabled for your organization/)
    expect(visionCalls).toBe(0)
    expect(mediaDownloads).toBe(0)
    expect(await rows(s, 'logbookScans')).toHaveLength(0)
    expect(await rows(s, 'pendingBotActions')).toHaveLength(0)
  })

  test('another organization cannot touch the scan; its units are never matched', async () => {
    const s = await setup()
    visionText = PAGE
    await postWhatsApp(s, waPhoto())
    await drain(s)
    const [scan] = await rows(s, 'logbookScans')
    // Organization B's chat taps Save all / Discard all with organization A's scan id.
    for (const verb of ['lba', 'lbx']) {
      await postTelegram(s, { callback_query: { id: `cb-${verb}`, data: `${verb}:${scan._id}`, from: { id: 2 }, message: { chat: { id: 888, type: 'private' } } } })
      expect((await drain(s))[0].text).toMatch(/no longer open/)
    }
    expect((await rows(s, 'pendingBotActions')).every((d) => d.status === 'pending')).toBe(true)
    expect(await rows(s, 'dailyRecords')).toHaveLength(0)
    // B1 (organization B) was read off the page but not drafted.
    expect(scan.flagged!.some((f) => f.unit === 'B1')).toBe(true)
  })

  test('a model answer that is not the logbook JSON is refused and still metered', async () => {
    const s = await setup()
    visionText = '{"rows":[{"unit":7,"feedKg":"lots"}]}'
    await postWhatsApp(s, waPhoto())
    const replies = await drain(s)
    expect(replies[0].text).toMatch(/could not read this page/)
    expect(await rows(s, 'pendingBotActions')).toHaveLength(0)
    const [scan] = await rows(s, 'logbookScans')
    expect(scan.status).toBe('failed')
    const [usage] = await rows(s, 'llmUsage')
    expect(usage).toMatchObject({ feature: 'ocr', ok: false, inputTokens: 1000 })
  })

  test('oversized media is refused before the model runs', async () => {
    const s = await setup()
    visionText = PAGE
    // Telegram declares the size in the update: refused in route, nothing fetched.
    await postTelegram(s, tgMessage('777', { photo: [{ file_id: 'AgAD-big', width: 4000, height: 3000, file_size: 9 * 1024 * 1024 }] }))
    expect((await drain(s))[0].text).toMatch(/too large/)
    // WhatsApp declares it in the media lookup: refused before download.
    mediaSize = 20 * 1024 * 1024
    await postWhatsApp(s, waPhoto())
    expect((await drain(s))[0].text).toMatch(/too large/)
    expect(mediaDownloads).toBe(0)
    expect(visionCalls).toBe(0)
    expect(await rows(s, 'pendingBotActions')).toHaveLength(0)
  })

  test('a Telegram photo goes through the same flow', async () => {
    const s = await setup()
    visionText = PAGE
    await postTelegram(s, tgMessage('777', { photo: [{ file_id: 'small', width: 90, height: 60, file_size: 900 }, { file_id: 'AgAD-1', width: 1280, height: 960, file_size: 200_000 }] }))
    const replies = await drain(s)
    expect(sent.some((m) => m.url.includes('getFile'))).toBe(false) // getFile is not a send
    expect(mediaDownloads).toBe(1)
    expect(replies[0].buttons[0]).toMatch(/^lba:/)
    expect(await rows(s, 'pendingBotActions')).toHaveLength(2)
  })
})
