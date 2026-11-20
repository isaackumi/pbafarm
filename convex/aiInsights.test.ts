/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { addDays } from './lib/dates'

const modules = import.meta.glob('./**/*.ts')

// Notification emails are scheduled; fake timers keep them from running.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-15T08:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

type Role = 'owner' | 'manager' | 'field_staff' | 'viewer'

/**
 * Two sites, one stocked cage in each, 12 quiet days (1 death a day) and a
 * spike of 60 deaths in 1,000 fish on the last day in both cages.
 */
async function twoSiteFarm(opts: { ai?: boolean } = {}) {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const now = Date.now()
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake',
      code: 'LAKE',
      status: 'approved',
      createdAt: now,
      settings: { aiAssistantEnabled: opts.ai ?? false },
    })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'Site B', active: true, updatedAt: now })
    const mk = async (email: string, roleKey: Role, sites: Id<'farmLocations'>[] | null) => {
      const userId = await ctx.db.insert('users', {
        email,
        role: roleKey === 'owner' ? 'admin' : 'user',
        companyId,
        activeLocationId: sites?.[0] ?? siteA,
        ...(sites ? { locationIds: sites } : {}),
      })
      await ctx.db.insert('memberships', {
        userId,
        companyId,
        roleKey,
        allLocations: !sites,
        ...(sites ? { locationIds: sites } : {}),
        status: 'active',
        updatedAt: now,
      })
      return userId
    }
    const owner = await mk('o@x.com', 'owner', null)
    const fieldA = await mk('fa@x.com', 'field_staff', [siteA])
    const viewerA = await mk('va@x.com', 'viewer', [siteA])
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower',
      currentStock: 100000,
      minimumStock: 0,
      pricePerKg: 2,
      active: true,
      companyId,
      updatedAt: now,
    })
    const cageA = await ctx.db.insert('cages', { name: 'CAGE-A1', status: 'empty', currentCount: 0, capacity: 100000, companyId, locationId: siteA, updatedAt: now })
    const cageB = await ctx.db.insert('cages', { name: 'SECRET-B1', status: 'empty', currentCount: 0, capacity: 100000, companyId, locationId: siteB, updatedAt: now })
    return { companyId, siteA, siteB, owner, fieldA, viewerA, feedTypeId, cageA, cageB }
  })
  const as = (u: Id<'users'>) => t.withIdentity({ subject: `${u}|s` })
  const owner = as(ids.owner)
  const start = '2026-05-01'
  const last = addDays(start, 13)
  for (const cageId of [ids.cageA, ids.cageB]) {
    const id = await owner.mutation(api.stocking.createStocking, { cageId, stockingDate: start, fishCount: 1000, initialAbw: 50, initialBiomass: 50 })
    await owner.mutation(api.stocking.approveStocking, { id })
    for (let d = 1; d <= 13; d++) {
      const date = addDays(start, d)
      await owner.mutation(api.dailyRecords.create, {
        cageId,
        date,
        feedAmount: 10,
        feedTypeId: ids.feedTypeId,
        feedPrice: 2,
        feedCost: 20,
        mortality: date === last ? 60 : 1,
      })
    }
  }
  await t.mutation(internal.rollups.processDirty, {})
  return { t, ids, as, last }
}

