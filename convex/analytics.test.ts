/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { daysToReach, efcr, projectAbw, projectCount, sgr } from './lib/kpi'
import { weekEnds } from './lib/analytics'

const modules = import.meta.glob('./**/*.ts')

/**
 * Analytics (ANLY-002..004) over the rollups: two sites compared on FCR,
 * survival and cost per kg for the same period; forecasts that agree with
 * the SGR definition; weekly trends; cycle profitability; tenant isolation.
 */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
    })
    const userId = await ctx.db.insert('users', { email: 'admin@x.com', role: 'admin', companyId })
    const site = (name: string) =>
      ctx.db.insert('farmLocations', { companyId, name, active: true, updatedAt: Date.now() })
    const north = await site('North')
    const south = await site('South')
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower',
      currentStock: 100000,
      minimumStock: 0,
      pricePerKg: 2,
      active: true,
      companyId,
      updatedAt: Date.now(),
    })
    await ctx.db.insert('feedPurchases', {
      feedTypeId,
      quantity: 10000,
      pricePerKg: 1,
      purchaseDate: '2026-04-01',
      companyId,
      updatedAt: Date.now(),
    })
    const cage = (name: string, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', {
        name,
        status: 'empty',
        currentCount: 0,
        capacity: 100000,
        locationId,
        companyId,
        updatedAt: Date.now(),
      })
    return {
      companyId,
      userId,
      feedTypeId,
      north,
      south,
      N1: await cage('N1', north),
      S1: await cage('S1', south),
    }
  })
  const as = t.withIdentity({ subject: `${ids.userId}|s` })
  const stock = async (cageId: Id<'cages'>, fishCount: number, date: string) => {
    const id = await as.mutation(api.stocking.createStocking, {
      cageId,
      stockingDate: date,
      fishCount,
      initialAbw: 10,
      initialBiomass: (fishCount * 10) / 1000,
    })
    await as.mutation(api.stocking.approveStocking, { id })
  }
  const day = (cageId: Id<'cages'>, date: string, feedAmount: number, mortality: number) =>
    as.mutation(api.dailyRecords.create, {
      cageId,
      date,
      feedAmount,
      feedTypeId: ids.feedTypeId,
      feedPrice: 2,
      feedCost: feedAmount * 2,
      mortality,
    })
  const sample = (cageId: Id<'cages'>, date: string, abw: number) =>
    as.mutation(api.biweeklyRecords.create, {
      cageId,
      date,
      batchCode: `S-${cageId}-${date}`,
      averageBodyWeight: abw,
      totalFishCount: 50,
      totalWeight: (abw * 50) / 1000,
    })
  return { t, as, ids, stock, day, sample }
}

/** N1: 1000 fish, 10 -> 50 g, 60 kg feed, 50 deaths. S1: 1000 fish, 10 -> 30 g, 60 kg, 0 deaths. */
async function scenario() {
  const s = await setup()
  const { t, ids, stock, day, sample } = s
  await stock(ids.N1, 1000, '2026-05-04')
  await stock(ids.S1, 1000, '2026-05-04')
  await day(ids.N1, '2026-05-10', 30, 50)
  await day(ids.N1, '2026-05-17', 30, 0)
  await day(ids.S1, '2026-05-10', 30, 0)
  await day(ids.S1, '2026-05-17', 30, 0)
  await sample(ids.N1, '2026-05-24', 50)
  await sample(ids.S1, '2026-05-24', 30)
  await t.run(async (ctx) => {
    await ctx.db.insert('expenses', {
      companyId: ids.companyId,
      locationId: ids.north,
      cageId: ids.N1,
      category: 'labour',
      amount: 40,
      currency: 'GHS',
      date: '2026-05-15',
      updatedAt: Date.now(),
    })
  })
  await t.mutation(internal.rollups.processDirty, {})
  return s
}

