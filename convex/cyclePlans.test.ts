/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const inputs = {
  stockOn: '2026-03-02',
  fishPerUnit: 20_000,
  stockAbwG: 5,
  harvestAbwG: 400,
  feedPricePerBag: 375,
  bagKg: 25,
  salePricePerKg: 38,
  fingerlingPrice: 0.6,
}
const assumptions = {
  speciesKey: 'nile_tilapia',
  survivalPct: 86,
  fcr: 1.42,
  tgc: 1.112,
  tempC: 28,
  monthlyTempC: null,
  sources: { survival: 'history' as const, fcr: 'history' as const, growth: 'edited' as const },
  cycles: 3,
}

function kpis(k: { opened: string; closed: string; days: number; stocked: number; harvested: number; harvestedKg: number; survival: number; feedKg: number; gainKg: number }) {
  return {
    opened_on: k.opened,
    closed_on: k.closed,
    days_of_culture: k.days,
    count: 0,
    stocked_count: k.stocked,
    in_count: 0,
    out_count: 0,
    harvested_count: k.harvested,
    harvested_kg: k.harvestedKg,
    mortality: k.stocked - k.harvested,
    unaccounted: 0,
    initial_abw_g: 5,
    current_abw_g: null,
    abw_measured_on: null,
    stocked_biomass_kg: (k.stocked * 5) / 1000,
    current_biomass_kg: 0,
    gain_kg: k.gainKg,
    feed_kg: k.feedKg,
    feed_cost: 0,
    efcr: k.feedKg / k.gainKg,
    biological_fcr: null,
    survival_pct: k.survival,
    mortality_pct: 100 - k.survival,
    sgr_pct_day: null,
    adg_g_day: null,
  }
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'River', code: 'RIV', status: 'approved', createdAt: now })
    const site = await ctx.db.insert('farmLocations', { companyId, name: 'Akosombo', active: true, updatedAt: now } as any)
    const site2 = await ctx.db.insert('farmLocations', { companyId, name: 'South', active: true, updatedAt: now } as any)
    const owner = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId })
    const manager = await ctx.db.insert('users', { email: 'm@x.com', role: 'user', companyId })
    await ctx.db.insert('memberships', { userId: manager, companyId, roleKey: 'manager', allLocations: true, status: 'active', updatedAt: now })
    const staff = await ctx.db.insert('users', { email: 'f@x.com', role: 'user', companyId })
    await ctx.db.insert('memberships', { userId: staff, companyId, roleKey: 'field_staff', allLocations: true, status: 'active', updatedAt: now })
    const viewer = await ctx.db.insert('users', { email: 'v@x.com', role: 'user', companyId })
    await ctx.db.insert('memberships', { userId: viewer, companyId, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: now })
    const southManager = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId, locationIds: [site2] } as any)
    await ctx.db.insert('memberships', { userId: southManager, companyId, roleKey: 'manager', allLocations: false, locationIds: [site2], status: 'active', updatedAt: now })
    const outsider = await ctx.db.insert('users', { email: 'x@x.com', role: 'admin', companyId: other })
    const cage = (name: string, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', { companyId, name, status: 'active', species: 'nile_tilapia', locationId, updatedAt: now } as any)
    const a1 = await cage('A1', site)
    const a2 = await cage('A2', site)
    const fresh = await cage('New', site2)
    const theirs = await ctx.db.insert('cages', { companyId: other, name: 'X1', status: 'active', updatedAt: now } as any)

    // Three closed cycles in A1/A2 (and an older one that is not used), all 5 g → 400 g in 182 days.
    const cycle = async (unitId: Id<'cages'>, n: string, opened: string, closed: string, survival: number, feedKg: number) => {
      const batchId = await ctx.db.insert('batches', { companyId, batchNumber: n, origin: 'stocking', status: 'closed', openedOn: opened, closedOn: closed, updatedAt: now } as any)
      await ctx.db.insert('batchStats', {
        companyId,
        locationId: site,
        unitId,
        batchId,
        batchNumber: n,
        speciesCode: 'nile_tilapia',
        open: false,
        lastDate: closed,
        asOf: closed,
        kpis: kpis({ opened, closed, days: 182, stocked: 20_000, harvested: Math.round(200 * survival), harvestedKg: Math.round(200 * survival) * 0.4, survival, feedKg, gainKg: 1000 }),
        feedCostLedger: 0,
        recentSgr: null,
        recentSampleDate: null,
        recentMortality: 0,
        weekly: [],
        updatedAt: now,
      })
    }
    await cycle(a1, 'B-1', '2024-01-02', '2024-07-02', 50, 2000)
    await cycle(a1, 'B-2', '2025-01-02', '2025-07-03', 84, 1400)
    await cycle(a2, 'B-3', '2025-03-02', '2025-08-31', 86, 1420)
    await cycle(a2, 'B-4', '2025-06-02', '2025-12-01', 88, 1440)
    return { companyId, site, site2, owner, manager, staff, viewer, southManager, outsider, a1, a2, fresh, theirs }
  })
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

