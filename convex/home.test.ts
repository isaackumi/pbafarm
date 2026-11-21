/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')
const AS_OF = '2026-11-20'

const kpis = (o: { opened: string; count: number; biomass: number; feed: number; gain: number }) => ({
  opened_on: o.opened, closed_on: null, days_of_culture: 80, count: o.count, stocked_count: o.count, in_count: 0,
  out_count: 0, harvested_count: 0, harvested_kg: 0, mortality: 0, unaccounted: 0, initial_abw_g: 10,
  current_abw_g: 100, abw_measured_on: null, stocked_biomass_kg: 10, current_biomass_kg: o.biomass, gain_kg: o.gain,
  feed_kg: o.feed, feed_cost: 0, efcr: null, biological_fcr: null, survival_pct: null, mortality_pct: null,
  sgr_pct_day: null, adg_g_day: null,
})
const snap = (date: string, s: { count: number; biomassKg: number; feedKg: number; gainKg: number; mortality: number }) => ({
  date, abwG: null, feedCost: 0, stockedCount: 0, inCount: 0, outCount: 0, harvestedCount: 0, harvestedKg: 0,
  efcr: null, sgr: null, survivalPct: null, ...s,
})
const flows = {
  count: 0, stockedCount: 0, stockedKg: 0, inCount: 0, inKg: 0, outCount: 0, outKg: 0, mortalityCount: 0,
  mortalityKgEst: 0, harvestedCount: 0, harvestedKg: 0, adjustmentCount: 0, unaccountedCount: 0,
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'River', code: 'RIV', status: 'approved', createdAt: now })
    const north = await ctx.db.insert('farmLocations', { companyId, name: 'North', active: true, updatedAt: now })
    const south = await ctx.db.insert('farmLocations', { companyId, name: 'South', active: true, updatedAt: now })
    const theirSite = await ctx.db.insert('farmLocations', { companyId: other, name: 'Far', active: true, updatedAt: now })
    const member = async (email: string, company: Id<'companies'>, extra: Record<string, unknown> = {}) => {
      const userId = await ctx.db.insert('users', { email, name: email, role: 'user', companyId: company })
      await ctx.db.insert('memberships', {
        userId, companyId: company, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: now, ...extra,
      })
      return userId
    }
    const viewer = await member('v@x.com', companyId)
    const southOnly = await member('s@x.com', companyId, { allLocations: false, locationIds: [south] })
    const outsider = await member('o@x.com', other)
    const blindRole = await ctx.db.insert('roles', {
      companyId, key: 'blind', name: 'Blind', permissions: ['org.view'], archived: false, updatedAt: now,
    })
    const blind = await member('b@x.com', companyId, { roleKey: 'blind', roleId: blindRole })

    const cage = (name: string, loc: Id<'farmLocations'>, extra: Record<string, unknown> = {}) =>
      ctx.db.insert('cages', { companyId, name, status: 'active', locationId: loc, species: 'nile_tilapia', currentCount: 1000, updatedAt: now, ...extra } as any)
    const c1 = await cage('C-07', north, { netVolumeM3: 100, maxDensity: 10, currentCount: 1050 })
    const c2 = await cage('B-12', north)
    const c3 = await cage('A-03', south)
    await cage('Old', north, { archivedAt: now })
    await cage('Empty', north, { status: 'empty' })
    const theirs = await ctx.db.insert('cages', { companyId: other, name: 'X1', status: 'active', locationId: theirSite, updatedAt: now } as any)

    const occ = async (unitId: Id<'cages'>, loc: Id<'farmLocations'>, company: Id<'companies'>, biomass: number) => {
      const batchId = await ctx.db.insert('batches', {
        companyId: company, batchNumber: `B-${biomass}`, origin: 'stocking', status: 'active', openedOn: '2026-09-20', updatedAt: now,
      } as any)
      await ctx.db.insert('batchStats', {
        companyId: company, locationId: loc, unitId, batchId, batchNumber: `B-${biomass}`, open: true,
        lastDate: '9999-12-31', asOf: AS_OF,
        kpis: kpis({ opened: '2026-09-20', count: 1000, biomass, feed: biomass * 1.5, gain: biomass }),
        feedCostLedger: 0, recentSgr: null, recentSampleDate: null, recentMortality: 0,
        weekly: [
          snap('2026-09-20', { count: 1000, biomassKg: biomass / 2, feedKg: 0, gainKg: 0, mortality: 0 }),
          snap('2026-10-18', { count: 990, biomassKg: biomass * 0.8, feedKg: biomass, gainKg: biomass * 0.8, mortality: 10 }),
          snap(AS_OF, { count: 980, biomassKg: biomass, feedKg: biomass * 1.5, gainKg: biomass, mortality: 20 }),
        ],
        updatedAt: now,
      })
      return batchId
    }
    const b1 = await occ(c1, north, companyId, 1000)
    await occ(c3, south, companyId, 500)
    await occ(theirs, theirSite, other, 9000)

    const day = (unitId: Id<'cages'>, loc: Id<'farmLocations'>, company: Id<'companies'>, kg: number) =>
      ctx.db.insert('unitDailyStats', {
        companyId: company, locationId: loc, unitId, date: AS_OF, feedKg: kg, feedCostList: 0,
        feed: [{ kg, listCost: 0 }], mortalityRecorded: 0, flows, updatedAt: now,
      })
    await day(c1, north, companyId, 40)
    await day(c3, south, companyId, 20)
    await day(theirs, theirSite, other, 999)

    await ctx.db.insert('sales', { companyId, locationId: north, saleDate: '2026-11-10', weightKg: 100, pricePerKg: 30, totalAmount: 3000, updatedAt: now })
    await ctx.db.insert('sales', { companyId: other, saleDate: '2026-11-19', weightKg: 100, pricePerKg: 99, totalAmount: 9900, updatedAt: now })

    const alert = (unitId: Id<'cages'>, loc: Id<'farmLocations'>, company: Id<'companies'>, rule: any, severity: any, name: string) =>
      ctx.db.insert('farmAlerts', {
        companyId: company, locationId: loc, unitId, unitName: name, rule, severity, status: 'open', date: AS_OF,
        lastSeenDate: AS_OF, evidence: { do_mg_l: 3.1, min_mg_l: 4, days_missing: 2 }, createdAt: now, updatedAt: now,
      })
    await alert(c1, north, companyId, 'low_oxygen', 'critical', 'C-07')
    await alert(c3, south, companyId, 'missing_entries', 'warning', 'A-03')
    await alert(theirs, theirSite, other, 'low_oxygen', 'critical', 'X1')

    const feedType = await ctx.db.insert('feedTypes', { name: 'Raanan 4mm', currentStock: 0, minimumStock: 0, pricePerKg: 1, active: true, companyId, updatedAt: now } as any)
    await ctx.db.insert('stockingHistory', {
      companyId, cageId: c3, locationId: south, batchNumber: 'TL-044', stockingDate: '2026-11-16', fishCount: 12000,
      initialAbw: 30, initialBiomass: 360, status: 'approved',
    })
    await ctx.db.insert('fishTransfers', {
      companyId, sourceCageId: c2, destinationCageId: c1, sourceLocationId: north, destinationLocationId: north,
      transferDate: '2026-11-18', quantity: 4200, abw: 300, biomass: 1260, transferType: 'partial', status: 'pending_approval',
      batchId: b1, updatedAt: now,
    })
    await ctx.db.insert('harvestRecords', {
      companyId, cageId: c2, locationId: north, harvestDate: '2026-11-17', averageBodyWeight: 480, totalWeight: 4730,
      estimatedCount: 9860, fcr: 1.4,
    })
    await ctx.db.insert('harvestRecords', {
      companyId, cageId: c2, locationId: north, harvestDate: '2026-11-17', averageBodyWeight: 480, totalWeight: 1,
      estimatedCount: 1, fcr: 1.4, source: 'sampling_page',
    })
    await ctx.db.insert('feedUsage', {
      companyId, cageId: c1, locationId: north, feedTypeId: feedType, quantity: 620, usageDate: '2026-11-16', source: 'issue', updatedAt: now,
    })
    await ctx.db.insert('feedUsage', {
      companyId, cageId: c1, locationId: north, feedTypeId: feedType, quantity: 5, usageDate: '2026-11-19', source: 'daily', updatedAt: now,
    })
    await ctx.db.insert('stockingHistory', {
      companyId: other, cageId: theirs, batchNumber: 'THEIRS', stockingDate: '2026-11-19', fishCount: 1, initialAbw: 1, initialBiomass: 1, status: 'approved',
    })
    return { companyId, other, north, south, theirSite, viewer, southOnly, outsider, blind, c1, c2, c3 }
  })
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

