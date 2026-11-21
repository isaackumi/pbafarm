/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { deadlineTestHooks } from './lib/aiGuard'
import { addDays, todayIn } from './lib/dates'
import { parseReadings } from './bot/templates'

/**
 * Bot templates (Paper T2a Telegram /t, T2b web manager): CRUD with
 * permissions, tenant isolation and site sharing; /t lists and uses them;
 * a water check takes one line of readings, flags low DO with Tell manager /
 * Remind me, and saves through the normal draft path.
 */

const modules = import.meta.glob('./**/*.ts')
const CHAT = 5151

type Sent = { method: string; body: Record<string, unknown> }
let sent: Sent[] = []

beforeEach(() => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tg-token')
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'tg-secret')
  sent = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      sent.push({ method: url.split('/').pop() ?? '', body: init?.body ? JSON.parse(String(init.body)) : {} })
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 })
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

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const today = todayIn('UTC')
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const site = await ctx.db.insert('farmLocations', { companyId: company, name: 'Akosombo', active: true, timezone: 'UTC', updatedAt: now })
    const site2 = await ctx.db.insert('farmLocations', { companyId: company, name: 'Kpong', active: true, timezone: 'UTC', updatedAt: now })
    const otherSite = await ctx.db.insert('farmLocations', { companyId: other, name: 'River site', active: true, updatedAt: now })
    const member = async (email: string, name: string, companyId: Id<'companies'>, roleKey: string, locationIds?: Id<'farmLocations'>[]) => {
      const u = await ctx.db.insert('users', { email, name, role: 'user', companyId })
      await ctx.db.insert('memberships', {
        userId: u, companyId, roleKey, allLocations: !locationIds, ...(locationIds ? { locationIds } : {}), status: 'active', updatedAt: now,
      })
      return u
    }
    const keeper = await member('kofi@a.com', 'Kofi Asante', company, 'field_staff', [site])
    const manager = await member('ama@a.com', 'Ama Mensah', company, 'manager')
    const kpongStaff = await member('yaw@a.com', 'Yaw', company, 'field_staff', [site2])
    const stranger = await member('x@b.com', 'Stranger', other, 'manager')
    const feed = await ctx.db.insert('feedTypes', {
      name: 'Raanan 4 mm', currentStock: 100000, minimumStock: 10, pricePerKg: 10, active: true, bagSizeKg: 25, companyId: company, updatedAt: now,
    })
    const cages: Record<string, Id<'cages'>> = {}
    for (const name of ['C-01', 'C-02', 'C-03', 'C-04']) {
      cages[name] = await ctx.db.insert('cages', {
        name, status: 'active', currentCount: 5000, initialCount: 5000, initialAbw: 100, species: 'nile_tilapia',
        stockingDate: addDays(today, -3), companyId: company, locationId: site, updatedAt: now,
      })
      await ctx.db.insert('cageKeepers', {
        companyId: company, unitId: cages[name], locationId: site, keeperId: keeper, sinceDate: addDays(today, -10), active: true, assignedBy: manager, assignedAt: now,
      })
      await ctx.db.insert('dailyRecords', {
        cageId: cages[name], date: addDays(today, -1), feedAmount: 30, feedTypeId: feed, feedPrice: 10, feedCost: 300, mortality: 0, companyId: company, locationId: site,
      })
    }
    const otherCage = await ctx.db.insert('cages', { name: 'R-01', status: 'active', companyId: other, locationId: otherSite, updatedAt: now })
    const binding = await ctx.db.insert('channelBindings', {
      provider: 'telegram', address: String(CHAT), userId: keeper, companyId: company, verifiedAt: now, lastInboundAt: now,
    })
    return { company, other, site, site2, otherSite, keeper, manager, kpongStaff, stranger, feed, cages, otherCage, binding }
  })
  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

let update = 9000
async function post(s: S, payload: Record<string, unknown>) {
  update++
  const res = await s.t.fetch('/channels/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg-secret' },
    body: JSON.stringify({ update_id: update, ...payload }),
  })
  expect(res.status).toBe(200)
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
}
const say = (s: S, text: string) =>
  post(s, { message: { message_id: update, date: Math.floor(Date.now() / 1000), chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text } })
