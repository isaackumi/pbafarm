/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { eventsForPair, samplesFor } from './lib/productionEngine'
import { occupancyKpis } from './lib/kpi'
import { markDirty, snapshotDates } from './lib/rollups'

const modules = import.meta.glob('./**/*.ts')

/**
 * Rollups (PLAT-002): unitDailyStats follow every write in the same
 * transaction; batchStats, recomputed by the job, equal the raw KPIs.
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
    const locationId = await ctx.db.insert('farmLocations', {
      companyId,
      name: 'Site A',
      active: true,
      updatedAt: Date.now(),
    })
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower',
      currentStock: 100000,
      minimumStock: 0,
      pricePerKg: 2,
      active: true,
      companyId,
      updatedAt: Date.now(),
    })
    // Bought at 1.5/kg: the ledger cost differs from the list price.
    await ctx.db.insert('feedPurchases', {
      feedTypeId,
      quantity: 5000,
      pricePerKg: 1.5,
      purchaseDate: '2026-04-01',
      companyId,
      updatedAt: Date.now(),
    } as any)
    const A = await ctx.db.insert('cages', {
      name: 'A',
      status: 'empty',
      currentCount: 0,
      capacity: 100000,
      locationId,
      companyId,
      updatedAt: Date.now(),
    })
    return { companyId, userId, locationId, feedTypeId, A }
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
    return id
  }
  const day = (date: string, feedAmount: number, mortality: number) =>
    as.mutation(api.dailyRecords.create, {
      cageId: ids.A,
      date,
      feedAmount,
      feedTypeId: ids.feedTypeId,
      feedPrice: 2,
      feedCost: feedAmount * 2,
      mortality,
    })
  const rows = () =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query('unitDailyStats')
          .withIndex('by_unitId_and_date', (q) => q.eq('unitId', ids.A))
          .collect()
      ).sort((a, b) => a.date.localeCompare(b.date)),
    )
  return { t, as, ids, stock, day, rows }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('unitDailyStats follow writes', () => {
  test('stocking, daily records, samples, edits and deletes', async () => {
    const { t, as, ids, stock, day, rows } = await setup()
    await stock(ids.A, 10_000, '2026-05-01')
    const d15 = await day('2026-05-15', 20, 120)
    const d16 = await day('2026-05-16', 25, 0)
    await as.mutation(api.biweeklyRecords.create, {
      cageId: ids.A,
      date: '2026-05-20',
      batchCode: 'S-1',
      averageBodyWeight: 30,
      totalFishCount: 50,
      totalWeight: 1.5,
    })

    let r = await rows()
    const byDate = Object.fromEntries(r.map((x) => [x.date, x]))
    expect(Object.keys(byDate)).toEqual(['2026-05-01', '2026-05-15', '2026-05-16', '2026-05-20'])
    expect(byDate['2026-05-01'].flows.stockedCount).toBe(10_000)
    expect(byDate['2026-05-01'].flows.stockedKg).toBe(100)
    expect(byDate['2026-05-15'].feedKg).toBe(20)
    expect(byDate['2026-05-15'].feedCostList).toBe(40)
    expect(byDate['2026-05-15'].mortalityRecorded).toBe(120)
    expect(byDate['2026-05-15'].flows.mortalityCount).toBe(120)
    expect(byDate['2026-05-20'].sampleAbwG).toBe(30)
    const batchId = byDate['2026-05-01'].batchId
    expect(batchId).toBeDefined()
    // Untagged rows go to the batch in the cage that day.
    for (const x of r) expect(x.batchId).toBe(batchId)

    // Move a record to another day: the old day's row goes, the new one appears.
    await as.mutation(api.dailyRecords.update, { id: d16, patch: { date: '2026-05-17' } })
    r = await rows()
    expect(r.map((x) => x.date)).toEqual(['2026-05-01', '2026-05-15', '2026-05-17', '2026-05-20'])

    // Delete a record with deaths: its feed goes and the reversal nets the deaths to 0.
    await as.mutation(api.dailyRecords.remove, { id: d15 })
    r = await rows()
    const deleted = r.find((x) => x.date === '2026-05-15')!
    expect(deleted.feedKg).toBe(0)
    expect(deleted.flows.mortalityCount).toBe(0)
    expect(deleted.flows.count).toBe(0)

    // The occupancy is queued once for the job.
    const queued = await t.run((ctx) => ctx.db.query('rollupDirty').collect())
    expect(queued).toHaveLength(1)
    expect(queued[0].batchId).toBe(batchId)
  })
})

describe('batchStats', () => {
  test('equal the raw KPI computation and price feed at purchase prices', async () => {
    const { t, as, ids, stock, day } = await setup()
    await stock(ids.A, 10_000, '2026-05-01')
    await day('2026-05-10', 40, 100)
    await day('2026-05-17', 60, 50)
    await day('2026-05-24', 80, 0)
    for (const [date, abw] of [
      ['2026-05-14', 20],
      ['2026-05-28', 35],
    ] as const) {
      await as.mutation(api.biweeklyRecords.create, {
        cageId: ids.A,
        date,
        batchCode: `S-${date}`,
        averageBodyWeight: abw,
        totalFishCount: 50,
        totalWeight: (abw * 50) / 1000,
      })
    }
    const r = await t.mutation(internal.rollups.processDirty, {})
    expect(r).toEqual({ processed: 1, more: false })

    const { stats, raw } = await t.run(async (ctx) => {
      const stats = (await ctx.db.query('batchStats').collect())[0]
      const events = await eventsForPair(ctx, ids.A, stats.batchId)
      const samples = await samplesFor(ctx, ids.A, stats.batchId)
      const daily = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage', (q) => q.eq('cageId', ids.A))
        .collect()
      const raw = occupancyKpis({
        events,
        samples,
        feedKg: daily.reduce((s, d) => s + d.feedAmount, 0),
        feedCost: daily.reduce((s, d) => s + d.feedCost, 0),
        asOf: stats.asOf,
      })
      const at = (date: string) =>
        occupancyKpis({
          events,
          samples,
          feedKg: daily.filter((d) => d.date <= date).reduce((s, d) => s + d.feedAmount, 0),
          asOf: date,
        })
      return { stats, raw, sunday: at('2026-05-24') }
    })
    expect(stats.kpis).toEqual(raw)
    expect(stats.open).toBe(true)
    expect(stats.lastDate).toBe('9999-12-31')
    expect(stats.kpis.count).toBe(10_000 - 150)
    expect(stats.feedCostLedger).toBeCloseTo(180 * 1.5)
    expect(stats.recentSgr).toBeCloseTo(((Math.log(35) - Math.log(20)) / 14) * 100, 5)
    // Weekly snapshots: Sundays from stocking, then the as-of date.
    expect(stats.weekly[0].date).toBe('2026-05-03')
    expect(stats.weekly[stats.weekly.length - 1].date).toBe(stats.asOf)
    const w24 = stats.weekly.find((w) => w.date === '2026-05-24')!
    expect(w24.feedKg).toBe(180)
    expect(w24.mortality).toBe(150)
    expect(w24.abwG).toBe(20)

    // Nothing queued: the job is idle.
    expect(await t.mutation(internal.rollups.processDirty, {})).toEqual({ processed: 0, more: false })
  })

  test('a complete harvest closes the occupancy', async () => {
    const { t, as, ids, stock, day } = await setup()
    await stock(ids.A, 1000, '2026-05-01')
    await day('2026-05-10', 40, 0)
    await as.mutation(api.harvest.create, {
      cageId: ids.A,
      harvestDate: '2026-07-01',
      averageBodyWeight: 300,
      totalWeight: 300,
      estimatedCount: 1000,
      fcr: 1.2,
      harvestType: 'complete',
    })
    await t.mutation(internal.rollups.processDirty, {})
    const stats = await t.run(async (ctx) => (await ctx.db.query('batchStats').collect())[0])
    expect(stats.open).toBe(false)
    expect(stats.lastDate).toBe('2026-07-01')
    expect(stats.kpis.harvested_kg).toBe(300)
    expect(stats.kpis.count).toBe(0)
  })

  test('the dirty queue keeps one row per occupancy', async () => {
    const { t, ids, stock } = await setup()
    await stock(ids.A, 1000, '2026-05-01')
    await t.run(async (ctx) => {
      const q = await ctx.db.query('rollupDirty').collect()
      await markDirty(ctx, ids.companyId, ids.A, q[0].batchId)
      await markDirty(ctx, ids.companyId, ids.A, q[0].batchId)
    })
    expect(await t.run((ctx) => ctx.db.query('rollupDirty').collect())).toHaveLength(1)
  })
})

describe('backfill', () => {
  test('dry run writes nothing; a real run rebuilds the same rows', async () => {
    vi.useFakeTimers()
    const { t, ids, stock, day, rows } = await setup()
    await stock(ids.A, 1000, '2026-05-01')
    await day('2026-05-10', 40, 10)
    await day('2026-05-11', 45, 0)
    const before = (await rows()).map(({ _id, _creationTime, updatedAt, ...x }) => x)
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query('unitDailyStats').collect()) await ctx.db.delete(r._id)
      for (const r of await ctx.db.query('rollupDirty').collect()) await ctx.db.delete(r._id)
    })

    const dry = await t.mutation(internal.rollups.backfill, {})
    expect(dry.dryRun).toBe(true)
    expect((dry as any).wouldRebuild).toEqual(['2026-05-01', '2026-05-10', '2026-05-11'])
    expect(await rows()).toHaveLength(0)

    await t.mutation(internal.rollups.backfill, { dryRun: false })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const after = (await rows()).map(({ _id, _creationTime, updatedAt, ...x }) => x)
    expect(after).toEqual(before)
    expect(await t.run((ctx) => ctx.db.query('batchStats').collect())).toHaveLength(1)
  })
})

describe('rollup reports', () => {
  test('overview and daily series read the caller company only', async () => {
    const { t, as, ids, stock, day } = await setup()
    await stock(ids.A, 2000, '2026-05-01')
    await day('2026-05-10', 40, 20)
    await day('2026-05-11', 30, 0)
    await t.mutation(internal.rollups.processDirty, {})

    const overview = await as.query(api.reports.productionOverview, {})
    expect(overview.occupancies).toBe(1)
    expect(overview.live_fish).toBe(1980)
    expect(overview.feed_kg).toBe(70)
    expect(overview.survival_pct).toBeCloseTo(99)

    const series = await as.query(api.reports.dailySeries, { from: '2026-05-01' })
    expect(series.map((d) => [d.date, d.feed_kg, d.mortality])).toEqual([
      ['2026-05-01', 0, 0],
      ['2026-05-10', 40, 20],
      ['2026-05-11', 30, 0],
    ])

    const otherUser = await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        name: 'Other',
        code: 'OTH',
        status: 'approved',
        createdAt: Date.now(),
      })
      return await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId })
    })
    const other = t.withIdentity({ subject: `${otherUser}|s` })
    expect((await other.query(api.reports.productionOverview, {})).occupancies).toBe(0)
    expect(await other.query(api.reports.dailySeries, { from: '2026-01-01' })).toEqual([])
  })
})

describe('snapshot dates', () => {
  test('Sundays, then the end date', () => {
    expect(snapshotDates('2026-05-01', '2026-05-20')).toEqual([
      '2026-05-03',
      '2026-05-10',
      '2026-05-17',
      '2026-05-20',
    ])
    expect(snapshotDates('2026-05-03', '2026-05-03')).toEqual(['2026-05-03'])
  })
})
