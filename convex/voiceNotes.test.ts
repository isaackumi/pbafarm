/// <reference types="vite/client" />
/**
 * BOT-005: a voice note over WhatsApp/Telegram becomes drafts through the
 * voice workflow, saved only on a tap. Network is a scripted fake on global
 * fetch: Meta media + sends, Telegram getFile + file + sends, Whisper and a
 * Khaya test double. The agent's model is a scripted mock.
 */
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import workflowTest from '@convex-dev/workflow/test'
import { mockModel } from '@convex-dev/agent'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { hmacSha256HexBytes } from './bot/verify'
import { testHooks } from './bot/agent'
import { voiceMessages } from './bot/voice'
import { rateLimiter } from './lib/rateLimits'

const modules = import.meta.glob('./**/*.ts')

const ENV = {
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_BOT_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BOT_ACCESS_TOKEN: 'wa-token',
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_WEBHOOK_SECRET: 'tg-secret',
  GEMINI_API_KEY: 'test-key',
}
const SPEECH_ENV = { SPEECH_OPENAI_API_KEY: 'sk-speech' }
const KHAYA_ENV = { KHAYA_API_KEY: 'khaya-key', KHAYA_ASR_URL: 'https://khaya.test/asr/v1/transcribe' }
const PHONE = '+233200000001'
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 1, 2, 3])

type Sent = { url: string; body: Record<string, unknown> }
let sent: Sent[] = []
let speechCalls: { url: string; language: string | null }[] = []
let mediaDownloads = 0
/** What the speech vendor answers next: [status, body]. */
let whisperReply: [number, unknown] = [200, { text: '' }]
let khayaReply: [number, unknown] = [200, '']

beforeEach(() => {
  for (const [k, val] of Object.entries(ENV)) vi.stubEnv(k, val)
  sent = []
  speechCalls = []
  mediaDownloads = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === 'https://api.openai.com/v1/audio/transcriptions') {
        speechCalls.push({ url, language: (init?.body as FormData).get('language') as string })
        return new Response(JSON.stringify(whisperReply[1]), { status: whisperReply[0] })
      }
      if (url.startsWith('https://khaya.test/')) {
        speechCalls.push({ url, language: new URL(url).searchParams.get('language') })
        return new Response(JSON.stringify(khayaReply[1]), { status: khayaReply[0] })
      }
      if (url.startsWith('https://graph.facebook.com/v27.0/AUDIO')) {
        return new Response(
          JSON.stringify({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg; codecs=opus', file_size: OGG.length }),
          { status: 200 },
        )
      }
      if (url.startsWith('https://lookaside.fbsbx.com/') || url.startsWith('https://api.telegram.org/file/')) {
        mediaDownloads++
        return new Response(OGG, { status: 200 })
      }
      if (url.includes('/getFile')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/file_1.oga', file_size: OGG.length } }), { status: 200 })
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      sent.push({ url, body })
      if (url.includes('graph.facebook.com')) {
        return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 })
    }),
  )
  // Fake Date too: the workflow's workpool loop schedules by the clock.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  testHooks.languageModel = null
})

const stubEnv = (env: Record<string, string>) => {
  for (const [k, val] of Object.entries(env)) vi.stubEnv(k, val)
}

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  workflowTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const siteA1 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const siteA2 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'South', active: true, updatedAt: now })
    const staff = await ctx.db.insert('users', {
      email: 'staff@a.com', name: 'Ama', role: 'user', companyId: companyA, phone: PHONE, phoneVerificationTime: now,
    })
    await ctx.db.insert('memberships', {
      userId: staff, companyId: companyA, roleKey: 'field_staff', allLocations: false, locationIds: [siteA1],
      status: 'active', updatedAt: now,
    })
    const cage = (name: string, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10,
        stockingDate: '2026-10-01', companyId: companyA, locationId, updatedAt: now,
      })
    const cageA1 = await cage('A1', siteA1)
    const cageC10 = await cage('C10', siteA1)
    await cage('A2', siteA2)
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
    return { companyA, staff, cageA1, cageC10, waBinding, tgBinding }
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
const waVoice = (id?: string) => waPayload({ type: 'audio', audio: { id: 'AUDIO1', mime_type: 'audio/ogg; codecs=opus', voice: true } }, id)
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

