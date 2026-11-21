/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { deadlineTestHooks } from './lib/aiGuard'
import { todayIn, addDays } from './lib/dates'
import { editTelegramChat, telegramPayload } from './messaging/providers/telegramBot'
import { MAX_ROUND_CAGES, orderCages, roundMessage } from './bot/rounds'

/**
 * Morning round card (Paper T1a / T1b): content from cage keepers and the
 * feeding plan, exceptions first, quiet hours, taps edited in place with a
 * fallback when Telegram refuses the edit, Log all into one draft group,
 * Save all through pending.commit exactly once, Undo within 10 minutes, and
 * bounded reads for a keeper with 1,000 cages.
 */

const modules = import.meta.glob('./**/*.ts')

const ENV = { TELEGRAM_BOT_TOKEN: 'tg-token', TELEGRAM_WEBHOOK_SECRET: 'tg-secret' }
const CHAT = 4242

type Sent = { method: string; body: Record<string, unknown> }
let sent: Sent[] = []
/** Scripted answers for editMessageText, in order; then plain success. */
let editScript: Array<{ status: number; body: unknown }> = []

beforeEach(() => {
  for (const [k, val] of Object.entries(ENV)) vi.stubEnv(k, val)
  sent = []
  editScript = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const method = url.split('/').pop() ?? ''
      sent.push({ method, body })
      if (method === 'editMessageText' && editScript.length) {
        const next = editScript.shift()!
        return new Response(JSON.stringify(next.body), { status: next.status })
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 100 + sent.length } }), { status: 200 })
    }),
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  deadlineTestHooks.disabled = true
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const TODAY = () => todayIn('UTC')
/** A round time a few minutes ago (UTC), so the window is open now. */
function roundTimeNow() {
  const d = new Date(Date.now() - 5 * 60 * 1000)
  if (d.getUTCDate() !== new Date().getUTCDate()) return '00:00'
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

async function setup(opts: { cages?: number } = {}) {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const today = TODAY()
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now,
    })
    const site = await ctx.db.insert('farmLocations', { companyId: company, name: 'Akosombo', active: true, timezone: 'UTC', updatedAt: now })
    const keeper = await ctx.db.insert('users', { email: 'kofi@a.com', name: 'Kofi Asante', role: 'user', companyId: company })
    await ctx.db.insert('memberships', {
      userId: keeper, companyId: company, roleKey: 'field_staff', allLocations: false, locationIds: [site], status: 'active', updatedAt: now,
    })
    const manager = await ctx.db.insert('users', { email: 'ama@a.com', name: 'Ama Mensah', role: 'user', companyId: company })
    await ctx.db.insert('memberships', {
      userId: manager, companyId: company, roleKey: 'manager', allLocations: true, status: 'active', updatedAt: now,
    })
    const feed = await ctx.db.insert('feedTypes', {
      name: 'Raanan 4 mm', currentStock: 100000, minimumStock: 10, pricePerKg: 10, active: true, bagSizeKg: 25, companyId: company, updatedAt: now,
    })
    const names = opts.cages
      ? Array.from({ length: opts.cages }, (_, i) => `K-${String(i + 1).padStart(4, '0')}`)
      : ['A-01', 'A-02', 'A-05', 'A-06', 'C-07', 'C-11']
    const cages: Id<'cages'>[] = []
    for (const name of names) {
      const id = await ctx.db.insert('cages', {
        name, status: 'active', currentCount: 5000, initialCount: 5000, initialAbw: 100, species: 'nile_tilapia',
        stockingDate: name === 'C-07' ? addDays(today, -30) : addDays(today, -3), companyId: company, locationId: site, updatedAt: now,
      })
      cages.push(id)
      await ctx.db.insert('cageKeepers', {
        companyId: company, unitId: id, locationId: site, keeperId: keeper, sinceDate: addDays(today, -10), active: true, assignedBy: manager, assignedAt: now,
      })
      if (!opts.cages) {
        await ctx.db.insert('dailyRecords', {
          cageId: id, date: addDays(today, -1), feedAmount: name === 'C-07' ? 42 : 40, feedTypeId: feed, mortality: name === 'C-11' ? 2 : name === 'A-05' ? 1 : 0,
          feedPrice: 10, feedCost: 400, companyId: company, locationId: site,
        })
      }
    }
    const binding = await ctx.db.insert('channelBindings', {
      provider: 'telegram', address: String(CHAT), userId: keeper, companyId: company, verifiedAt: now, lastInboundAt: now,
    })
    await ctx.db.insert('botRoundSettings', {
      companyId: company, locationId: site, enabled: true, time: roundTimeNow(), feedTimes: ['06:30', '15:30'], updatedAt: now, updatedBy: manager,
    })
    return { company, site, keeper, manager, feed, cages, binding }
  })
  return { t, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

let update = 5000
async function tap(s: S, data: string) {
  update++
  const res = await s.t.fetch('/channels/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg-secret' },
    body: JSON.stringify({
      update_id: update,
      callback_query: { id: `cb${update}`, data, from: { id: CHAT, first_name: 'Kofi' }, message: { message_id: 1, chat: { id: CHAT, type: 'private' } } },
    }),
  })
  expect(res.status).toBe(200)
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
}
async function say(s: S, text: string) {
  update++
  const res = await s.t.fetch('/channels/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg-secret' },
    body: JSON.stringify({
      update_id: update,
      message: { message_id: update, date: Math.floor(Date.now() / 1000), chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text },
    }),
  })
  expect(res.status).toBe(200)
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
}

