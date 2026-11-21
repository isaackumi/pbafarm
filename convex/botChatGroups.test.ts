/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { Id } from './_generated/dataModel'
import { deadlineTestHooks } from './lib/aiGuard'
import { can } from './lib/permissions'
import { todayIn } from './lib/dates'
import { checkBinding } from './bot/scope'
import { groupBound } from './bot/groupScope'
import { postGroupAlert } from './bot/chatGroups'

/**
 * Telegram site group chats (Paper VFQ-1): /connect by an admin, the
 * group-scope x role intersection, the mention/reply/command gate, unlinked
 * senders, button owners, my_chat_member removal, scope resolution and money
 * hidden in groups unless the group's money capability is on.
 */

const modules = import.meta.glob('./**/*.ts')

const ENV = { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_BOT_USERNAME: 'askAnowa_bot', TELEGRAM_WEBHOOK_SECRET: 'tg-secret' }
const GROUP = -1001
const AMA = 111 // admin, all sites
const KOFI = 222 // field staff, Akosombo only
const KWAME = 333 // manager: no integrations.manage
const YAW = 444 // admin of another organization only
const ESI = 555 // never linked

type Sent = { method: string; body: Record<string, unknown> }
let sent: Sent[] = []

beforeEach(() => {
  for (const [k, val] of Object.entries(ENV)) vi.stubEnv(k, val)
  sent = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const method = url.split('/').pop() ?? ''
      sent.push({ method, body })
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

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const today = todayIn('UTC')
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'Volta Fish', code: 'VOLTA', status: 'approved', createdAt: now })
    const offshore = await ctx.db.insert('farmLocations', { companyId: company, name: 'Offshore cages', active: true, timezone: 'UTC', updatedAt: now })
    const akosombo = await ctx.db.insert('farmLocations', { companyId: company, name: 'Akosombo', active: true, timezone: 'UTC', updatedAt: now })
    const user = async (name: string, email: string, companyId: Id<'companies'>, roleKey: string, sites?: Id<'farmLocations'>[]) => {
      const id = await ctx.db.insert('users', { email, name, role: 'user', companyId })
      await ctx.db.insert('memberships', {
        userId: id, companyId, roleKey, allLocations: !sites, ...(sites ? { locationIds: sites } : {}), status: 'active', updatedAt: now,
      })
      return id
    }
    const ama = await user('Ama Mensah', 'ama@a.com', company, 'admin')
    const kofi = await user('Kofi Asante', 'kofi@a.com', company, 'field_staff', [akosombo])
    const kwame = await user('Kwame Boateng', 'kwame@a.com', company, 'manager')
    const yaw = await user('Yaw Darko', 'yaw@b.com', other, 'admin')
    const unit = async (name: string, locationId: Id<'farmLocations'>) =>
      await ctx.db.insert('cages', {
        name, status: 'active', currentCount: 5000, initialCount: 5000, initialAbw: 100, species: 'nile_tilapia',
        stockingDate: today, companyId: company, locationId, updatedAt: now,
      })
    const c07 = await unit('C-07', offshore)
    const a01 = await unit('A-01', akosombo)
    await ctx.db.insert('cageKeepers', {
      companyId: company, unitId: a01, locationId: akosombo, keeperId: kofi, sinceDate: today, active: true, assignedBy: ama, assignedAt: now,
    })
    await ctx.db.insert('dailyRecords', { cageId: c07, date: today, feedAmount: 40, mortality: 3, feedPrice: 10, feedCost: 400, companyId: company, locationId: offshore })
    const bind = async (tg: number, userId: Id<'users'>, companyId: Id<'companies'>, username?: string) =>
      await ctx.db.insert('channelBindings', {
        provider: 'telegram', address: String(tg), userId, companyId, verifiedAt: now, lastInboundAt: now, ...(username ? { username } : {}),
      })
    const bindings = {
      ama: await bind(AMA, ama, company),
      kofi: await bind(KOFI, kofi, company, 'kofi_a'),
      kwame: await bind(KWAME, kwame, company),
      yaw: await bind(YAW, yaw, other),
    }
    return { company, other, offshore, akosombo, ama, kofi, kwame, yaw, c07, a01, bindings }
  })
  return { t, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

let update = 9000
let msgId = 1
async function post(s: S, body: Record<string, unknown>) {
  update++
  const res = await s.t.fetch('/channels/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg-secret' },
    body: JSON.stringify({ update_id: update, ...body }),
  })
  expect(res.status).toBe(200)
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
}
const names: Record<number, string> = { [AMA]: 'Ama', [KOFI]: 'Kofi', [KWAME]: 'Kwame', [YAW]: 'Yaw', [ESI]: 'Esi' }
/** A message in the group. Returns what the bot sent to the group. */
async function inGroup(s: S, from: number, text: string, extra: Record<string, unknown> = {}) {
  const before = sent.length
  await post(s, {
    message: {
      message_id: ++msgId, date: Math.floor(Date.now() / 1000), text,
      chat: { id: GROUP, type: 'supergroup', title: 'Offshore crew' },
      from: { id: from, first_name: names[from], is_bot: false },
      ...extra,
    },
  })
  return out(before, GROUP)
}
async function inPrivate(s: S, from: number, text: string) {
  const before = sent.length
  await post(s, {
    message: { message_id: ++msgId, date: Math.floor(Date.now() / 1000), text, chat: { id: from, type: 'private' }, from: { id: from, first_name: names[from] } },
  })
  return out(before, from)
}
/** A button tap in the group. Returns the callback toast and what was posted. */
async function tapInGroup(s: S, from: number, data: string) {
  const before = sent.length
  await post(s, {
    callback_query: {
      id: `cb${update}`, data, from: { id: from, first_name: names[from] },
      message: { message_id: 50, chat: { id: GROUP, type: 'supergroup', title: 'Offshore crew' } },
    },
  })
  const answer = sent.slice(before).find((x) => x.method === 'answerCallbackQuery')
  return { toast: (answer?.body.text as string | undefined) ?? null, messages: out(before, GROUP) }
}
function out(before: number, chat: number) {
  return sent
    .slice(before)
    .filter((x) => (x.method === 'sendMessage' || x.method === 'editMessageText') && String(x.body.chat_id) === String(chat))
    .map((x) => ({ text: String(x.body.text), buttons: buttonsOf(x.body) }))
}
function buttonsOf(body: Record<string, unknown>): Array<{ text: string; data: string }> {
  const rows = (body.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined)?.inline_keyboard ?? []
  return rows.flat().map((b) => ({ text: b.text, data: b.callback_data }))
}
async function groupRow(s: S) {
  return await s.t.run(async (ctx) => await ctx.db.query('botChatGroups').withIndex('by_provider_and_chatId', (q) => q.eq('provider', 'telegram').eq('chatId', String(GROUP))).first())
}
/** Ama links the group to Lake with the given sites. */
async function link(s: S, sites: 'all' | Id<'farmLocations'>[]) {
  const picker = await inGroup(s, AMA, '/connect@askAnowa_bot')
  expect(picker[0].text).toMatch(/Which farm locations/)
  if (sites === 'all') await tapInGroup(s, AMA, 'gs:all')
  else for (const id of sites) await tapInGroup(s, AMA, `gs:${id}`)
  const done = await tapInGroup(s, AMA, 'gs:done')
  expect(done.messages[0].text).toMatch(/Linked to Lake/)
}

