/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { DEFAULT_FEED_TABLES, bandFor, bandProblems, rationFor } from './lib/ration'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'River', code: 'RIV', status: 'approved', createdAt: now })
    const admin = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const viewer = await ctx.db.insert('users', { email: 'v@x.com', role: 'user', companyId })
    await ctx.db.insert('memberships', { userId: viewer, companyId, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: now })
    const outsider = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: other })
    const site = await ctx.db.insert('farmLocations', { companyId, name: 'North', active: true, updatedAt: now } as any)
    const site2 = await ctx.db.insert('farmLocations', { companyId, name: 'South', active: true, updatedAt: now } as any)
    const scoped = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    await ctx.db.insert('memberships', { userId: scoped, companyId, roleKey: 'viewer', allLocations: false, locationIds: [site2], status: 'active', updatedAt: now })
    const cage = (name: string, extra: Record<string, unknown>) =>
      ctx.db.insert('cages', { companyId, name, status: 'active', locationId: site, updatedAt: now, ...extra } as any)
    const c1 = await cage('C1', { species: 'nile_tilapia', currentCount: 10_000, currentWeight: 120 })
    const c2 = await cage('C2', { species: 'african_catfish', currentCount: 2_000, initialAbw: 30 })
    const c3 = await cage('C3', { species: 'carp', currentCount: 500, currentWeight: 50 })
    const c4 = await cage('C4', { species: 'nile_tilapia', currentCount: 0, currentWeight: 50 })
    await cage('Old', { species: 'nile_tilapia', currentCount: 100, currentWeight: 50, archivedAt: now })
    await cage('Done', { species: 'nile_tilapia', currentCount: 100, currentWeight: 50, status: 'harvested' })
    const theirs = await ctx.db.insert('cages', {
      companyId: other, name: 'X1', status: 'active', species: 'nile_tilapia', currentCount: 1000, currentWeight: 100, updatedAt: now,
    } as any)
    return { companyId, other, admin, viewer, outsider, scoped, site, site2, c1, c2, c3, c4, theirs }
  })
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

describe('ration maths (PROD-015)', () => {
  const tilapia = DEFAULT_FEED_TABLES.nile_tilapia.bands

  test('built-in tables are valid and bands are picked by ABW', () => {
    for (const t of Object.values(DEFAULT_FEED_TABLES)) expect(bandProblems(t.bands)).toEqual([])
    expect(bandFor(tilapia, 3)?.index).toBe(0)
    expect(bandFor(tilapia, 100)?.band.minAbwG).toBe(100)
    expect(bandFor(tilapia, 99.9)?.band.minAbwG).toBe(50)
    expect(bandFor(tilapia, 5000)?.maxAbwG).toBeNull()
  })

  test('kg/day = count × ABW × %BW, split over the day\'s feedings', () => {
    const r = rationFor({ count: 10_000, abwG: 120, bands: tilapia })
    expect(r).toMatchObject({ ok: true, biomassKg: 1200, kgPerDay: 30, feedingsPerDay: 3, kgPerFeeding: 10, pelletMm: 4 })
    expect(rationFor({ count: 0, abwG: 120, bands: tilapia })).toEqual({ ok: false, reason: 'no_fish' })
    expect(rationFor({ count: 10, abwG: null, bands: tilapia })).toEqual({ ok: false, reason: 'no_abw' })
    expect(rationFor({ count: 10, abwG: 10, bands: null })).toEqual({ ok: false, reason: 'no_plan' })
  })

  test('tables must start at 0, rise, and stay within limits', () => {
    expect(bandProblems([])).not.toEqual([])
    expect(bandProblems([{ minAbwG: 5, bodyWeightPct: 3, feedingsPerDay: 2, pelletMm: 2 }]).join()).toMatch(/0 g/)
    expect(bandProblems([
      { minAbwG: 0, bodyWeightPct: 3, feedingsPerDay: 2, pelletMm: 2 },
      { minAbwG: 0, bodyWeightPct: 2, feedingsPerDay: 2, pelletMm: 2 },
    ])).not.toEqual([])
    expect(bandProblems([{ minAbwG: 0, bodyWeightPct: 50, feedingsPerDay: 2, pelletMm: 2 }])).not.toEqual([])
    expect(bandProblems([{ minAbwG: 0, bodyWeightPct: 3, feedingsPerDay: 0, pelletMm: 2 }])).not.toEqual([])
  })
})