const messages = () => sent.filter((m) => m.method === 'sendMessage' || m.method === 'editMessageText')
const lastSend = () => [...sent].reverse().find((m) => m.method === 'sendMessage')!
type Kb = { inline_keyboard: { text: string; callback_data: string }[][] }
const keyboard = (m: Sent) => (m.body.reply_markup as Kb | undefined)?.inline_keyboard ?? []

async function queueRound(s: S) {
  const r = await s.t.mutation(internal.bot.rounds.queueFor, { bindingId: s.binding, now: Date.now() })
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  return r
}
async function theRound(s: S) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.query('botRounds').withIndex('by_bindingId_and_date', (q) => q.eq('bindingId', s.binding)).collect())[0] ?? null,
  )
}

describe('morning round card (T1a)', () => {
  test('lists the keeper cages with plan and yesterday, exceptions first, buttons per cage and Log all', async () => {
    const s = await setup()
    expect(await queueRound(s)).toBe('queued')
    const card = lastSend()
    expect(card.body.parse_mode).toBe('HTML')
    const text = String(card.body.text)
    expect(text).toContain('<b>Morning round · 6 cages</b>')
    expect(text).toMatch(/Plan today: [\d.]+ kg in \d feeds? \(06:30, 15:30\)\. Rations come from the feeding plan\./)
    expect(text).toContain('⚠ C-11 lost 2 fish yesterday. C-07 is due for sampling today.')
    expect(text).toContain('CAGE')
    expect(text).toMatch(/C-11\s+[\d.]+ kg · \d+ mm\s+40 kg · 2 dead/)
    const kb = keyboard(card)
    // Exceptions first: C-11 (2 dead), C-07 (sampling), then by name.
    expect(kb.slice(0, 6).map((r) => r[0].text)).toEqual(['C-11', 'C-07', 'A-01', 'A-02', 'A-05', 'A-06'])
    expect(kb[0].map((b) => b.text)).toEqual(['C-11', 'Fed as planned', 'Same as yesterday', 'Edit'])
    expect(kb[6][0].text).toMatch(/^Log all 6 as planned · [\d.]+ kg$/)
    for (const row of kb) for (const b of row) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64)
    const r = await theRound(s)
    expect(r?.messageId).toBe(100 + sent.indexOf(card) + 1)
    // Once per day.
    expect(await queueRound(s)).toBe('exists')
  })

  test('quiet hours hold the round; outside the window or turned off nothing is sent', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await ctx.db.insert('notificationPreferences', {
        userId: s.keeper, inApp: true, sms: false, whatsapp: true, email: false, quietHours: { start: '00:00', end: '23:59' }, updatedAt: Date.now(),
      })
    })
    expect(await queueRound(s)).toBe('quiet')
    expect(messages()).toHaveLength(0)
    expect(await theRound(s)).toBeNull()

    const s2 = await setup()
    await s2.t.run(async (ctx) => {
      const row = (await ctx.db.query('botRoundSettings').collect())[0]
      const later = new Date(Date.now() + 4 * 60 * 60 * 1000)
      await ctx.db.patch(row._id, { time: later.getUTCDate() === new Date().getUTCDate() ? `${String(later.getUTCHours()).padStart(2, '0')}:00` : '23:59' })
    })
    expect(await queueRound(s2)).toBe('skipped')
    const s3 = await setup()
    await s3.t.run(async (ctx) => ctx.db.patch(s3.binding, { roundEnabled: false }))
    expect(await queueRound(s3)).toBe('skipped')
  })

  test('the cron fans out only to companies whose round time is now', async () => {
    const s = await setup()
    await s.t.mutation(internal.bot.rounds.tick, {})
    await s.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await theRound(s)).not.toBeNull()
    expect(lastSend().body.text).toContain('Morning round')
  })
})