describe('farm comparison', () => {
  test('two sites side by side on FCR, survival and cost per kg', async () => {
    const { as } = await scenario()
    const r = await as.query(api.analytics.comparison, { from: '2026-05-04', to: '2026-05-31' })
    const north = r.sites.find((x) => x.name === 'North')!
    const south = r.sites.find((x) => x.name === 'South')!

    // N1: standing 950 × 50 g = 47.5 kg, stocked 10 kg -> gain 37.5 kg.
    expect(north.gain_kg).toBe(37.5)
    expect(north.fcr).toBe(Math.round(efcr(60, 37.5)! * 100) / 100)
    expect(north.survival_pct).toBe(95)
    // S1: 1000 × 30 g = 30 kg - 10 kg = 20 kg gained.
    expect(south.gain_kg).toBe(20)
    expect(south.fcr).toBe(3)
    expect(south.survival_pct).toBe(100)
    // Feed at the purchase price (1/kg), plus the cage's labour.
    expect(north.feed_cost).toBe(60)
    expect(north.total_cost).toBe(100)
    expect(north.cost_per_kg_produced).toBeCloseTo(100 / 37.5, 2)
    expect(south.cost_per_kg_produced).toBe(3)
    // Nothing harvested or sold: cost per harvested kg is not defined.
    expect(north.cost_per_kg).toBeNull()

    expect(r.units.map((u) => [u.name, u.site_name])).toEqual([
      ['N1', 'North'],
      ['S1', 'South'],
    ])
    expect(r.farm.gain_kg).toBe(57.5)
    expect(r.farm.fcr).toBe(Math.round(efcr(120, 57.5)! * 100) / 100)
  })

  test('a later period is the difference of weekly snapshots', async () => {
    const { as } = await scenario()
    // Week of 05-11..05-17: 30 kg feed each, no new sample -> no gain.
    const r = await as.query(api.analytics.comparison, { from: '2026-05-11', to: '2026-05-17' })
    const n1 = r.units.find((u) => u.name === 'N1')!
    expect(n1.feed_kg).toBe(30)
    expect(n1.mortality).toBe(0)
    expect(n1.fcr).toBeNull()
  })

  test('another company sees nothing', async () => {
    const { t } = await scenario()
    const other = await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        name: 'Other',
        code: 'OTH',
        status: 'approved',
        createdAt: Date.now(),
      })
      return await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId })
    })
    const as = t.withIdentity({ subject: `${other}|s` })
    const r = await as.query(api.analytics.comparison, { from: '2026-05-01', to: '2026-05-31' })
    expect(r.units).toEqual([])
    expect(r.sites).toEqual([])
    expect((await as.query(api.analytics.growth, { asOf: '2026-05-31' })).occupancies).toEqual([])
    expect(await as.query(api.analytics.cycles, {})).toEqual([])
  })

  test('refuses bad dates', async () => {
    const { as } = await setup()
    await expect(
      as.query(api.analytics.comparison, { from: '2026-05-31', to: '2026-05-01' }),
    ).rejects.toThrow(/From must be on or before To/)
  })
})

describe('growth and forecast', () => {
  test('curve, target and a forecast that follows the SGR definition', async () => {
    const { as } = await scenario()
    const r = await as.query(api.analytics.growth, {
      asOf: '2026-05-31',
      forecastOn: '2026-06-30',
      targetAbwG: 200,
    })
    const n1 = r.occupancies.find((o) => o.unit_name === 'N1')!
    expect(n1.curve.find((p) => p.date === '2026-05-24')!.abw_g).toBe(50)
    // Target curve starts at the stocking ABW.
    expect(n1.curve[0].target_g).toBeGreaterThan(10)
    const f = n1.forecast!
    // One sample only: the cycle SGR (10 g on 05-04 -> 50 g on 05-24).
    const rate = sgr(10, 50, 20)!
    expect(f.sgr_source).toBe('cycle')
    expect(f.sgr_pct_day).toBeCloseTo(rate, 2)
    expect(f.projected_abw_g).toBeCloseTo(projectAbw(50, Math.round(rate * 100) / 100, 37)!, 0)
    expect(f.harvest_ready_on).toBeDefined()
    // No deaths in the 28 days to the rollup date: the count holds.
    expect(f.projected_count).toBe(950)
  })

  test('kpi forecast helpers invert sgr', () => {
    const rate = sgr(20, 80, 30)!
    expect(projectAbw(20, rate, 30)).toBeCloseTo(80, 6)
    expect(daysToReach(20, 80, rate)).toBe(30)
    expect(daysToReach(100, 80, rate)).toBe(0)
    expect(daysToReach(20, 80, 0)).toBeNull()
    expect(projectCount(1000, 1, 2)).toBe(980)
    expect(projectCount(1000, null, 30)).toBe(1000)
  })
})

describe('trends and cycles', () => {
  test('weekly feed, FCR and deaths per unit', async () => {
    const { as } = await scenario()
    const r = await as.query(api.analytics.trends, { asOf: '2026-05-31', weeks: 4 })
    expect(r.weeks).toEqual(weekEnds('2026-05-31', 4))
    expect(r.weeks).toEqual(['2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'])
    const n1 = r.units.find((u) => u.unit_name === 'N1')!
    expect(n1.series.map((w) => w.feed_kg)).toEqual([30, 30, 0, 0])
    expect(n1.series.map((w) => w.mortality)).toEqual([50, 0, 0, 0])
    expect(n1.series[2].cycle_fcr).toBe(Math.round(efcr(60, 37.5)! * 100) / 100)
    expect(r.farm[0].feed_kg).toBe(60)
  })

  test('profitability by cycle', async () => {
    const { as } = await scenario()
    const rows = await as.query(api.analytics.cycles, {})
    const n1 = rows.find((r) => r.unit_name === 'N1')!
    expect(n1.open).toBe(true)
    expect(n1.feed_cost).toBe(60)
    expect(n1.other_cost).toBe(40)
    expect(n1.net_margin).toBe(-100)
  })
})