describe('linking a group', () => {
  test('/connect needs integrations.manage; an admin picks sites and the link is audited', async () => {
    const s = await setup()
    const denied = await inGroup(s, KWAME, '/connect')
    expect(denied[0].text).toMatch(/Only an organization admin/)
    expect(await groupRow(s)).toBeNull()

    const picker = await inGroup(s, AMA, '/connect')
    const labels = picker[0].buttons.map((b) => b.text)
    expect(labels).toEqual(expect.arrayContaining(['All farm locations', 'Offshore cages', 'Akosombo', 'Done', 'Cancel']))
    // Only the person who started the link can finish it.
    expect((await tapInGroup(s, KOFI, 'gs:done')).toast).toMatch(/Ama is linking this group/)
    const picked = await tapInGroup(s, AMA, `gs:${s.offshore}`)
    expect(picked.messages[0].buttons.some((b) => b.text === '✓ Offshore cages')).toBe(true)
    const done = await tapInGroup(s, AMA, 'gs:done')
    expect(done.messages[0].text).toMatch(/Linked to Lake · Offshore cages/)

    const g = (await groupRow(s))!
    expect(g).toMatchObject({ status: 'active', companyId: s.company, siteScope: [s.offshore], linkedBy: s.ama })
    expect(g.caps).toEqual({ ask: true, log: true, alerts: true, money: false, buyers: false })
    const audit = await s.t.run(async (ctx) => (await ctx.db.query('auditLogs').collect()).filter((a) => a.tableName === 'botChatGroups'))
    expect(audit.map((a) => a.actionType)).toEqual(['create'])
  })

  test('tenant mismatch: another organization cannot see, change, relink or use the group', async () => {
    const s = await setup()
    await link(s, 'all')
    const connect = await inGroup(s, YAW, '/connect')
    expect(connect[0].text).toMatch(/another organization/)
    expect(connect[0].text).not.toMatch(/Lake/)
    const ask = await inGroup(s, YAW, '@askAnowa_bot summary')
    expect(ask[0].text).toMatch(/another organization/)
    expect(ask[0].text).not.toMatch(/Offshore|C-07/)
    expect((await tapInGroup(s, YAW, 'ga:c:money')).toast).toMatch(/Only an organization admin/)
    expect((await tapInGroup(s, YAW, `gc:${s.other}`)).toast).toMatch(/another organization/)
    const g = (await groupRow(s))!
    expect(g.companyId).toBe(s.company)
    expect(g.caps.money).toBe(false)
  })

  test('my_chat_member removal revokes the link; /disconnect is admin-only', async () => {
    const s = await setup()
    await link(s, 'all')
    expect((await inGroup(s, KOFI, '/disconnect'))[0].text).toMatch(/Only an organization admin/)
    await post(s, {
      my_chat_member: {
        chat: { id: GROUP, type: 'supergroup', title: 'Offshore crew' }, from: { id: AMA, first_name: 'Ama' }, date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: 'member', user: { id: 123, is_bot: true } }, new_chat_member: { status: 'kicked', user: { id: 123, is_bot: true } },
      },
    })
    const g = (await groupRow(s))!
    expect(g).toMatchObject({ status: 'revoked', revokedReason: 'bot_removed' })
    const audit = await s.t.run(async (ctx) => (await ctx.db.query('auditLogs').collect()).filter((a) => a.tableName === 'botChatGroups'))
    expect(audit.map((a) => a.actionType)).toEqual(['create', 'delete'])
    expect((await inGroup(s, AMA, '@askAnowa_bot summary'))[0].text).toMatch(/not linked to a farm/)
  })
})