const tap = (s: S, data: string) =>
  post(s, { callback_query: { id: `cb${update}`, data, from: { id: CHAT }, message: { message_id: 1, chat: { id: CHAT, type: 'private' } } } })
const last = () => [...sent].reverse().find((m) => m.method === 'sendMessage')!
type Kb = { inline_keyboard: { text: string; callback_data: string }[][] }
const kb = (m: Sent) => (m.body.reply_markup as Kb | undefined)?.inline_keyboard ?? []
const now = () => Date.now()

describe('templates CRUD (T2b)', () => {
  test('personal for anyone who records; shared with a site only by a manager; tenant isolation', async () => {
    const s = await setup()
    const personal = await s.as(s.keeper).mutation(api.bot.templates.save, {
      name: 'Evening feed, same as morning', kind: 'daily_same', scope: 'personal', cages: { mode: 'mine' },
    })
    await expect(
      s.as(s.keeper).mutation(api.bot.templates.save, {
        name: 'Shared', kind: 'daily_plan', scope: 'site', siteId: s.site, cages: { mode: 'row', row: 'C' },
      }),
    ).rejects.toThrow(/Only a manager/)
    const shared = await s.as(s.manager).mutation(api.bot.templates.save, {
      name: 'All C-row fed per plan', kind: 'daily_plan', scope: 'site', siteId: s.site, shortcut: 'c', cages: { mode: 'row', row: 'C', siteId: s.site },
    })
    // Shortcut unique in the organization.
    await expect(
      s.as(s.manager).mutation(api.bot.templates.save, { name: 'Dup', kind: 'daily_plan', scope: 'site', siteId: s.site, shortcut: 'c', cages: { mode: 'mine' } }),
    ).rejects.toThrow(/already used/)

    const mine = await s.as(s.keeper).query(api.bot.templates.list, { now: now() })
    expect(mine.templates.map((x) => x.name).sort()).toEqual(['All C-row fed per plan', 'Evening feed, same as morning'])
    const row = mine.templates.find((x) => x.id === shared)!
    expect(row).toMatchObject({ cagesText: 'C-01 to C-04', cageCount: 4, canEdit: false, siteName: 'Akosombo', siteMembers: 2 })
    expect(mine.templates.find((x) => x.id === personal)).toMatchObject({ canEdit: true, canShare: false, mine: true })

    // Kpong staff: not their site; not someone else's personal one.
    const kpong = await s.as(s.kpongStaff).query(api.bot.templates.list, { now: now() })
    expect(kpong.templates).toHaveLength(0)
    // Another organization sees nothing and cannot touch these ids.
    expect((await s.as(s.stranger).query(api.bot.templates.list, { now: now() })).templates).toHaveLength(0)
    await expect(s.as(s.stranger).mutation(api.bot.templates.remove, { id: shared })).rejects.toThrow(/not found/)
    await expect(
      s.as(s.stranger).mutation(api.bot.templates.save, { id: personal, name: 'x', kind: 'daily_same', scope: 'personal', cages: { mode: 'mine' } }),
    ).rejects.toThrow(/not found/)
    await expect(
      s.as(s.keeper).mutation(api.bot.templates.save, { name: 'x', kind: 'daily_same', scope: 'personal', cages: { mode: 'list', cageIds: [s.otherCage] } }),
    ).rejects.toThrow(/not found/)

    // The keeper cannot change the shared one; the manager sees the personal one and shares it.
    await expect(s.as(s.keeper).mutation(api.bot.templates.remove, { id: shared })).rejects.toThrow(/cannot delete/)
    const mgr = await s.as(s.manager).query(api.bot.templates.list, { now: now() })
    expect(mgr.templates.find((x) => x.id === personal)).toMatchObject({ canShare: true, ownerName: 'Kofi Asante' })
    await s.as(s.manager).mutation(api.bot.templates.share, { id: personal, siteId: s.site })
    const after = await s.as(s.keeper).query(api.bot.templates.list, { now: now() })
    expect(after.templates.find((x) => x.id === personal)).toMatchObject({ scope: 'site', canEdit: false })
    await s.as(s.manager).mutation(api.bot.templates.remove, { id: personal })
    expect((await s.as(s.keeper).query(api.bot.templates.list, { now: now() })).templates).toHaveLength(1)
  })

  test('feed issue templates need a feed type and quantity', async () => {
    const s = await setup()
    await expect(
      s.as(s.keeper).mutation(api.bot.templates.save, { name: 'Issue', kind: 'feed_issue', scope: 'personal', cages: { mode: 'none' } }),
    ).rejects.toThrow(/Feed type/)
    const id = await s.as(s.keeper).mutation(api.bot.templates.save, {
      name: 'Feed issue from store', kind: 'feed_issue', scope: 'personal', cages: { mode: 'none' }, feedTypeId: s.feed, quantityKg: 25,
    })
    expect(id).toBeTruthy()
  })
})