describe('home.overview (Paper 01 biomass card and KPI strip)', () => {
  test('biomass, change, value, cycle day and the KPI strip over the whole farm', async () => {
    const { as, viewer } = await setup()
    const r = (await as(viewer).query(api.home.overview, { asOf: AS_OF, range: '90d' }))!
    expect(r.biomassKg).toBe(1500)
    // 30 days before: the 2026-10-18 snapshots, 800 + 400
    expect(r.changePct).toBeCloseTo(25)
    expect(r.estValue).toBe(1500 * 30)
    expect(r.cycleDay).toBe(62)
    expect(r.activeCages).toBe(3)
    expect(r.totalCages).toBe(4)
    expect(r.feedTodayKg).toBe(60)
    expect(r.loggedToday).toBe(2)
    expect(r.fcr).toBeCloseTo(2250 / 1500)
    expect(r.series[r.series.length - 1]).toEqual({ date: AS_OF, kg: 1500 })
    expect(r.series[0].date).toBe('2026-08-22')
  })

  test('a site filter and a site-limited member see only their site', async () => {
    const { as, viewer, southOnly, south, north } = await setup()
    const one = (await as(viewer).query(api.home.overview, { asOf: AS_OF, range: '30d', locationId: south }))!
    expect(one.biomassKg).toBe(500)
    expect(one.feedTodayKg).toBe(20)
    const scoped = (await as(southOnly).query(api.home.overview, { asOf: AS_OF, range: 'cycle' }))!
    expect(scoped.biomassKg).toBe(500)
    expect(scoped.activeCages).toBe(1)
    // The sale is at North: no price in scope.
    expect(scoped.estValue).toBeNull()
    await expect(as(southOnly).query(api.home.overview, { asOf: AS_OF, range: '30d', locationId: north })).rejects.toThrow()
  })

  test('never another company', async () => {
    const { as, outsider, viewer, theirSite } = await setup()
    const r = (await as(outsider).query(api.home.overview, { asOf: AS_OF, range: '30d' }))!
    expect(r.biomassKg).toBe(9000)
    expect(r.estValue).toBe(9000 * 99)
    await expect(as(viewer).query(api.home.overview, { asOf: AS_OF, range: '30d', locationId: theirSite })).rejects.toThrow(/not found/i)
  })

  test('needs reports.view and a sign-in', async () => {
    const { t, as, blind } = await setup()
    await expect(as(blind).query(api.home.overview, { asOf: AS_OF, range: '30d' })).rejects.toThrow(/permission/i)
    await expect(t.query(api.home.overview, { asOf: AS_OF, range: '30d' })).rejects.toThrow()
  })
})