describe('early-warning alerts (AI-001)', () => {
  test('a mortality spike raises one critical alert per unit, idempotently', async () => {
    const { t, ids, as, last } = await twoSiteFarm()
    await t.mutation(internal.farmAlerts.evaluateCompany, { companyId: ids.companyId, date: last })
    await t.mutation(internal.farmAlerts.evaluateCompany, { companyId: ids.companyId, date: last })
    const all = await as(ids.owner).query(api.farmAlerts.list, {})
    const spikes = all.filter((a) => a.rule === 'mortality_spike')
    expect(spikes).toHaveLength(2)
    expect(spikes[0].severity).toBe('critical')
    expect(spikes[0].evidence).toMatchObject({ deaths: 60 })
    const rows = await t.run((ctx) => ctx.db.query('farmAlerts').collect())
    expect(rows.filter((r) => r.rule === 'mortality_spike')).toHaveLength(2)
  })

  test('site-A members never see site-B alerts, in the app or for the bot', async () => {
    const { t, ids, as, last } = await twoSiteFarm()
    await t.mutation(internal.farmAlerts.evaluateCompany, { companyId: ids.companyId, date: last })
    const mine = await as(ids.fieldA).query(api.farmAlerts.list, {})
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((a) => a.unitId === ids.cageA)).toBe(true)
    await expect(as(ids.fieldA).query(api.farmAlerts.list, { locationId: ids.siteB })).rejects.toThrow(/access to this site/)
    // In-app notifications follow the same scope.
    const notes = await t.run((ctx) => ctx.db.query('notifications').collect())
    const forField = notes.filter((n) => n.userId === ids.fieldA)
    expect(forField.length).toBeGreaterThan(0)
    expect(JSON.stringify(forField)).not.toContain('SECRET')
    expect(notes.some((n) => n.userId === ids.owner && n.message.includes('SECRET'))).toBe(true)
    const bot = await t.query(internal.farmAlerts.openForMember, { companyId: ids.companyId, userId: ids.fieldA })
    expect(JSON.stringify(bot)).not.toContain('SECRET')
    const b = (await as(ids.owner).query(api.farmAlerts.list, {})).find((a) => a.unitId === ids.cageB)!
    await expect(as(ids.fieldA).mutation(api.farmAlerts.resolve, { alertId: b._id })).rejects.toThrow()
  })

  test('a resolved alert stays quiet in its cool-down unless it escalates', async () => {
    const { t, ids, as, last } = await twoSiteFarm()
    await t.mutation(internal.farmAlerts.evaluateCompany, { companyId: ids.companyId, date: last })
    const owner = as(ids.owner)
    const a = (await owner.query(api.farmAlerts.list, {})).find((x) => x.unitId === ids.cageA && x.rule === 'mortality_spike')!
    await owner.mutation(api.farmAlerts.acknowledge, { alertId: a._id })
    await owner.mutation(api.farmAlerts.resolve, { alertId: a._id })
    // Same evidence on the next run: still resolved, no new row.
    await t.mutation(internal.farmAlerts.evaluateCompany, { companyId: ids.companyId, date: last })
    const rows = await t.run((ctx) =>
      ctx.db
        .query('farmAlerts')
        .withIndex('by_unitId_and_rule', (q) => q.eq('unitId', ids.cageA).eq('rule', 'mortality_spike'))
        .collect(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('resolved')
  })
})

describe('weekly report (AI-003)', () => {
  // The spike day is Thursday 2026-05-14; the report week ends Sunday 05-10.
  const weekEnd = '2026-05-10'

  test('site reports hold only their site; costs only for finance.view', async () => {
    const { t, ids, as } = await twoSiteFarm()
    for (const locationId of [ids.siteA, ids.siteB, undefined]) {
      const r = await t.action(internal.aiReports.generateWeekly, { companyId: ids.companyId, locationId, weekEnd, lang: 'en' })
      expect(r).toMatchObject({ source: 'template', reused: false })
    }
    // Idempotent per scope/week/language.
    expect(await t.action(internal.aiReports.generateWeekly, { companyId: ids.companyId, locationId: ids.siteA, weekEnd, lang: 'en' })).toMatchObject({ reused: true })

    const field = await as(ids.fieldA).query(api.aiReports.list, {})
    expect(field.map((r) => r.locationId)).toEqual([ids.siteA])
    expect(field[0].text).toContain('CAGE-A1')
    expect(JSON.stringify(field)).not.toContain('SECRET')
    expect(field[0].financeText).toBeNull()
    expect(field[0].text).not.toMatch(/GHS|USD|cost/i)
    // Key figures come from the stored pack, never costs.
    expect(field[0].figures).toMatchObject({ weekStart: '2026-05-04', units: expect.any(Number), feedKg: expect.any(Number) })
    expect(JSON.stringify(field[0].figures)).not.toMatch(/cost|SECRET/i)

    const viewer = await as(ids.viewerA).query(api.aiReports.list, {})
    expect(viewer).toHaveLength(1)
    expect(viewer[0].financeText).toMatch(/\d/)

    const owner = await as(ids.owner).query(api.aiReports.list, {})
    expect(owner).toHaveLength(3)
    await expect(as(ids.fieldA).query(api.aiReports.list, { locationId: ids.siteB })).rejects.toThrow(/access to this site/)
    // Company-wide reports are for all-sites members only.
    await expect(as(ids.fieldA).action(api.aiReports.generateNow, {})).rejects.toThrow(/every site/)
  })

  test('falls back to the template without AI and delivers in the reader language', async () => {
    const { t, ids } = await twoSiteFarm({ ai: false })
    await t.run((ctx) => ctx.db.patch(ids.fieldA, { locale: 'fr' }))
    const r = await t.action(internal.aiReports.generateWeekly, {
      companyId: ids.companyId,
      locationId: ids.siteA,
      weekEnd,
      lang: 'fr',
      deliver: true,
    })
    expect(r?.source).toBe('template')
    const row = await t.run((ctx) => ctx.db.get(r!.reportId))
    expect(row?.text).toMatch(/Semaine|semaine/)
    const notes = await t.run((ctx) => ctx.db.query('notifications').collect())
    const got = new Set(notes.filter((n) => n.link === '/weekly-report').map((n) => n.userId))
    expect(got.has(ids.fieldA)).toBe(true)
    // English readers get the English report, not this one.
    expect(got.has(ids.owner)).toBe(false)
    expect(await t.query(internal.aiReports.readerLangs, { companyId: ids.companyId, locationId: ids.siteA })).toEqual(
      expect.arrayContaining(['en', 'fr']),
    )
  })

  test('the bot gets the member scope and no costs without finance.view', async () => {
    const { t, ids } = await twoSiteFarm()
    vi.setSystemTime(new Date('2026-05-12T08:00:00Z'))
    const field = await t.action(internal.aiReports.forBot, { companyId: ids.companyId, userId: ids.fieldA })
    expect(field?.weekEnd).toBe(weekEnd)
    expect(field?.text).toContain('CAGE-A1')
    expect(field?.text).not.toContain('SECRET')
    expect(field?.financeText).toBeNull()
    const viewer = await t.action(internal.aiReports.forBot, { companyId: ids.companyId, userId: ids.viewerA })
    expect(viewer?.financeText).toMatch(/\d/)
  })
})

describe('weekly report LLM phrasing (AI-003)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const reply = (content: string) =>
    vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

  test('uses a grounded reply, rejects an invented figure, and charges the quota either way', async () => {
    const { t, ids } = await twoSiteFarm({ ai: true })
    vi.stubEnv('LLM_DEFAULT_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    // The fake answers every URL with a chat reply, so the live model list is unreadable: the env default is used (D-022).
    vi.stubEnv('LLM_DEFAULT_MODEL_OPENAI', 'gpt-test')
    const pack = await t.query(internal.aiReports.buildPack, { companyId: ids.companyId, locationId: ids.siteA, weekEnd: '2026-05-10', lang: 'en' })
    const p = JSON.parse(pack!.packJson)
    const grounded = `Week ${p.weekStart} to ${p.weekEnd}: ${p.week.mortality} fish died and the farm fed ${p.week.feed_kg} kg across ${p.week.units} unit.`
    vi.stubGlobal('fetch', reply(grounded))
    const ok = await t.action(internal.aiReports.generateWeekly, { companyId: ids.companyId, locationId: ids.siteA, weekEnd: '2026-05-10', lang: 'en' })
    expect(ok?.source).toBe('llm')
    expect((await t.run((ctx) => ctx.db.get(ok!.reportId)))?.text).toBe(grounded)

    vi.stubGlobal('fetch', reply(`${grounded} Next week the farm will harvest 4,321 kg.`))
    const bad = await t.action(internal.aiReports.generateWeekly, { companyId: ids.companyId, locationId: ids.siteA, weekEnd: '2026-05-10', lang: 'en', force: true })
    expect(bad?.source).toBe('template')

    const usage = await t.run((ctx) => ctx.db.query('llmUsage').collect())
    expect(usage.filter((u) => u.feature === 'report')).toHaveLength(2)
  })
})