describe('/t in Telegram (T2a)', () => {
  test('lists templates as buttons; using a daily template fills a group that saves once; usage counts', async () => {
    const s = await setup()
    const id = await s.as(s.manager).mutation(api.bot.templates.save, {
      name: 'All C-row fed per plan', kind: 'daily_plan', scope: 'site', siteId: s.site, shortcut: 'c', cages: { mode: 'row', row: 'C', siteId: s.site },
    })
    await say(s, '/t')
    const picker = last()
    expect(String(picker.body.text)).toContain('<b>Your templates</b>\nTap one. I fill in today’s numbers, you check and save.')
    expect(kb(picker).map((r) => r[0].text)).toEqual(['All C-row fed per plan · C-01 to C-04', 'Save my last entry as a template'])
    await tap(s, `tu:${id}`)
    const confirm = last()
    expect(String(confirm.body.text)).toContain('Please check before I save:')
    expect(String(confirm.body.text)).toMatch(/C-01 to C-04 · [\d.]+ kg\nRaanan 4 mm · dead: 0/)
    expect(kb(confirm)[0].map((b) => b.text)).toEqual(['Save all 4', 'Edit', 'Cancel'])
    const groupId = kb(confirm)[0][0].callback_data.split(':')[1]
    await tap(s, `gs:${groupId}`)
    await tap(s, `gs:${groupId}`)
    const today = todayIn('UTC')
    expect((await s.t.run(async (ctx) => ctx.db.query('dailyRecords').collect())).filter((d) => d.date === today)).toHaveLength(4)
    const listed = await s.as(s.manager).query(api.bot.templates.list, { now: now() })
    expect(listed.templates[0].uses30).toBe(1)
    expect(listed.totals).toMatchObject({ count: 1, uses30: 1, minutesSaved: 4 })

    // "/t c" uses it directly: every cage is logged now.
    await say(s, '/t c')
    expect(String(last().body.text)).toContain('Nothing to fill')
    await say(s, '/t zz')
    expect(String(last().body.text)).toContain('No template with the shortcut "zz"')
  })

  test('water check: one line of readings, low DO flag, Tell manager, Remind me, save and undo', async () => {
    const s = await setup()
    const id = await s.as(s.keeper).mutation(api.bot.templates.save, {
      name: 'Water check: DO, temp', kind: 'water_check', scope: 'personal', cages: { mode: 'mine' },
    })
    await tap(s, `tu:${id}`)
    expect(String(last().body.text)).toBe(
      'Water check for C-01, C-02, C-03, C-04. Send DO and temp. One pair for all, or add a cage to change one.\nExample: 5.8 28, C-03 3.9 29',
    )
    await say(s, 'hmm 5.6')
    expect(String(last().body.text)).toContain('I could not read that')
    await say(s, '5.6 28 all, C-03 3.8 29')
    const draft = last()
    const text = String(draft.body.text)
    expect(text).toContain('Please check before I save:')
    expect(text).toMatch(/CAGE\s+DO mg\/L\s+TEMP °C/)
    expect(text).toMatch(/C-03\s+3\.8 · low\s+29/)
    expect(text).toMatch(/C-01\s+5\.6\s+28/)
    expect(text).toContain('C-03 is below 4.0. Run the aerator and check again in 1 hour.')
    const rows = kb(draft)
    expect(rows[0].map((b) => b.text)).toEqual(['Save all 4', 'Edit', 'Cancel'])
    expect(rows[1][0].text).toBe('Tell Ama (manager)')
    expect(rows[1][1].text).toMatch(/^Remind me at \d{2}:\d{2}$/)
    const groupId = rows[0][0].callback_data.split(':')[1]

    await tap(s, `gt:${groupId}`)
    expect(String(last().body.text)).toBe('Done. I told Ama.')
    const notes = await s.t.run(async (ctx) => (await ctx.db.query('notifications').collect()).filter((n) => n.userId === s.manager))
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('Low DO at C-03')
    await tap(s, `gt:${groupId}`)
    expect(String(last().body.text)).toBe('Ama already knows.')

    const before = sent.length
    await tap(s, `gr:${groupId}`)
    // The test runs scheduled functions at once, so the reminder itself follows.
    const texts = sent.slice(before).filter((m) => m.method === 'sendMessage').map((m) => String(m.body.text))
    expect(texts[0]).toMatch(/^OK, I will remind you at \d{2}:\d{2}\.$/)
    expect(texts[1]).toBe('Time to check DO again at C-03.')

    await tap(s, `gs:${groupId}`)
    expect(String(last().body.text)).toBe('Saved 4 entries.')
    const readings = await s.t.run(async (ctx) => ctx.db.query('waterQualityReadings').collect())
    expect(readings.filter((r) => r.source === 'manual')).toHaveLength(4)
    expect(readings.find((r) => r.unitId === s.cages['C-03'])?.dissolvedOxygen).toBe(3.8)
    await tap(s, `gu:${groupId}`)
    expect(String(last().body.text)).toBe('Undone. 4 entries were removed.')
    expect((await s.t.run(async (ctx) => ctx.db.query('waterQualityReadings').collect())).filter((r) => r.source === 'manual')).toHaveLength(0)
  })

  test('save my last entry as a template', async () => {
    const s = await setup()
    const id = await s.as(s.keeper).mutation(api.bot.templates.save, {
      name: 'Same', kind: 'daily_same', scope: 'personal', cages: { mode: 'list', cageIds: [s.cages['C-01'], s.cages['C-02']] },
    })
    await tap(s, 'ts')
    expect(String(last().body.text)).toContain('There is no saved entry')
    await tap(s, `tu:${id}`)
    const groupId = kb(last())[0][0].callback_data.split(':')[1]
    await tap(s, `gs:${groupId}`)
    await tap(s, 'ts')
    expect(String(last().body.text)).toBe('Saved as a template: Daily entry: C-01, C-02. Send /t to use it.')
    const all = await s.t.run(async (ctx) => ctx.db.query('botTemplates').collect())
    expect(all.find((x) => x.name === 'Daily entry: C-01, C-02')).toMatchObject({ scope: 'personal', kind: 'daily_same', ownerId: s.keeper })
  })

  test("another chat's template id is not usable", async () => {
    const s = await setup()
    const id = await s.as(s.stranger).mutation(api.bot.templates.save, {
      name: 'Theirs', kind: 'daily_same', scope: 'personal', cages: { mode: 'mine' },
    })
    await tap(s, `tu:${id}`)
    expect(String(last().body.text)).toBe('This template is no longer available.')
  })
})

describe('parseReadings', () => {
  const names = ['A-01', 'A-02', 'A-05', 'A-06']
  test('one pair for all and overrides', () => {
    const r = parseReadings('5.6 28 all, A-05 3.8 29', names)!
    expect(r.all).toEqual([5.6, 28])
    expect(r.per.get(2)).toEqual([3.8, 29])
    expect(parseReadings('5,8 28', names)!.all).toEqual([5.8, 28])
    expect(parseReadings('A-09 3 4', names)).toBeNull()
    expect(parseReadings('5.6', names)).toBeNull()
  })
})