describe('cycle planner assumptions', () => {
  test('the last three closed cycles in the units, labelled as history', async () => {
    const { as, manager, a1, a2 } = await setup()
    const r = await as(manager).query(api.cyclePlans.assumptions, { unitIds: [a1, a2], asOf: '2026-11-20' })
    expect(r).toMatchObject({ speciesKey: 'nile_tilapia', siteName: 'Akosombo', units: 2 })
    expect(r!.cycles.map((c) => c.batchNumber)).toEqual(['B-4', 'B-3', 'B-2'])
    expect(r!.assumptions.sources).toEqual({ survival: 'history', fcr: 'history', growth: 'history' })
    expect(r!.assumptions.cycles).toBe(3)
    expect(r!.assumptions.survivalPct).toBe(86)
    expect(r!.assumptions.fcr).toBe(1.42) // pooled: 4,260 kg feed ÷ 3,000 kg gain
    expect(r!.assumptions.tgc).toBeGreaterThan(1)
  })

  test('no closed cycles: species defaults, labelled as defaults', async () => {
    const { as, manager, fresh } = await setup()
    const r = await as(manager).query(api.cyclePlans.assumptions, { unitIds: [fresh], asOf: '2026-11-20' })
    expect(r!.cycles).toEqual([])
    expect(r!.assumptions).toMatchObject({
      survivalPct: 85,
      fcr: 1.6,
      tempC: 28,
      cycles: 0,
      sources: { survival: 'default', fcr: 'default', growth: 'default' },
    })
  })

  test('other companies\' units and units outside the caller\'s sites are ignored', async () => {
    const { as, manager, outsider, southManager, a1, theirs } = await setup()
    expect(await as(manager).query(api.cyclePlans.assumptions, { unitIds: [theirs], asOf: '2026-11-20' })).toBeNull()
    expect(await as(outsider).query(api.cyclePlans.assumptions, { unitIds: [a1], asOf: '2026-11-20' })).toBeNull()
    expect(await as(southManager).query(api.cyclePlans.assumptions, { unitIds: [a1], asOf: '2026-11-20' })).toBeNull()
  })
})

describe('saved cycle plans', () => {
  test('owners and managers save, list and delete; field staff and viewers cannot', async () => {
    const { as, owner, manager, staff, viewer, a1, a2 } = await setup()
    for (const who of [staff, viewer]) {
      await expect(as(who).query(api.cyclePlans.list, {})).rejects.toThrow(/Insufficient permissions/)
      await expect(
        as(who).mutation(api.cyclePlans.save, { name: 'A', unitIds: [a1], inputs, assumptions }),
      ).rejects.toThrow(/Insufficient permissions/)
    }
    const id = await as(manager).mutation(api.cyclePlans.save, { name: ' A · Row A spring ', unitIds: [a1, a2, a1], inputs, assumptions })
    const list = await as(owner).query(api.cyclePlans.list, {})
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'A · Row A spring', units: [{ name: 'A1' }, { name: 'A2' }] })
    expect(list[0].locationId).not.toBeNull()

    await as(owner).mutation(api.cyclePlans.save, { planId: id, name: 'A', unitIds: [a1], inputs: { ...inputs, harvestAbwG: 300 }, assumptions })
    expect((await as(manager).query(api.cyclePlans.get, { planId: id }))?.inputs.harvestAbwG).toBe(300)

    await expect(as(viewer).mutation(api.cyclePlans.remove, { planId: id })).rejects.toThrow(/Insufficient permissions/)
    await as(manager).mutation(api.cyclePlans.remove, { planId: id })
    expect(await as(owner).query(api.cyclePlans.list, {})).toEqual([])
  })

  test('bad inputs are refused with the field named', async () => {
    const { as, manager, a1 } = await setup()
    await expect(as(manager).mutation(api.cyclePlans.save, { name: ' ', unitIds: [a1], inputs, assumptions })).rejects.toThrow(/name/)
    await expect(as(manager).mutation(api.cyclePlans.save, { name: 'A', unitIds: [], inputs, assumptions })).rejects.toThrow(/at least one unit/)
    await expect(
      as(manager).mutation(api.cyclePlans.save, { name: 'A', unitIds: [a1], inputs: { ...inputs, harvestAbwG: 2 }, assumptions }),
    ).rejects.toThrow(/harvestAbwG/)
    await expect(
      as(manager).mutation(api.cyclePlans.save, { name: 'A', unitIds: [a1], inputs, assumptions: { ...assumptions, fcr: 0 } }),
    ).rejects.toThrow(/fcr/)
  })

  test('another organization can neither use our units nor read, edit or delete our plans', async () => {
    const { as, manager, outsider, southManager, a1, theirs } = await setup()
    await expect(as(manager).mutation(api.cyclePlans.save, { name: 'X', unitIds: [theirs], inputs, assumptions })).rejects.toThrow(/Unit not found/)
    const id = await as(manager).mutation(api.cyclePlans.save, { name: 'A', unitIds: [a1], inputs, assumptions })

    expect(await as(outsider).query(api.cyclePlans.list, {})).toEqual([])
    expect(await as(outsider).query(api.cyclePlans.get, { planId: id })).toBeNull()
    await expect(as(outsider).mutation(api.cyclePlans.remove, { planId: id })).rejects.toThrow(/Plan not found/)
    await expect(
      as(outsider).mutation(api.cyclePlans.save, { planId: id, name: 'Mine', unitIds: [a1], inputs, assumptions }),
    ).rejects.toThrow(/Unit not found|Plan not found/)
    await expect(as(outsider).mutation(api.cyclePlans.save, { name: 'Mine', unitIds: [a1], inputs, assumptions })).rejects.toThrow(/Unit not found/)

    // A manager limited to another site does not see a plan for Akosombo units.
    expect(await as(southManager).query(api.cyclePlans.list, {})).toEqual([])
    expect(await as(southManager).query(api.cyclePlans.get, { planId: id })).toBeNull()
    await expect(as(southManager).mutation(api.cyclePlans.remove, { planId: id })).rejects.toThrow(/Plan not found/)
    expect(await as(manager).query(api.cyclePlans.get, { planId: id })).not.toBeNull()
  })
})