describe('who the bot answers', () => {
  test('only mentions, replies to the bot and commands; unlinked senders get one private-link reply', async () => {
    const s = await setup()
    await link(s, 'all')
    expect(await inGroup(s, AMA, 'summary from offshore')).toEqual([])
    expect(await inGroup(s, AMA, '/today@someOtherBot')).toEqual([])
    const reply = await inGroup(s, AMA, 'summary from offshore', { reply_to_message: { message_id: 7, from: { id: 123, is_bot: true, username: 'askAnowa_bot' } } })
    expect(reply[0].text).toMatch(/Offshore cages/)

    const first = await inGroup(s, ESI, '@askAnowa_bot summary')
    expect(first).toHaveLength(1)
    expect(first[0].text).toMatch(/Message me privately to link your Anowa account first/)
    expect(first[0].text).toContain('t.me/askAnowa_bot')
    expect(first[0].text).not.toMatch(/Offshore|Akosombo|C-07|Lake/)
    expect(await inGroup(s, ESI, '@askAnowa_bot summary again')).toEqual([])
  })

  test('a button for someone else is refused with their name; the draft stays', async () => {
    const s = await setup()
    await link(s, 'all')
    const pendingId = await s.t.run(async (ctx) => {
      const now = Date.now()
      return await ctx.db.insert('pendingBotActions', {
        bindingId: s.bindings.kofi, userId: s.kofi, companyId: s.company, siteId: s.akosombo, provider: 'telegram',
        payload: { kind: 'daily_entry', cageId: s.a01, cageName: 'A-01', feedKg: 4, mortality: 0 },
        date: todayIn('UTC'), eventTime: now, sourceMessageId: 'm', summary: 'A-01 4 kg',
        fingerprint: 'f', status: 'pending', createdAt: now, expiresAt: now + 3_600_000,
      })
    })
    const r = await tapInGroup(s, AMA, `ok:${pendingId}`)
    expect(r.toast).toBe('Only Kofi can save this.')
    expect(r.messages).toEqual([])
    expect((await s.t.run(async (ctx) => await ctx.db.get(pendingId)))!.status).toBe('pending')

    // The summary clarifier belongs to whoever asked.
    const ask = await inGroup(s, AMA, '@askAnowa_bot get me a summary')
    const site = ask[0].buttons.find((b) => b.text === 'Akosombo')!
    expect((await tapInGroup(s, KOFI, site.data)).toast).toMatch(/Only Ama can pick this/)
  })
})