describe('audit B: site scope and finance gating', () => {
  async function scoped() {
    const s = await scenario()
    const { t, ids } = s
    const member = async (email: string, roleKey: 'field_staff' | 'viewer') => {
      const userId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert('users', {
          email,
          role: 'user',
          companyId: ids.companyId,
          locationIds: [ids.north],
        })
        await ctx.db.insert('memberships', {
          userId,
          companyId: ids.companyId,
          roleKey,
          allLocations: false,
          locationIds: [ids.north],
          status: 'active',
          updatedAt: Date.now(),
        } as any)
        return userId
      })
      return t.withIdentity({ subject: `${userId}|s` })
    }
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.insert('sales', {
        companyId: ids.companyId, locationId: ids.south, cageId: ids.S1, saleDate: '2026-05-20',
        weightKg: 10, pricePerKg: 777.7, totalAmount: 7777, paymentStatus: 'paid', updatedAt: now,
      } as any)
      // Tagged with the South unit only: no locationId on the row.
      await ctx.db.insert('expenses', {
        companyId: ids.companyId, cageId: ids.S1, category: 'labour', amount: 4444, currency: 'GHS',
        date: '2026-05-16', updatedAt: now,
      })
      await ctx.db.insert('sales', {
        companyId: ids.companyId, cageId: ids.S1, saleDate: '2026-05-21',
        weightKg: 5, pricePerKg: 100, totalAmount: 500, paymentStatus: 'paid', updatedAt: now,
      } as any)
    })
    return { ...s, staff: await member('field@x.com', 'field_staff'), viewer: await member('viewer@x.com', 'viewer') }
  }

  const MONEY = ['feed_cost', 'fingerling_cost', 'other_cost', 'revenue', 'total_cost', 'cost_per_kg', 'cost_per_kg_produced', 'net_margin', 'net_margin_pct']

  test('a North-only member sees no South rows, and farm totals use in-scope rows only', async () => {
    const { ids, viewer, as } = await scoped()
    const range = { from: '2026-05-01', to: '2026-05-31' }

    const cmp = await viewer.query(api.analytics.comparison, range)
    expect(cmp.sites.map((x) => x.id)).toEqual([ids.north])
    expect(cmp.units.map((u) => u.id)).toEqual([ids.N1])
    expect(cmp.farm.occupancies).toBe(1)
    // Only North's labour expense (40); the South sale and unit-only cost and sale are out.
    expect(cmp.farm.other_cost).toBe(40)
    expect(cmp.farm.revenue).toBe(0)
    // The admin sees both.
    const all = await as.query(api.analytics.comparison, range)
    expect(all.farm.revenue).toBe(7777 + 500)
    expect(all.farm.other_cost).toBe(40 + 4444)

    const cycles = await viewer.query(api.analytics.cycles, {})
    expect(cycles.map((c) => c.unit_id)).toEqual([ids.N1])

    const growth = await viewer.query(api.analytics.growth, { asOf: '2026-05-31' })
    expect(growth.occupancies.map((o) => o.unit_id)).toEqual([ids.N1])

    const trends = await viewer.query(api.analytics.trends, { asOf: '2026-05-31', weeks: 6 })
    expect(trends.units.map((u) => u.unit_id)).toEqual([ids.N1])
    const allTrends = await as.query(api.analytics.trends, { asOf: '2026-05-31', weeks: 6 })
    const feed = (r: typeof trends) => r.farm.reduce((sum, w) => sum + w.feed_kg, 0)
    expect(feed(trends)).toBe(60)
    expect(feed(allTrends)).toBe(120)

    await expect(viewer.query(api.analytics.cycles, { locationId: ids.south })).rejects.toThrow(/access to this site/)
  })

  test('without finance.view, cycles and comparison carry no money fields', async () => {
    const { staff, viewer } = await scoped()
    const range = { from: '2026-05-01', to: '2026-05-31' }
    const noMoney = (row: object) => expect(Object.keys(row).filter((k) => MONEY.includes(k))).toEqual([])

    const cycles = await staff.query(api.analytics.cycles, {})
    expect(cycles).toHaveLength(1)
    cycles.forEach(noMoney)
    expect(cycles[0].fcr).not.toBeUndefined()
    const cmp = await staff.query(api.analytics.comparison, range)
    noMoney(cmp.farm)
    cmp.sites.forEach(noMoney)
    cmp.units.forEach(noMoney)
    expect(cmp.farm.feed_kg).toBe(60)

    // finance.view keeps them.
    const withMoney = await viewer.query(api.analytics.cycles, {})
    expect(withMoney[0]).toMatchObject({ other_cost: 40, revenue: 0 })
  })
})