let updateId = 5000
async function postTelegram(s: S, message: Record<string, unknown>) {
  return await s.t.fetch('/channels/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': ENV.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: ++updateId,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 777, type: 'private' }, from: { id: 1 }, ...message },
    }),
  })
}

/** Run the scheduled processing and workflow; return what the bot sent back (text + button/list ids). */
async function drain(s: S) {
  const before = sent.length
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  return sent.slice(before).filter((m) => !m.url.includes('answerCallbackQuery')).map((m) => {
    const b = m.body as {
      text?: string | { body?: string }
      interactive?: {
        body?: { text?: string }
        action?: { buttons?: { reply: { id: string } }[]; sections?: { rows: { id: string }[] }[] }
      }
      reply_markup?: { inline_keyboard: { callback_data: string }[][] }
    }
    const text = typeof b.text === 'string' ? b.text : (b.text?.body ?? b.interactive?.body?.text ?? '')
    const buttons = [
      ...(b.interactive?.action?.buttons?.map((x) => x.reply.id) ?? []),
      ...(b.interactive?.action?.sections?.flatMap((x) => x.rows.map((r) => r.id)) ?? []),
      ...(b.reply_markup?.inline_keyboard.flat().map((x) => x.callback_data) ?? []),
    ]
    return { text, buttons }
  })
}

type Table = 'pendingBotActions' | 'dailyRecords' | 'voiceNotes' | 'files' | 'channelInbound' | 'auditLogs'
const rows = <T extends Table>(s: S, table: T): Promise<Doc<T>[]> =>
  s.t.run(async (ctx) => (await ctx.db.query(table).collect()) as Doc<T>[])

function toolCall(toolName: string, input: Record<string, unknown>, id = 'c1') {
  return { type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }
}