describe('feeding plan functions', () => {
  test('rations use the default tables, honour site scope and never cross companies', async () => {
    const { as, viewer, outsider, scoped, c1, c2, c3, c4, theirs, site } = await setup()
    const r = await as(viewer).query(api.feedingPlans.rations, {})
    expect(r.rows.map((x: any) => x.cageName)).toEqual(['C1', 'C2', 'C3', 'C4'])
    const by = Object.fromEntries(r.rows.map((x: any) => [x.cageId, x.ration]))
    expect(by[c1]).toMatchObject({ ok: true, kgPerDay: 30 })
    expect(by[c2]).toMatchObject({ ok: true, kgPerDay: 3, pelletMm: 2 }) // 60 kg × 5 %
    expect(by[c3]).toEqual({ ok: false, reason: 'no_plan' })
    expect(by[c4]).toEqual({ ok: false, reason: 'no_fish' })
    expect(r).toMatchObject({ totalKgPerDay: 33, planned: 2, unplanned: 2 })
    expect((await as(viewer).query(api.feedingPlans.rations, { locationId: site })).rows).toHaveLength(4)

    // A user limited to another site sees none of these units.
    expect((await as(scoped).query(api.feedingPlans.rations, {})).rows).toEqual([])
    expect(await as(scoped).query(api.feedingPlans.rationForCage, { cageId: c1 })).toBeNull()

    // Wrong company: neither the list nor the single-unit query leaks.
    const theirRows = await as(outsider).query(api.feedingPlans.rations, {})
    expect(theirRows.rows.map((x: any) => x.cageName)).toEqual(['X1'])
    expect(await as(outsider).query(api.feedingPlans.rationForCage, { cageId: c1 })).toBeNull()
    expect(await as(viewer).query(api.feedingPlans.rationForCage, { cageId: theirs })).toBeNull()
    expect((await as(viewer).query(api.feedingPlans.rationForCage, { cageId: c1 }))?.ration).toMatchObject({ kgPerDay: 30 })
  })

  test('admins override a species table; viewers cannot; overrides stay in their company', async () => {
    const { as, admin, viewer, outsider, c1, c3 } = await setup()
    const flat = [{ minAbwG: 0, bodyWeightPct: 2, feedingsPerDay: 2, pelletMm: 3 }]
    await expect(as(viewer).mutation(api.feedingPlans.save, { speciesKey: 'carp', name: 'Carp', bands: flat })).rejects.toThrow(/FORBIDDEN|Insufficient/)
    await expect(as(admin).mutation(api.feedingPlans.save, { speciesKey: 'Carp!', name: 'Carp', bands: flat })).rejects.toThrow(/species/)
    await expect(
      as(admin).mutation(api.feedingPlans.save, { speciesKey: 'carp', name: 'Carp', bands: [{ ...flat[0], minAbwG: 10 }] }),
    ).rejects.toThrow()

    await as(admin).mutation(api.feedingPlans.save, { speciesKey: 'carp', name: ' Carp ', bands: flat })
    await as(admin).mutation(api.feedingPlans.save, { speciesKey: 'nile_tilapia', name: 'Ours', bands: flat })
    const list = await as(viewer).query(api.feedingPlans.list, {})
    expect(list.find((p: any) => p.speciesKey === 'carp')).toMatchObject({ source: 'saved', name: 'Carp' })
    expect(list.find((p: any) => p.speciesKey === 'african_catfish')).toMatchObject({ source: 'default' })
    const r = await as(viewer).query(api.feedingPlans.rationForCage, { cageId: c3 })
    expect(r?.ration).toMatchObject({ ok: true, kgPerDay: 0.5 }) // 25 kg × 2 %
    expect((await as(viewer).query(api.feedingPlans.rationForCage, { cageId: c1 }))?.ration).toMatchObject({ kgPerDay: 24 })

    // Wrong company: the outsider still sees the built-in defaults, and cannot reset ours.
    const theirs = await as(outsider).query(api.feedingPlans.list, {})
    expect(theirs.find((p: any) => p.speciesKey === 'nile_tilapia')).toMatchObject({ source: 'default' })
    expect(theirs.find((p: any) => p.speciesKey === 'carp')).toBeUndefined()
    await as(outsider).mutation(api.feedingPlans.reset, { speciesKey: 'nile_tilapia' })
    expect((await as(viewer).query(api.feedingPlans.rationForCage, { cageId: c1 }))?.ration).toMatchObject({ kgPerDay: 24 })

    await expect(as(viewer).mutation(api.feedingPlans.reset, { speciesKey: 'nile_tilapia' })).rejects.toThrow(/FORBIDDEN|Insufficient/)
    await as(admin).mutation(api.feedingPlans.reset, { speciesKey: 'nile_tilapia' })
    expect((await as(viewer).query(api.feedingPlans.rationForCage, { cageId: c1 }))?.ration).toMatchObject({ kgPerDay: 30 })
  })
})