describe('after tapping (T1b)', () => {
  test('a tap edits the card in place; Log all makes one group; Save all saves through the normal path once; Undo', async () => {
    const s = await setup()
    await queueRound(s)
    const r0 = (await theRound(s))!
    const before = sent.length
    await tap(s, `rp:${r0._id}:0`)
    const edit = sent.slice(before).find((m) => m.method === 'editMessageText')!
    expect(edit.body.message_id).toBe(r0.messageId)
    expect(String(edit.body.text)).toContain('1 marked, 5 to go. This message updates as you tap.')
    const kb = keyboard(edit)
    expect(kb[0]).toHaveLength(1)
    expect(kb[0][0].text).toMatch(/^✓ C-11 fed as planned · [\d.]+ kg$/)
    expect(kb[6][0].text).toMatch(/^Log the other 5 as planned · [\d.]+ kg$/)

    // Same as yesterday on C-07 (42 kg).
    await tap(s, `rs:${r0._id}:1`)
    const r1 = (await theRound(s))!
    expect(r1.cages[1]).toMatchObject({ mark: 'same', markKg: 42 })
    expect(r1.renderedVersion).toBe(r1.version)

    // Log all: one draft group of 6, the T1b confirm.
    await tap(s, `ra:${r0._id}`)
    const confirm = lastSend()
    const ct = String(confirm.body.text)
    expect(ct).toContain('Got it. Please check before I save:')
    expect(ct).toMatch(/Date: \w{3} \d{1,2} \w{3}, morning feed/)
    expect(ct).toMatch(/Entries: 6 cages · [\d.]+ kg/)
    expect(ct).toContain('Feed: Raanan 4 mm')
    expect(ct).toMatch(/Changed: C-07 42 kg \(plan [\d.]+\)/)
    expect(ct).toContain('Mortality: Not said, saved as 0')
    expect(ct).toContain('Dead fish? Reply like "C-11 3 dead".')
    const saveRow = keyboard(confirm)[0].map((b) => b.text)
    expect(saveRow).toEqual(['Save all 6', 'Edit', 'Cancel'])
    const groupId = keyboard(confirm)[0][0].callback_data.split(':')[1]

    // "C-11 3 dead" sets that draft's mortality, no LLM.
    await say(s, 'C-11 3 dead')
    expect(String(lastSend().body.text)).toContain('Mortality: C-11 3 dead · others not said, saved as 0')

    await tap(s, `gs:${groupId}`)
    const saved = lastSend()
    expect(String(saved.body.text)).toMatch(/^Saved 6 entries\. 6 of 6 cages logged today\./)
    expect(keyboard(saved)[0][0].text).toBe('Undo (10 min)')
    const records = await s.t.run(async (ctx) =>
      (await ctx.db.query('dailyRecords').collect()).filter((d) => d.date === TODAY()),
    )
    expect(records).toHaveLength(6)
    expect(records.find((d) => d.cageId === s.cages[5])?.mortality).toBe(3)
    expect(records.find((d) => d.cageId === s.cages[4])?.feedAmount).toBe(42)
    // The card now shows every cage logged.
    const cardNow = [...sent].reverse().find((m) => m.method === 'editMessageText')!
    expect(String(cardNow.body.text)).toContain('All 6 logged today. Well done!')

    // Tapping Save all again never writes twice.
    await tap(s, `gs:${groupId}`)
    expect(String(lastSend().body.text)).toBe('These entries were already saved.')
    expect(
      (await s.t.run(async (ctx) => ctx.db.query('dailyRecords').collect())).filter((d) => d.date === TODAY()),
    ).toHaveLength(6)
    const keys = await s.t.run(async (ctx) => (await ctx.db.query('idempotencyKeys').collect()).filter((k) => k.mutation === 'bot.commit'))
    expect(keys).toHaveLength(6)

    // Undo within 10 minutes removes all six.
    await tap(s, `gu:${groupId}`)
    expect(String(lastSend().body.text)).toBe('Undone. 6 entries were removed.')
    expect(
      (await s.t.run(async (ctx) => ctx.db.query('dailyRecords').collect())).filter((d) => d.date === TODAY()),
    ).toHaveLength(0)
  })

  test('undo after the window is refused', async () => {
    const s = await setup()
    await queueRound(s)
    const r = (await theRound(s))!
    await tap(s, `ra:${r._id}`)
    const groupId = keyboard(lastSend())[0][0].callback_data.split(':')[1]
    await tap(s, `gs:${groupId}`)
    await s.t.run(async (ctx) => {
      for (const d of await ctx.db.query('pendingBotActions').collect()) await ctx.db.patch(d._id, { undoUntil: Date.now() - 1 })
    })
    await tap(s, `gu:${groupId}`)
    expect(String(lastSend().body.text)).toContain('too late to undo')
    expect((await s.t.run(async (ctx) => ctx.db.query('dailyRecords').collect())).filter((d) => d.date === TODAY())).toHaveLength(6)
  })

  test('an edit Telegram refuses sends the card anew; "not modified" is done', async () => {
    const s = await setup()
    await queueRound(s)
    const r = (await theRound(s))!
    editScript = [{ status: 400, body: { ok: false, error_code: 400, description: "Bad Request: message to edit not found" } }]
    let before = sent.length
    await tap(s, `rp:${r._id}:2`)
    const after = sent.slice(before)
    expect(after.map((m) => m.method)).toEqual(['answerCallbackQuery', 'editMessageText', 'sendMessage'])
    const fresh = (await theRound(s))!
    expect(fresh.messageId).not.toBe(r.messageId)
    expect(fresh.renderedVersion).toBe(fresh.version)

    editScript = [{ status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: message is not modified' } }]
    before = sent.length
    await tap(s, `ru:${r._id}:2`)
    expect(sent.slice(before).map((m) => m.method)).toEqual(['answerCallbackQuery', 'editMessageText'])
    expect((await theRound(s))!.messageId).toBe(fresh.messageId)
  })

  test("another chat's round buttons do nothing", async () => {
    const s = await setup()
    await queueRound(s)
    const r = (await theRound(s))!
    const other = await s.t.run(async (ctx) => {
      const u = await ctx.db.insert('users', { email: 'x@a.com', name: 'X', role: 'user', companyId: s.company })
      await ctx.db.insert('memberships', { userId: u, companyId: s.company, roleKey: 'field_staff', allLocations: true, status: 'active', updatedAt: Date.now() })
      return await ctx.db.insert('channelBindings', { provider: 'telegram', address: '777', userId: u, companyId: s.company, verifiedAt: Date.now() })
    })
    expect(other).toBeTruthy()
    update++
    await s.t.fetch('/channels/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg-secret' },
      body: JSON.stringify({ update_id: update, callback_query: { id: 'cbx', data: `ra:${r._id}`, from: { id: 777 }, message: { message_id: 1, chat: { id: 777, type: 'private' } } } }),
    })
    await s.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(String(lastSend().body.text)).toContain('from another day')
    expect(await s.t.run(async (ctx) => ctx.db.query('pendingBotActions').collect())).toHaveLength(0)
  })

  test('ROUND sends today\'s card on demand; ROUND OFF stops it', async () => {
    const s = await setup()
    await say(s, 'ROUND')
    expect(String(lastSend().body.text)).toContain('Morning round · 6 cages')
    await say(s, 'ROUND OFF')
    expect(String(lastSend().body.text)).toContain('Morning round is off')
    expect((await s.t.run(async (ctx) => ctx.db.get(s.binding)))?.roundEnabled).toBe(false)
  })
})