describe('BOT-005 voice notes', () => {
  test('no speech key for the language: a polite reply, nothing downloaded or stored', async () => {
    const s = await setup()
    await postWhatsApp(s, waVoice())
    const replies = await drain(s)
    expect(replies.map((r) => r.text)).toEqual([expect.stringMatching(/Voice notes in English are not set up yet/)])
    expect(mediaDownloads).toBe(0)
    expect(speechCalls).toHaveLength(0)
    expect(await rows(s, 'voiceNotes')).toHaveLength(0)
    expect(await rows(s, 'files')).toHaveLength(0)
  })

  test('two cages in one note: CHECK and blank shown, nothing saved until Save both, which commits once', async () => {
    stubEnv(SPEECH_ENV)
    const s = await setup()
    whisperReply = [
      200,
      {
        text: 'A1 fed 25 kg. C10 30 kg',
        segments: [
          { text: 'A1 fed 25 kg.', avg_logprob: -0.05 },
          { text: 'C10 30 kg', avg_logprob: -1.4 },
        ],
      },
    ]
    testHooks.languageModel = mockModel({
      contentSteps: [
        [
          toolCall('proposeDailyEntry', { unit: 'A1', feedKg: 25, mortality: 3 }, 'c1'),
          toolCall('proposeDailyEntry', { unit: 'C10', feedKg: 30, check: [{ field: 'feedKg', heard: 'thirty' }] }, 'c2'),
        ],
        [{ type: 'text', text: 'Drafts ready.' }],
      ],
    })
    await postWhatsApp(s, waVoice('wamid.voice1'))
    const replies = await drain(s)

    expect(speechCalls).toEqual([{ url: 'https://api.openai.com/v1/audio/transcriptions', language: 'en' }])
    const [note] = await rows(s, 'voiceNotes')
    expect(note).toMatchObject({ status: 'ready', language: 'en', transcript: 'A1 fed 25 kg. C10 30 kg', draftCount: 2, mime: 'audio/ogg' })
    expect(note.lowConfidence).toContain('30')
    const [file] = await rows(s, 'files')
    expect(file).toMatchObject({ companyId: s.companyA, entityType: 'voiceNotes', entityId: note._id, mime: 'audio/ogg' })

    const drafts = await rows(s, 'pendingBotActions')
    expect(drafts).toHaveLength(2)
    expect(drafts.every((d) => d.voiceNoteId === note._id && d.status === 'pending' && d.sourceMessageId === 'wamid.voice1')).toBe(true)
    const c10 = drafts.find((d) => d.payload.cageId === s.cageC10)!
    expect(c10).toMatchObject({ needsCheck: ['feedKg'], checkHeard: 'thirty', notSaid: ['mortality'] })
    expect(await rows(s, 'dailyRecords')).toHaveLength(0)

    expect(replies).toHaveLength(1)
    const msg = replies[0].text
    expect(msg).toMatch(/^"A1 fed 25 kg\. C10 30 kg"\nHeard in English\n/)
    expect(msg).toContain('Got it. I heard 2 cages. Please check before I save:')
    expect(msg).toContain('Feed: 25 kg Grower')
    expect(msg).toContain('Mortality: 3 fish')
    expect(msg).toContain('Feed: CHECK 30 kg Grower')
    expect(msg).toContain('Mortality: Not said, saved as blank')
    expect(msg).toContain('I heard "thirty" (30 kg) for C10 but the line was noisy.')
    expect(msg).toMatch(/Saving for today, \d{4}-\d{2}-\d{2}\./)
    expect(msg).not.toMatch(/\u2014/)
    expect(replies[0].buttons).toEqual([`vsa:${note._id}`, `vse:${note._id}`, `vsx:${note._id}`])

    await postWhatsApp(s, waButton(`vsa:${note._id}`))
    const saved = await drain(s)
    expect(saved[0].text).toMatch(/^Saved A1 and C10\. You can undo for 10 minutes\./)
    expect(saved[0].buttons).toEqual([`vsu:${note._id}`])
    const records = await rows(s, 'dailyRecords')
    expect(records).toHaveLength(2)
    expect(records.find((r) => r.cageId === s.cageA1)).toMatchObject({ feedAmount: 25, mortality: 3 })

    // A second tap writes nothing more.
    await postWhatsApp(s, waButton(`vsa:${note._id}`))
    const again = await drain(s)
    expect(again[0].text).toBe('This entry was already saved.')
    expect(await rows(s, 'dailyRecords')).toHaveLength(2)
    // Audit rows carry the channel and the voice note's message id.
    const audits = (await rows(s, 'auditLogs')).filter((a) => a.sourceMessageId === 'wamid.voice1')
    expect(audits.length).toBeGreaterThan(0)
    expect(audits.every((a) => a.channel === 'whatsapp')).toBe(true)

    // Undo removes both.
    await postWhatsApp(s, waButton(`vsu:${note._id}`))
    const undone = await drain(s)
    expect(undone[0].text).toBe('Undone. 2 entries were removed.')
    expect(await rows(s, 'dailyRecords')).toHaveLength(0)
  })

  test('a figure heard only as a low-confidence word is CHECK even if the model did not flag it; Cancel saves nothing', async () => {
    stubEnv(SPEECH_ENV)
    const s = await setup()
    whisperReply = [200, { text: 'A1 30 kg', segments: [{ text: 'A1 30 kg', avg_logprob: -2 }] }]
    testHooks.languageModel = mockModel({
      contentSteps: [[toolCall('proposeDailyEntry', { unit: 'A1', feedKg: 30 })], [{ type: 'text', text: 'ok' }]],
    })
    await postWhatsApp(s, waVoice())
    const [reply] = await drain(s)
    expect(reply.text).toContain('Feed: CHECK 30 kg Grower')
    expect(reply.text).toContain('I am not sure of 30 kg for A1.')
    const [note] = await rows(s, 'voiceNotes')
    expect(reply.buttons[0]).toBe(`vsa:${note._id}`)
    await postWhatsApp(s, waButton(`vsx:${note._id}`))
    expect((await drain(s))[0].text).toBe('Cancelled. Nothing was saved.')
    expect((await rows(s, 'pendingBotActions'))[0].status).toBe('cancelled')
    expect(await rows(s, 'dailyRecords')).toHaveLength(0)
  })

  test('Twi over Telegram via Khaya: VOICE TWI, transcript with the English line', async () => {
    stubEnv({ ...SPEECH_ENV, ...KHAYA_ENV })
    const s = await setup()
    await postTelegram(s, { text: 'VOICE TWI' })
    expect((await drain(s))[0].text).toBe('Voice notes: I will listen for Twi.')

    khayaReply = [200, 'C10 aduane kilo aduasa']
    testHooks.languageModel = mockModel({
      contentSteps: [
        [toolCall('proposeDailyEntry', { unit: 'C10', feedKg: 30 })],
        [{ type: 'text', text: 'English: C10 was fed thirty kilos.\nDraft ready.' }],
      ],
    })
    await postTelegram(s, { voice: { file_id: 'AwAD-voice', mime_type: 'audio/ogg', file_size: OGG.length, duration: 4 } })
    const replies = await drain(s)
    expect(speechCalls).toEqual([{ url: 'https://khaya.test/asr/v1/transcribe?language=tw', language: 'tw' }])
    expect(replies[0].text).toMatch(/^"C10 aduane kilo aduasa"\nHeard in Twi · English\nC10 was fed thirty kilos\.\n/)
    expect(replies[0].text).toContain('I heard 1 cage.')
    const [note] = await rows(s, 'voiceNotes')
    expect(note).toMatchObject({ language: 'tw', vendor: 'khaya', english: 'C10 was fed thirty kilos.' })
    expect(replies[0].buttons[0]).toBe(`vsa:${note._id}`)
  })

  test('unclear cage: "which one?" with the 2 closest + Save blocked until picked', async () => {
    stubEnv(SPEECH_ENV)
    const s = await setup()
    whisperReply = [200, { text: 'cage C1 three dead' }]
    testHooks.languageModel = mockModel({
      contentSteps: [[toolCall('proposeMortality', { unit: 'C1', count: 3 })], [{ type: 'text', text: 'ok' }]],
    })
    await postWhatsApp(s, waVoice())
    const replies = await drain(s)
    const [draft] = await rows(s, 'pendingBotActions')
    expect(draft.needsCheck).toEqual(['unit'])
    expect(draft.unitChoices!.map((c) => c.name)).toEqual(['C10', 'A1'])
    expect(replies).toHaveLength(2)
    expect(replies[0].text).toContain('Unit: CHECK C10')
    expect(replies[0].text).toContain('Feed: Not said, saved as blank')
    expect(replies[1]).toEqual({
      text: "I didn't catch the cage clearly. Which one had 3 dead fish?",
      buttons: [`vc:${draft._id}:0`, `vc:${draft._id}:1`],
    })

    const [note] = await rows(s, 'voiceNotes')
    await postWhatsApp(s, waButton(`vsa:${note._id}`))
    expect((await drain(s))[0].text).toBe('Pick the cage first, then tap Save.')
    expect(await rows(s, 'dailyRecords')).toHaveLength(0)

    // A forged index or another draft id is refused.
    await postWhatsApp(s, waButton(`vc:${draft._id}:7`))
    expect((await drain(s))[0].text).toBe('This draft is no longer open.')

    await postWhatsApp(s, waButton(`vc:${draft._id}:1`))
    const picked = await drain(s)
    expect(picked[0].text).toBe('OK, A1.')
    expect(picked[1].text).toContain('Unit: A1')
    expect(picked[1].text).not.toContain('CHECK')
    await postWhatsApp(s, waButton(`vsa:${note._id}`))
    expect((await drain(s))[0].text).toMatch(/^Saved A1\./)
    const [record] = await rows(s, 'dailyRecords')
    expect(record).toMatchObject({ cageId: s.cageA1, mortality: 3 })
  })

  test('idempotent per inbound message: the same message routed twice runs one workflow', async () => {
    stubEnv(SPEECH_ENV)
    const s = await setup()
    whisperReply = [200, { text: 'A1 fed 5 kg' }]
    testHooks.languageModel = mockModel({
      contentSteps: [[toolCall('proposeDailyEntry', { unit: 'A1', feedKg: 5 })], [{ type: 'text', text: 'ok' }]],
    })
    const ids = await s.t.run(async (ctx) => {
      const row = {
        provider: 'whatsapp' as const, externalId: 'wamid.dup', address: PHONE, kind: 'audio' as const,
        mediaId: 'AUDIO1', sentAt: Date.now(), receivedAt: Date.now(), status: 'queued' as const,
      }
      return [await ctx.db.insert('channelInbound', row), await ctx.db.insert('channelInbound', row)]
    })
    for (const inboundId of ids) await s.t.action(internal.bot.process.handle, { inboundId })
    // A replayed processing of the first row is a no-op too.
    await s.t.action(internal.bot.process.handle, { inboundId: ids[0] })
    await drain(s)
    // Starting the same note again does nothing either.
    const [first] = await rows(s, 'voiceNotes')
    expect(await s.t.mutation(internal.bot.voice.claimNote, { voiceNoteId: first._id })).toBe(false)
    expect(await rows(s, 'voiceNotes')).toHaveLength(1)
    expect(mediaDownloads).toBe(1)
    expect(speechCalls).toHaveLength(1)
    expect(await rows(s, 'pendingBotActions')).toHaveLength(1)
  })

  test('declared oversize is refused at once; a speech 4xx gives a polite reply and no draft', async () => {
    stubEnv(SPEECH_ENV)
    const s = await setup()
    await postTelegram(s, { voice: { file_id: 'AwAD-big', mime_type: 'audio/ogg', file_size: 17 * 1024 * 1024 } })
    expect((await drain(s))[0].text).toBe('This voice note is too long (over 16 MB). Please send a shorter one.')
    expect(await rows(s, 'voiceNotes')).toHaveLength(0)

    whisperReply = [400, { error: { message: 'Invalid file format' } }]
    await postWhatsApp(s, waVoice())
    const replies = await drain(s)
    expect(replies.map((r) => r.text)).toEqual([
      'I could not listen to the voice note right now. Please try again later or type the entry.',
    ])
    expect(speechCalls).toHaveLength(1)
    const [note] = await rows(s, 'voiceNotes')
    expect(note).toMatchObject({ status: 'failed', error: 'speech_rejected_400' })
    expect(await rows(s, 'pendingBotActions')).toHaveLength(0)
  })

  test('French locale replies in French', async () => {
    stubEnv(SPEECH_ENV)
    const s = await setup()
    await s.t.run(async (ctx) => ctx.db.patch(s.staff, { locale: 'fr' }))
    whisperReply = [200, { text: 'A1 cinq kilos' }]
    testHooks.languageModel = mockModel({
      contentSteps: [[toolCall('proposeDailyEntry', { unit: 'A1', feedKg: 5 })], [{ type: 'text', text: 'English: A1 five kilos.' }]],
    })
    await postWhatsApp(s, waVoice())
    const [reply] = await drain(s)
    expect(speechCalls[0].language).toBe('fr')
    expect(reply.text).toContain('Entendu en français · anglais')
    expect(reply.text).toContain("Bien reçu. J'ai entendu 1 cage.")
    expect(reply.text).toContain('Mortalité : Non dit, enregistré vide'.replace(' :', ':'))
  })

  test('audio is deleted after 30 days; the transcript stays', async () => {
    const s = await setup()
    const noteId = await s.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([OGG], { type: 'audio/ogg' }))
      const createdAt = Date.now() - 31 * 24 * 60 * 60 * 1000
      const id = await ctx.db.insert('voiceNotes', {
        companyId: s.companyA, userId: s.staff, bindingId: s.waBinding, provider: 'whatsapp', sourceMessageId: 'wamid.old',
        mediaId: 'AUDIO1', sentAt: createdAt, language: 'en', status: 'ready', transcript: 'old note', createdAt,
      })
      const fileId = await ctx.db.insert('files', {
        companyId: s.companyA, entityType: 'voiceNotes', entityId: id, provider: 'convex', storageId,
        name: 'voice.ogg', mime: 'audio/ogg', size: OGG.length, uploadedBy: s.staff, createdAt,
      })
      await ctx.db.patch(id, { fileId })
      return id
    })
    expect(await s.t.mutation(internal.bot.voice.purgeOldAudio, {})).toBe(1)
    const note = await s.t.run(async (ctx) => ctx.db.get(noteId))
    expect(note).toMatchObject({ transcript: 'old note' })
    expect(note?.fileId).toBeUndefined()
    expect(note?.audioDeletedAt).toBeTypeOf('number')
    expect(await rows(s, 'files')).toHaveLength(0)
    expect(await s.t.mutation(internal.bot.voice.purgeOldAudio, {})).toBe(0)
  })

  test('transcription spends the assistant quota up front, even when it fails', async () => {
    stubEnv(SPEECH_ENV)
    const s = await setup()
    await s.t.run(async (ctx) => {
      // The hourly limit: draining advances the faked clock past a minute window.
      for (let i = 0; i < 99; i++) await rateLimiter.limit(ctx, 'llmPerUserHour', { key: s.staff })
    })
    whisperReply = [400, { error: { message: 'bad audio' } }]
    await postWhatsApp(s, waVoice())
    await drain(s)
    await postWhatsApp(s, waVoice())
    const replies = await drain(s)
    expect(replies[0].text).toMatch(/You have used the assistant a lot recently/)
    expect(speechCalls).toHaveLength(1)
    expect(await rows(s, 'voiceNotes')).toHaveLength(1)
  })
})

