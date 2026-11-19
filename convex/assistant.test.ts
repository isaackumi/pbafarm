/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import {
  fcrRises,
  forecastInsights,
  rankInsights,
  unitInsights,
  type UnitForecast,
  type WeekPoint,
} from './lib/insights'

const modules = import.meta.glob('./**/*.ts')

const week = (week_end: string, cycle_fcr: number | null, mortality = 0, mortality_pct: number | null = 0): WeekPoint => ({
  week_end,
  units: 1,
  cycle_fcr,
  mortality,
  mortality_pct,
})

describe('insight rules', () => {
  test('FCR rising 3 weeks in a row', () => {
    const series = [
      week('2026-05-03', 1.5),
      week('2026-05-10', 1.3),
      week('2026-05-17', 1.35),
      week('2026-05-24', 1.42),
      week('2026-05-31', 1.61),
    ]
    expect(fcrRises(series)).toBe(3)
    const [i] = unitInsights({ unit_id: 'u', unit_name: 'Cage B2', series })
    expect(i.kind).toBe('fcr_rising')
    expect(i.title).toBe('Cage B2 FCR rising 3 weeks in a row')
    expect(i.detail).toContain('1.30 to 1.61')
    // Two rises are not enough; a flat week breaks the run.
    expect(fcrRises(series.slice(0, 4))).toBe(2)
    expect(fcrRises([...series.slice(0, 4), week('2026-05-31', 1.42)])).toBe(0)
  })

  test('mortality spike against the 3 weeks before', () => {
    const s = [
      week('2026-05-10', null, 10, 0.2),
      week('2026-05-17', null, 15, 0.3),
      week('2026-05-24', null, 10, 0.2),
      week('2026-05-31', null, 120, 2.4),
    ]
    const [i] = unitInsights({ unit_id: 'u', unit_name: 'A1', series: s })
    expect(i.kind).toBe('mortality_spike')
    expect(i.severity).toBe('critical')
    expect(i.detail).toContain('120 deaths (2.40% of the fish)')
    // Below 0.5 % or under twice the baseline: no insight.
    expect(unitInsights({ unit_id: 'u', unit_name: 'A1', series: [...s.slice(0, 3), week('2026-05-31', null, 5, 0.4)] })).toEqual([])
    expect(unitInsights({ unit_id: 'u', unit_name: 'A1', series: [week('a', null, 30, 0.6), week('b', null, 30, 0.6), week('c', null, 30, 0.6), week('d', null, 40, 0.8)] })).toEqual([])
  })

  test('harvest ready and behind target', () => {
    const f: UnitForecast = {
      unit_id: 'u',
      unit_name: 'C3',
      days_of_culture: 150,
      abw_g: 300,
      target_abw_now_g: 400,
      harvest_abw_g: 600,
      harvest_ready_on: '2026-06-10',
      days_to_target: 10,
    }
    const kinds = forecastInsights(f).map((i) => i.kind)
    expect(kinds).toEqual(['harvest_ready', 'behind_target'])
    expect(forecastInsights({ ...f, days_to_target: 40, abw_g: 380 })).toEqual([])
  })

  test('ranked by severity, top 3', () => {
    const mk = (id: string, severity: 'critical' | 'warning' | 'info', score: number) =>
      ({ id, severity, score }) as any
    expect(
      rankInsights([mk('a', 'info', 9), mk('b', 'warning', 1), mk('c', 'critical', 1), mk('d', 'warning', 5)]).map(
        (i) => i.id,
      ),
    ).toEqual(['c', 'd', 'b'])
  })
})

async function setup(aiEnabled: boolean) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
      settings: { aiAssistantEnabled: aiEnabled },
    })
    const userId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower',
      currentStock: 1000,
      minimumStock: 0,
      pricePerKg: 2,
      active: true,
      companyId,
      updatedAt: Date.now(),
    })
    const cage = await ctx.db.insert('cages', {
      name: 'B2',
      status: 'empty',
      currentCount: 0,
      capacity: 100000,
      companyId,
      updatedAt: Date.now(),
    })
    const otherCompany = await ctx.db.insert('companies', {
      name: 'Other',
      code: 'OTH',
      status: 'approved',
      createdAt: Date.now(),
      settings: { aiAssistantEnabled: true },
    })
    const otherUser = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompany })
    return { companyId, userId, feedTypeId, cage, otherUser }
  })
  const as = t.withIdentity({ subject: `${ids.userId}|s` })
  const other = t.withIdentity({ subject: `${ids.otherUser}|s` })
  const id = await as.mutation(api.stocking.createStocking, {
    cageId: ids.cage,
    stockingDate: '2026-05-04',
    fishCount: 1000,
    initialAbw: 10,
    initialBiomass: 10,
  })
  await as.mutation(api.stocking.approveStocking, { id })
  // Deaths jump in the last week.
  for (const [date, dead] of [
    ['2026-05-06', 1],
    ['2026-05-13', 1],
    ['2026-05-20', 1],
    ['2026-05-27', 40],
  ] as const) {
    await as.mutation(api.dailyRecords.create, {
      cageId: ids.cage as Id<'cages'>,
      date,
      feedAmount: 10,
      feedTypeId: ids.feedTypeId,
      feedPrice: 2,
      feedCost: 20,
      mortality: dead,
    })
  }
  await t.mutation(internal.rollups.processDirty, {})
  return { t, as, other, ids }
}