describe('access', () => {
  test('effective access is the group scope intersected with the role', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const now = Date.now()
      const base = { provider: 'telegram' as const, chatId: String(GROUP), title: 'g', status: 'active' as const, linkedBy: s.ama, createdAt: now, updatedAt: now }
      const caps = { ask: true, log: true, alerts: true, money: false, buyers: false }
      const all = await ctx.db.insert('botChatGroups', { ...base, chatId: '-4', companyId: s.company, siteScope: 'all', caps })
      const offshoreOnly = await ctx.db.insert('botChatGroups', { ...base, chatId: '-2', companyId: s.company, siteScope: [s.offshore], caps })
      const kofi = await checkBinding(ctx, (await ctx.db.get(s.bindings.kofi))!)
      const ama = await checkBinding(ctx, (await ctx.db.get(s.bindings.ama))!)
      if (!kofi.ok || !ama.ok) throw new Error('binding')

      // Kofi (Akosombo only) in an all-sites group: still Akosombo only.
      const k1 = await groupBound(ctx, kofi.bound, (await ctx.db.get(all))!)
      expect(k1.ok && k1.bound.member.siteScope !== 'all' && [...k1.bound.member.siteScope]).toEqual([s.akosombo])
      // Kofi in an Offshore group: nothing in common.
      expect(await groupBound(ctx, kofi.bound, (await ctx.db.get(offshoreOnly))!)).toMatchObject({ ok: false, problem: 'no_sites' })
      // Ama (admin, all sites, finance) in the Offshore group: Offshore only, no money, no admin rights.
      const a = await groupBound(ctx, ama.bound, (await ctx.db.get(offshoreOnly))!)
      if (!a.ok) throw new Error('ama')
      expect(a.bound.member.siteScope !== 'all' && [...a.bound.member.siteScope]).toEqual([s.offshore])
      expect(can(ama.bound.member, 'finance.view')).toBe(true)
      expect(can(a.bound.member, 'finance.view')).toBe(false)
      expect(can(a.bound.member, 'integrations.manage')).toBe(false)
      // A group of another organization never binds.
      const foreign = await ctx.db.insert('botChatGroups', { ...base, chatId: '-3', companyId: s.other, siteScope: 'all', caps })
      expect(await groupBound(ctx, ama.bound, (await ctx.db.get(foreign))!)).toMatchObject({ ok: false, problem: 'wrong_company' })
    })

    // Through the bot: Kofi asks in the Offshore-only group and is told his role is the limit.
    await link(s, [s.offshore])
    const r = await inGroup(s, KOFI, '@askAnowa_bot summary')
    expect(r[0].text).toMatch(/Your role doesn't cover/)
    expect(r[0].text).not.toMatch(/C-07/)
  })

  test('/access: admins toggle money; the audit log records it', async () => {
    const s = await setup()
    await link(s, 'all')
    expect((await inGroup(s, KOFI, '/access'))[0].text).toMatch(/Only an organization admin/)
    const panel = await inGroup(s, AMA, '/access')
    expect(panel[0].text).toMatch(/Group access · Lake/)
    expect(panel[0].buttons.map((b) => b.data)).toEqual(expect.arrayContaining(['ga:all', 'ga:c:money', 'ga:done']))
    await tapInGroup(s, AMA, 'ga:c:money')
    expect((await groupRow(s))!.caps.money).toBe(true)
    const audit = await s.t.run(async (ctx) => (await ctx.db.query('auditLogs').collect()).filter((a) => a.tableName === 'botChatGroups'))
    expect(audit.map((a) => a.actionType)).toEqual(['create', 'update'])
  })
})