describe('BOT-005 reply layout', () => {
  test('every draft stays visible: a long transcript moves to its own message, drafts are never cut', () => {
    const drafts = Array.from({ length: 5 }, (_, i) => ({
      _id: `p${i}` as Id<'pendingBotActions'>,
      payload: {
        kind: 'daily_entry' as const,
        cageId: `c${i}` as Id<'cages'>,
        cageName: `Cage North Bank Long Name ${i}`,
        feedKg: 10 + i,
        feedTypeName: 'Grower 4mm floating pellet',
        mortality: i,
        notes: 'x'.repeat(100),
      },
      date: '2026-11-20',
      duplicateOf: `d${i}` as Id<'pendingBotActions'>,
    }))
    const out = voiceMessages('en', 'n1' as Id<'voiceNotes'>, {
      transcript: 'y'.repeat(400),
      english: 'z'.repeat(400),
      language: 'tw',
      today: '2026-11-20',
      drafts,
    })
    const all = out.map((m) => ('text' in m ? m.text : '')).join('\n')
    for (let i = 0; i < 5; i++) expect(all).toContain(`${i + 1}. Unit: Cage North Bank Long Name ${i}`)
    expect(all.split('A similar entry was sent a few minutes ago.').length - 1).toBe(5)
    const buttons = out.find((m) => m.kind === 'buttons')!
    expect(buttons.kind === 'buttons' && buttons.text.length).toBeLessThanOrEqual(1024)
    expect(buttons.kind === 'buttons' && buttons.buttons[0].id).toBe('vsa:n1')
  })
})