describe('assistant queries', () => {
  test('dashboard insights come from the caller company only', async () => {
    const { as, other } = await setup(false)
    const mine = await as.query(api.assistant.forDashboard, { asOf: '2026-05-31' })
    expect(mine.map((i) => i.kind)).toContain('mortality_spike')
    expect(mine[0].title).toContain('B2')
    expect(await other.query(api.assistant.forDashboard, { asOf: '2026-05-31' })).toEqual([])
  })

  test('context needs the company AI switch and holds only the company data', async () => {
    const off = await setup(false)
    await expect(off.as.query(api.assistant.context, { asOf: '2026-05-31' })).rejects.toThrow(
      /disabled by admin/,
    )

    const on = await setup(true)
    const ctx = await on.as.query(api.assistant.context, { asOf: '2026-05-31', days: 30 })
    expect(ctx.farm).toBe('Lake Farm')
    expect(ctx.open_cycles.map((c) => c.unit)).toEqual(['B2'])
    expect(ctx.open_cycles[0].fish).toBe(1000 - 43)
    expect((ctx as any).last_30_days.reduce((s: number, d: any) => s + d.deaths, 0)).toBe(43)
    expect(ctx.insights.length).toBeGreaterThan(0)

    const theirs = await on.other.query(api.assistant.context, { asOf: '2026-05-31' })
    expect(theirs.open_cycles).toEqual([])
    expect(JSON.stringify(theirs)).not.toContain('B2')
  })
})

describe('assistant site scope (PERM-004, audit C)', () => {
  test('site-A members get no site-B cycles in insights, the LLM context or rollup reports', async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const ids = await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true } })
      const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'A', active: true, updatedAt: now })
      const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'B', active: true, updatedAt: now })
      const mk = async (email: string, roleKey: 'owner' | 'manager' | 'field_staff', scoped: boolean, active: typeof siteA) => {
        const userId = await ctx.db.insert('users', { email, role: roleKey === 'owner' ? 'admin' : 'user', companyId, activeLocationId: active, ...(scoped ? { locationIds: [siteA] } : {}) })
        await ctx.db.insert('memberships', { userId, companyId, roleKey, allLocations: !scoped, ...(scoped ? { locationIds: [siteA] } : {}), status: 'active', updatedAt: now })
        return userId
      }
      const owner = await mk('o@x.com', 'owner', false, siteB)
      const manager = await mk('m@x.com', 'manager', true, siteA)
      const field = await mk('f@x.com', 'field_staff', true, siteA)
      const feedTypeId = await ctx.db.insert('feedTypes', { name: 'Grower', currentStock: 1000, minimumStock: 0, pricePerKg: 2, active: true, companyId, updatedAt: now })
      const cage = await ctx.db.insert('cages', { name: 'SECRET-B2', status: 'empty', currentCount: 0, capacity: 100000, companyId, locationId: siteB, updatedAt: now })
      return { siteB, owner, manager, field, feedTypeId, cage }
    })
    const asOwner = t.withIdentity({ subject: `${ids.owner}|s` })
    const id = await asOwner.mutation(api.stocking.createStocking, { cageId: ids.cage, stockingDate: '2026-05-04', fishCount: 1000, initialAbw: 10, initialBiomass: 10 })
    await asOwner.mutation(api.stocking.approveStocking, { id })
    for (const [date, dead] of [['2026-05-06', 1], ['2026-05-13', 1], ['2026-05-20', 1], ['2026-05-27', 40]] as const) {
      await asOwner.mutation(api.dailyRecords.create, { cageId: ids.cage, date, feedAmount: 10, feedTypeId: ids.feedTypeId, feedPrice: 2, feedCost: 20, mortality: dead })
    }
    await t.mutation(internal.rollups.processDirty, {})
    const asField = t.withIdentity({ subject: `${ids.field}|s` })
    const asManager = t.withIdentity({ subject: `${ids.manager}|s` })

    expect(await asField.query(api.assistant.forDashboard, { asOf: '2026-05-31' })).toEqual([])
    await expect(
      asField.query(api.assistant.forDashboard, { asOf: '2026-05-31', locationId: ids.siteB }),
    ).rejects.toThrow(/access to this site/)
    const c = await asManager.query(api.assistant.context, { asOf: '2026-05-31', days: 30 })
    expect(c.open_cycles).toEqual([])
    expect((c as any).last_30_days).toEqual([])
    expect(JSON.stringify(c)).not.toContain('SECRET')
    expect(await asManager.query(api.reports.dailySeries, { from: '2026-05-01', to: '2026-05-31' })).toEqual([])
    expect(await asManager.query(api.reports.productionOverview, {})).toMatchObject({ occupancies: 0, live_fish: 0 })

    // The all-sites owner still sees the site-B cycle.
    expect((await asOwner.query(api.assistant.forDashboard, { asOf: '2026-05-31' })).map((i) => i.kind)).toContain('mortality_spike')
    expect(await asOwner.query(api.reports.productionOverview, {})).toMatchObject({ occupancies: 1, live_fish: 1000 - 43 })
  })
})