describe('home.attention (Paper 01 "Needs attention")', () => {
  test('alerts and density, one row per cage, most urgent first, with the action', async () => {
    const { as, viewer, c1, c3 } = await setup()
    const r = await as(viewer).query(api.home.attention, {})
    expect(r.total).toBe(2)
    expect(r.rows.map((x) => [x.unitId, x.reason, x.kind, x.tone])).toEqual([
      [c1, 'low_oxygen', 'water', 'alert'],
      [c3, 'missing_entries', 'entry', 'warn'],
    ])
    expect(r.rows[0]).toMatchObject({ unitName: 'C-07', species: 'nile_tilapia', unitType: 'cage' })
  })

  test('density shows when no alert covers the cage', async () => {
    const { t, as, viewer, c1 } = await setup()
    await t.run(async (ctx) => {
      for (const a of await ctx.db.query('farmAlerts').take(10)) if (a.unitId === c1) await ctx.db.delete(a._id)
    })
    const r = await as(viewer).query(api.home.attention, { limit: 5 })
    const row = r.rows.find((x) => x.unitId === c1)!
    expect(row).toMatchObject({ reason: 'density', kind: 'density', tone: 'alert' })
    expect(row.evidence).toMatchObject({ density: 10.5, max: 10, unit: 'fish/m³' })
  })

  test('site scope, tenant isolation and permission', async () => {
    const { as, southOnly, outsider, blind, c3 } = await setup()
    const scoped = await as(southOnly).query(api.home.attention, {})
    expect(scoped.rows.map((x) => x.unitId)).toEqual([c3])
    const theirs = await as(outsider).query(api.home.attention, {})
    expect(theirs.rows.map((x) => x.unitName)).toEqual(['X1'])
    await expect(as(blind).query(api.home.attention, {})).rejects.toThrow(/permission/i)
  })
})

describe('home.activity (Paper 01 "Farm activity")', () => {
  test('every type, newest first, in the artboard format', async () => {
    const { as, viewer } = await setup()
    const rows = await as(viewer).query(api.home.activity, {})
    expect(rows.map((r) => [r.date, r.type, r.unit, r.batch, r.fish, r.biomassKg, r.status])).toEqual([
      ['2026-11-18', 'transfer', 'B-12 → C-07', 'B-1000', 4200, 1260, 'pending_approval'],
      ['2026-11-17', 'harvest', 'B-12', null, 9860, 4730, 'completed'],
      ['2026-11-16', 'feed', 'C-07', 'Raanan 4mm', null, 620, 'completed'],
      ['2026-11-16', 'stocking', 'A-03', 'TL-044', 12000, 360, 'approved'],
    ])
  })

  test('type filter and search', async () => {
    const { as, viewer } = await setup()
    expect((await as(viewer).query(api.home.activity, { type: 'feed' })).map((r) => r.type)).toEqual(['feed'])
    expect((await as(viewer).query(api.home.activity, { search: 'tl-0' })).map((r) => r.batch)).toEqual(['TL-044'])
    expect(await as(viewer).query(api.home.activity, { search: 'nothing here' })).toEqual([])
  })

  test('site scope, tenant isolation and permission', async () => {
    const { as, southOnly, outsider, blind } = await setup()
    expect((await as(southOnly).query(api.home.activity, {})).map((r) => r.unit)).toEqual(['A-03'])
    expect((await as(outsider).query(api.home.activity, {})).map((r) => r.batch)).toEqual(['THEIRS'])
    await expect(as(blind).query(api.home.activity, {})).rejects.toThrow(/permission/i)
  })
})
