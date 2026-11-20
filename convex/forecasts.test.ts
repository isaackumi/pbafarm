/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { FORECAST_CHECK_DAYS } from './lib/forecastData'

const modules = import.meta.glob('./**/*.ts')

/**
 * Growth and harvest forecasts (AI-004): the cage forecast and the farm
 * planner from real records, tenant and site isolation, and the forecast
 * error stored when a harvest is recorded (and rewritten / removed with it).
 */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: Date.now() })
    const companyId = await company('Lake Farm', 'LAKE')
    const otherCompanyId = await company('Other Farm', 'OTHR')
    const userId = await ctx.db.insert('users', { email: 'admin@x.com', role: 'admin', companyId })
    const otherUserId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const north = await ctx.db.insert('farmLocations', { companyId, name: 'North', active: true, updatedAt: Date.now() })
    const south = await ctx.db.insert('farmLocations', { companyId, name: 'South', active: true, updatedAt: Date.now() })
    const siteUserId = await ctx.db.insert('users', {
      email: 'south@x.com',
      role: 'admin',
      companyId,
      locationIds: [south],
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
    const N1 = await ctx.db.insert('cages', {
      name: 'N1',
      status: 'empty',
      currentCount: 0,
      capacity: 100000,
      species: 'nile_tilapia',
      locationId: north,
      companyId,
      updatedAt: Date.now(),
    })
    return { companyId, otherCompanyId, userId, otherUserId, siteUserId, north, south, feedTypeId, N1 }
  })
  const as = t.withIdentity({ subject: `${ids.userId}|s` })
  const other = t.withIdentity({ subject: `${ids.otherUserId}|s` })
  const southOnly = t.withIdentity({ subject: `${ids.siteUserId}|s` })
  return { t, as, other, southOnly, ids }
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const OPENED = '2026-05-04'
/** ABW at day d: cube-root growth (TGC ≈ 1.2 at 28 °C) from 10 g. */
const abwAt = (d: number) => (Math.cbrt(10) + (1.2 * 28 * 0.9 * d) / 1000) ** 3

async function scenario() {
  const s = await setup()
  const { t, as, ids } = s
  const id = await as.mutation(api.stocking.createStocking, {
    cageId: ids.N1,
    stockingDate: OPENED,
    fishCount: 1000,
    initialAbw: 10,
    initialBiomass: 10,
    species: 'nile_tilapia',
  })
  await as.mutation(api.stocking.approveStocking, { id })
  for (let w = 1; w <= 8; w++) {
    const date = addDays(OPENED, 14 * w)
    await as.mutation(api.biweeklyRecords.create, {
      cageId: ids.N1,
      date,
      batchCode: `S-${date}`,
      averageBodyWeight: Math.round(abwAt(14 * w) * 10) / 10,
      totalFishCount: 50,
      totalWeight: 1,
    })
    await as.mutation(api.dailyRecords.create, {
      cageId: ids.N1,
      date,
      feedAmount: 120,
      feedTypeId: ids.feedTypeId,
      feedPrice: 2,
      feedCost: 240,
      mortality: 2,
      temperatureC: 28,
    })
  }
  await t.mutation(internal.rollups.processDirty, {})
  return s
}

const ASOF = addDays(OPENED, 14 * 8)

describe('cage forecast', () => {
  test('fitted to the cycle, band ordered, harvest date range to the target', async () => {
    const { as, ids } = await scenario()
    const f = (await as.query(api.forecasts.forUnit, { unitId: ids.N1, asOf: ASOF, targetAbwG: 400 }))!
    expect(f).not.toBeNull()
    expect(f.method).toBe('fitted')
    expect(f.few_samples).toBe(false)
    expect(f.temperature).toEqual({ c: 28, source: 'recorded' })
    expect(f.target_source).toBe('input')
    expect(f.now!.low).toBeLessThanOrEqual(f.now!.expected)
    expect(f.now!.expected).toBeLessThanOrEqual(f.now!.high)
    for (const p of f.series) {
      expect(p.low).toBeLessThanOrEqual(p.expected)
      expect(p.expected).toBeLessThanOrEqual(p.high)
    }
    expect(f.plan.earliest! <= f.plan.expected!).toBe(true)
    expect(f.plan.expected! <= f.plan.latest!).toBe(true)
    expect(f.plan.expected_biomass_kg).toBeGreaterThan(0)
    // Default target is the species' (tilapia 500 g).
    const d = (await as.query(api.forecasts.forUnit, { unitId: ids.N1, asOf: ASOF }))!
    expect(d.target_source).toBe('species')
    expect(d.plan.target_g).toBe(500)
    expect(d.grades.map((g) => g.key)).toContain('Eco')
  })

  test('a young cycle with no samples falls back to the species curve', async () => {
    const { as, ids } = await setup()
    const id = await as.mutation(api.stocking.createStocking, {
      cageId: ids.N1,
      stockingDate: OPENED,
      fishCount: 1000,
      initialAbw: 10,
      initialBiomass: 10,
    })
    await as.mutation(api.stocking.approveStocking, { id })
    const f = (await as.query(api.forecasts.forUnit, { unitId: ids.N1, asOf: addDays(OPENED, 10) }))!
    expect(f.method).toBe('species_curve')
    expect(f.start).toEqual({ date: OPENED, abw_g: 10, measured: false })
  })

  test('another company, or a site outside the caller’s, sees nothing', async () => {
    const { other, southOnly, ids } = await scenario()
    expect(await other.query(api.forecasts.forUnit, { unitId: ids.N1, asOf: ASOF })).toBeNull()
    expect((await other.query(api.forecasts.harvestPlanner, { asOf: ASOF })).rows).toEqual([])
    expect((await southOnly.query(api.forecasts.harvestPlanner, { asOf: ASOF })).rows).toEqual([])
    await expect(
      southOnly.query(api.forecasts.harvestPlanner, { asOf: ASOF, locationId: ids.north }),
    ).rejects.toThrow()
  })

  test('the planner lists the open unit with its date range', async () => {
    const { as, ids } = await scenario()
    const r = await as.query(api.forecasts.harvestPlanner, { asOf: ASOF, targetAbwG: 400 })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ unit_name: 'N1', site_name: 'North', method: 'fitted' })
    expect(r.rows[0].plan.expected).toBeTruthy()
  })
})

