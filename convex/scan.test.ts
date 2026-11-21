/// <reference types="vite/client" />
/**
 * Paper 54 cage card (api.scan.cageCard): batch, fish, average weight,
 * fed today, latest DO against the farm's threshold; tenant and site
 * isolation; and the date guard.
 */
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')
const TODAY = '2026-11-21'

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.UTC(2026, 10, 21, 8, 10)
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: now, timezone: 'UTC' })
    const a = await company('Lake', 'LAKE')
    const b = await company('River', 'RIVER')
    const site = await ctx.db.insert('farmLocations', { companyId: a, name: 'Akosombo', active: true, updatedAt: now })
    const site2 = await ctx.db.insert('farmLocations', { companyId: a, name: 'Kpong', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: b, name: 'B site', active: true, updatedAt: now })
    const member = async (name: string, companyId: Id<'companies'>, roleKey: string, extra: Record<string, unknown> = {}) => {
      const id = await ctx.db.insert('users', { email: `${name.toLowerCase().replace(/ /g, '')}@x.com`, name, role: 'user', companyId })
      await ctx.db.insert('memberships', { userId: id, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now, ...extra })
      return id
    }
    const owner = await member('Kofi Owner', a, 'owner')
    const kpongOnly = await member('Efua Mensah', a, 'field_staff', { allLocations: false, locationIds: [site2] })
    const ownerB = await member('Esi B', b, 'owner')
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>, extra: Record<string, unknown> = {}) =>
      ctx.db.insert('cages', {
        name, code: name, status: 'active', currentCount: 18420, currentWeight: 212,
        stockingDate: '2026-08-01', companyId, locationId, updatedAt: now, ...extra,
      })
    const c7 = await cage('C-07', a, site)
    const c8 = await cage('C-08', a, site)
    const pond = await cage('P-01', a, site, { unitType: 'pond' })
    const bUnit = await cage('B-01', b, siteB)
    await ctx.db.insert('stockingHistory', {
      cageId: c7, batchNumber: 'B-2026-07', stockingDate: '2026-08-01', fishCount: 20000, initialAbw: 10,
      initialBiomass: 200, status: 'approved', companyId: a, locationId: site,
    })
    // A closed earlier cycle in the same cage is not the current batch.
    await ctx.db.insert('stockingHistory', {
      cageId: c7, batchNumber: 'B-2025-01', stockingDate: '2025-01-01', fishCount: 1, initialAbw: 1,
      initialBiomass: 1, status: 'approved', closedAt: '2025-06-01', companyId: a, locationId: site,
    })
    await ctx.db.insert('dailyRecords', {
      cageId: c7, date: TODAY, feedAmount: 42, feedPrice: 1, feedCost: 42, mortality: 3, companyId: a, locationId: site,
    })
    const reading = (unitId: Id<'cages'>, measuredAt: number, extra: Record<string, unknown>) =>
      ctx.db.insert('waterQualityReadings', {
        companyId: a, locationId: site, unitId, measuredAt, date: TODAY, source: 'manual', ...extra,
      })
    await reading(c7, now - 3_600_000, { dissolvedOxygen: 5.2 })
    await reading(c7, now - 60_000, { dissolvedOxygen: 3.6 })
    // Newest reading has no DO: the card keeps the last DO.
    await reading(c7, now, { temperatureC: 29 })
    await reading(pond, now, { dissolvedOxygen: 3.6 })
    return { a, b, site, site2, owner, kpongOnly, ownerB, c7, c8, pond, bUnit }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}

describe('scan.cageCard', () => {
  test('batch, fish, weight, fed today and low DO for a cage', async () => {
    const s = await setup()
    const card = await s.as(s.owner).query(api.scan.cageCard, { id: s.c7, today: TODAY })
    expect(card).toMatchObject({
      name: 'C-07',
      code: 'C-07',
      batchNumber: 'B-2026-07',
      fish: 18420,
      abwG: 212,
      logged: { feedKg: 42, mortality: 3 },
      dissolvedOxygen: { value: 3.6, min: 4, low: true },
    })
  })

  test('no record today, no reading, no batch: nulls, not guesses', async () => {
    const s = await setup()
    const card = await s.as(s.owner).query(api.scan.cageCard, { id: s.c8, today: TODAY })
    expect(card).toMatchObject({ batchNumber: null, logged: null, dissolvedOxygen: null })
    const yesterday = await s.as(s.owner).query(api.scan.cageCard, { id: s.c7, today: '2026-11-20' })
    expect(yesterday?.logged).toBeNull()
  })

  test("the unit type's threshold and the farm's override decide 'low'", async () => {
    const s = await setup()
    // Ponds default to 3 mg/L: 3.6 is fine.
    const pond = await s.as(s.owner).query(api.scan.cageCard, { id: s.pond, today: TODAY })
    expect(pond?.dissolvedOxygen).toMatchObject({ value: 3.6, min: 3, low: false })
    await s.t.run((ctx) =>
      ctx.db.insert('waterQualityThresholds', {
        companyId: s.a, unitType: 'cage', parameter: 'dissolvedOxygen', min: 3, updatedAt: Date.now(),
      }),
    )
    const cage = await s.as(s.owner).query(api.scan.cageCard, { id: s.c7, today: TODAY })
    expect(cage?.dissolvedOxygen).toMatchObject({ min: 3, low: false })
  })

  test('another organization never sees the cage', async () => {
    const s = await setup()
    expect(await s.as(s.ownerB).query(api.scan.cageCard, { id: s.c7, today: TODAY })).toBeNull()
    expect(await s.as(s.owner).query(api.scan.cageCard, { id: s.bUnit, today: TODAY })).toBeNull()
  })

  test('a member limited to another site does not see the cage', async () => {
    const s = await setup()
    expect(await s.as(s.kpongOnly).query(api.scan.cageCard, { id: s.c7, today: TODAY })).toBeNull()
  })

  test('archived cages and bad dates', async () => {
    const s = await setup()
    await s.t.run((ctx) => ctx.db.patch(s.c8, { archivedAt: Date.now() }))
    expect(await s.as(s.owner).query(api.scan.cageCard, { id: s.c8, today: TODAY })).toBeNull()
    await expect(s.as(s.owner).query(api.scan.cageCard, { id: s.c7, today: '21/11/2026' })).rejects.toThrow()
  })

  test('signed out is refused', async () => {
    const s = await setup()
    await expect(s.t.query(api.scan.cageCard, { id: s.c7, today: TODAY })).rejects.toThrow()
  })
})