describe('summaries and scope', () => {
  test('"summary from offshore" answers for that site; money only with the money capability', async () => {
    const s = await setup()
    // Private chat: Ama sees money.
    const mine = await inPrivate(s, AMA, 'get me summary from offshore')
    expect(mine[0].text).toMatch(/<b>Offshore cages · Today/)
    expect(mine[0].text).toMatch(/Feed cost/)

    await link(s, 'all')
    const inG = await inGroup(s, AMA, '@askAnowa_bot get me summary from offshore')
    expect(inG[0].text).toMatch(/<b>Offshore cages · Today/)
    expect(inG[0].text).not.toMatch(/Feed cost|sales|expenses/i)

    await tapInGroup(s, AMA, 'ga:c:money')
    const withMoney = await inGroup(s, AMA, '@askAnowa_bot summary from offshore')
    expect(withMoney[0].text).toMatch(/Feed cost/)
  })

  test('cage codes, clarify buttons, and follow-ups from memory', async () => {
    const s = await setup()
    await link(s, 'all')
    const cage = await inGroup(s, AMA, '@askAnowa_bot how is c7 this week?')
    expect(cage[0].text).toMatch(/<b>C-07 · Offshore cages · This week/)

    const ask = await inGroup(s, AMA, '@askAnowa_bot get me summary')
    expect(ask[0].text).toMatch(/Which data/)
    expect(ask[0].buttons.map((b) => b.text)).toEqual(expect.arrayContaining(['All sites', 'Offshore cages', 'Akosombo', 'A cage…']))
    const picked = await tapInGroup(s, AMA, ask[0].buttons.find((b) => b.text === 'Offshore cages')!.data)
    expect(picked.messages[0].text).toMatch(/Offshore cages · Today/)

    const follow = await inGroup(s, AMA, '@askAnowa_bot and yesterday?')
    expect(follow[0].text).toMatch(/Offshore cages · Yesterday/)

    // Kofi only reaches Akosombo: "everywhere" is everywhere he can see.
    const kofi = await inGroup(s, KOFI, '@askAnowa_bot summary everywhere')
    expect(kofi[0].text).not.toMatch(/Offshore|C-07/)
  })

  test('group alerts tag the keeper and respect the alerts capability and scope', async () => {
    const s = await setup()
    await link(s, [s.akosombo])
    const post = async (locationId: Id<'farmLocations'>) => {
      const before = sent.length
      await s.t.run(async (ctx) => {
        await postGroupAlert(ctx, { companyId: s.company, locationId, mentionUserId: s.kofi, text: () => 'A-01 not logged yet today.' })
      })
      await s.t.finishAllScheduledFunctions(vi.runAllTimers)
      return out(before, GROUP)
    }
    const r = await post(s.akosombo)
    expect(r[0].text).toBe('@kofi_a A-01 not logged yet today.')
    expect(await post(s.offshore)).toEqual([])
    await tapInGroup(s, AMA, 'ga:c:alerts')
    expect(await post(s.akosombo)).toEqual([])
  })
})