describe('forecast error tracking', () => {
  test('a harvest stores the forecast made 28 days earlier vs actual; edits rewrite it, delete removes it', async () => {
    const { t, as, other, ids } = await scenario()
    const harvestDate = addDays(ASOF, 14)
    const actual = Math.round(abwAt(14 * 9))
    const { id } = await as.mutation(api.harvest.create, {
      cageId: ids.N1,
      harvestDate,
      averageBodyWeight: actual,
      totalWeight: (actual * 984) / 1000,
      estimatedCount: 984,
      harvestType: 'complete',
      status: 'completed',
    })
    const rows = await t.run((ctx) =>
      ctx.db
        .query('harvestForecastChecks')
        .withIndex('by_harvestRecordId', (q) => q.eq('harvestRecordId', id))
        .collect(),
    )
    expect(rows).toHaveLength(1)
    const c = rows[0]
    expect(c).toMatchObject({
      companyId: ids.companyId,
      unitId: ids.N1,
      harvestDate,
      horizonDays: FORECAST_CHECK_DAYS,
      forecastMadeOn: addDays(harvestDate, -FORECAST_CHECK_DAYS),
      actualAbwG: actual,
      method: 'fitted',
    })
    // The forecast only saw samples up to 28 days before: it still lands near the truth.
    expect(c.absErrorPct).toBeLessThan(10)
    expect(c.predictedLowG).toBeLessThanOrEqual(c.predictedAbwG)
    expect(c.predictedAbwG).toBeLessThanOrEqual(c.predictedHighG)

    const acc = await as.query(api.forecasts.accuracy, { from: '2026-01-01', to: '2026-12-31' })
    expect(acc.summary.n).toBe(1)
    expect(acc.rows[0]).toMatchObject({ harvest_id: id, unit_name: 'N1', actual_g: actual })
    // Tenant isolation: another company sees none of it.
    expect((await other.query(api.forecasts.accuracy, { from: '2026-01-01', to: '2026-12-31' })).summary.n).toBe(0)

    await as.mutation(api.harvest.update, { id, patch: { averageBodyWeight: actual * 2 } })
    const edited = await t.run((ctx) =>
      ctx.db
        .query('harvestForecastChecks')
        .withIndex('by_harvestRecordId', (q) => q.eq('harvestRecordId', id))
        .collect(),
    )
    expect(edited).toHaveLength(1)
    expect(edited[0].actualAbwG).toBe(actual * 2)
    expect(edited[0].errorPct).toBeLessThan(-40)
    expect(edited[0].withinBand).toBe(false)

    await as.mutation(api.harvest.remove, { id })
    const gone = await t.run((ctx) => ctx.db.query('harvestForecastChecks').collect())
    expect(gone).toEqual([])
  })

  test('no forecast to check when the cycle was not stocked 28 days before', async () => {
    const { t, as, ids } = await setup()
    const sid = await as.mutation(api.stocking.createStocking, {
      cageId: ids.N1,
      stockingDate: OPENED,
      fishCount: 1000,
      initialAbw: 10,
      initialBiomass: 10,
    })
    await as.mutation(api.stocking.approveStocking, { id: sid })
    await as.mutation(api.harvest.create, {
      cageId: ids.N1,
      harvestDate: addDays(OPENED, 10),
      averageBodyWeight: 15,
      totalWeight: 15,
      estimatedCount: 1000,
      harvestType: 'complete',
      status: 'completed',
    })
    expect(await t.run((ctx) => ctx.db.query('harvestForecastChecks').collect())).toEqual([])
  })
})