describe('scale', () => {
  test('a keeper with 1,000 cages gets a bounded card', async () => {
    const s = await setup({ cages: 1000 })
    expect(await queueRound(s)).toBe('queued')
    const r = (await theRound(s))!
    expect(r.cages).toHaveLength(MAX_ROUND_CAGES)
    expect(r.more).toBe(500 - MAX_ROUND_CAGES)
    const card = lastSend()
    const buttons = keyboard(card).flat().length
    expect(buttons).toBeLessThanOrEqual(100)
    expect(String(card.body.text).length).toBeLessThanOrEqual(4096)
    expect(String(card.body.text)).toContain('more cages')
  }, 120_000)
})

describe('render and Telegram edit (unit)', () => {
  const cage = (name: string, over: Partial<Parameters<typeof orderCages>[0][number]> = {}) => ({
    cageId: name as never, name, planKg: 40, pelletMm: 4, feedings: 2, yesterdayKg: 40, yesterdayDead: 0, sampleDue: false, ...over,
  })
  test('exceptions first, then by name', () => {
    const order = orderCages([cage('A-01'), cage('C-07', { sampleDue: true }), cage('C-11', { yesterdayDead: 2 }), cage('A-05', { yesterdayDead: 1 })])
    expect(order.map((c) => c.name)).toEqual(['C-11', 'C-07', 'A-01', 'A-05'])
  })
  test('fr strings', () => {
    const m = roundMessage('fr', { _id: 'r1' as never, cages: [cage('A-01')], more: 0, feedTimes: [] }, new Map())
    expect(m.kind === 'keyboard' && m.text).toContain('Tournée du matin · 1 cage')
    expect(m.kind === 'keyboard' && m.rows[0].map((b) => b.title)).toEqual(['A-01', 'Nourri selon le plan', 'Comme hier', 'Modifier'])
  })
  test('keyboard payload keeps rows and HTML mode', () => {
    const p = telegramPayload('1', { kind: 'keyboard', html: true, text: '<b>x</b>', rows: [[{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], [{ id: 'c', title: 'C' }]] })
    expect(p).toMatchObject({ parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }], [{ text: 'C', callback_data: 'c' }]] } })
  })
  const msg = { kind: 'text' as const, text: 'x' }
  const fake = (answers: Array<{ status: number; body: unknown }>) => {
    const calls: string[] = []
    const impl = async (url: string) => {
      calls.push(url)
      const a = answers.shift() ?? { status: 200, body: { ok: true } }
      return new Response(JSON.stringify(a.body), { status: a.status })
    }
    return { calls, impl }
  }
  test('edit: success, not modified, gone, 4xx not retried, 5xx retried', async () => {
    vi.useRealTimers()
    let f = fake([{ status: 200, body: { ok: true, result: { message_id: 9 } } }])
    expect(await editTelegramChat('t', '1', 9, msg, f.impl)).toEqual({ ok: true, notModified: false })
    f = fake([{ status: 400, body: { ok: false, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' } }])
    expect(await editTelegramChat('t', '1', 9, msg, f.impl)).toEqual({ ok: true, notModified: true })
    f = fake([{ status: 400, body: { ok: false, description: "Bad Request: message can't be edited" } }])
    const gone = await editTelegramChat('t', '1', 9, msg, f.impl)
    expect(gone).toMatchObject({ ok: false, gone: true })
    expect(f.calls).toHaveLength(1)
    f = fake([{ status: 502, body: {} }, { status: 200, body: { ok: true } }])
    expect(await editTelegramChat('t', '1', 9, msg, f.impl)).toEqual({ ok: true, notModified: false })
    expect(f.calls).toHaveLength(2)
    expect(f.calls[0]).toContain('/editMessageText')
  })
  test('edit: a timeout is retried (edits are idempotent)', async () => {
    vi.useRealTimers()
    let n = 0
    const impl = async (_url: string, init?: RequestInit) => {
      n++
      if (n === 1) {
        return await new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const r = await editTelegramChat('t', '1', 9, msg, impl)
    expect(r).toEqual({ ok: true, notModified: false })
    expect(n).toBe(2)
  }, 30_000)
})
