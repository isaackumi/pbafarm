/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { addDays, daysBetween, isBusinessDate, todayIn, zoneFor } from './lib/dates'
import { DEFAULT_SETTINGS, densityExcess, unitTypeOf } from './lib/farmRules'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** 2026-11-18 20:30 UTC = 23:30 in Nairobi (UTC+3), 09:30 next day in Auckland (UTC+13). */
const T_2030Z = Date.UTC(2026, 10, 18, 20, 30)
/** 2026-11-18 21:30 UTC = 00:30 on the 19th in Nairobi. */
const T_2130Z = Date.UTC(2026, 10, 18, 21, 30)

describe('business dates', () => {
  test('an entry at 23:30 local in UTC+3 lands on the local date; 00:30 is the next day', () => {
    expect(todayIn('Africa/Nairobi', T_2030Z)).toBe('2026-11-18')
    expect(todayIn('Africa/Nairobi', T_2130Z)).toBe('2026-11-19')
    expect(todayIn('UTC', T_2130Z)).toBe('2026-11-18')
    expect(todayIn('Africa/Accra', T_2130Z)).toBe('2026-11-18')
  })

  test('an unknown zone falls back to UTC; site zone wins over the company', () => {
    expect(todayIn('Mars/Base', T_2130Z)).toBe('2026-11-18')
    expect(zoneFor({ timezone: 'Africa/Nairobi' }, { timezone: 'UTC' } as any)).toBe('Africa/Nairobi')
    expect(zoneFor({}, { timezone: 'Africa/Lagos' } as any)).toBe('Africa/Lagos')
    expect(zoneFor(null, null)).toBe('Africa/Accra')
  })

  test('one day-count convention and real-date checks', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-11-18', '2026-11-17')).toBe(0)
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(isBusinessDate('2026-02-30')).toBe(false)
    expect(isBusinessDate('2026-2-3')).toBe(false)
    expect(isBusinessDate('2026-02-28')).toBe(true)
  })
})

describe('unit types', () => {
  test('rows without unitType are cages; ponds use area, others volume', () => {
    expect(unitTypeOf({})).toBe('cage')
    expect(unitTypeOf({ unitType: 'pond' })).toBe('pond')
    const rules = { ...DEFAULT_SETTINGS.farmRules, maxDensityFishPerM3: 80, maxDensityFishPerM2: 5 }
    // Pond: 1000 m² × 5/m² = 5000 fish allowed, whatever its volume.
    expect(densityExcess({ unitType: 'pond', areaM2: 1000, size: 10 }, 5000, rules)).toBeNull()
    expect(densityExcess({ unitType: 'pond', areaM2: 1000 }, 6000, rules)).toMatchObject({ unit: 'fish/m²', max: 5 })
    // Tank: volumeM3 wins over legacy size.
    expect(densityExcess({ unitType: 'tank', volumeM3: 10, size: 1000 }, 900, rules)).toMatchObject({ unit: 'fish/m³' })
    // Legacy cage: size in m³.
    expect(densityExcess({ size: 100 }, 8000, rules)).toBeNull()
    expect(densityExcess({ size: 100 }, 8001, rules)).toMatchObject({ unit: 'fish/m³' })
    // No geometry: nothing to check.
    expect(densityExcess({ unitType: 'pond' }, 1e9, rules)).toBeNull()
  })
})

async function setup(siteZone?: string) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
    })
    const siteA = await ctx.db.insert('farmLocations', {
      companyId, name: 'Site A', active: true, updatedAt: now, ...(siteZone ? { timezone: siteZone } : {}),
    })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'Site B', active: true, updatedAt: now })
    const adminId = await ctx.db.insert('users', {
      email: 'a@x.com', role: 'admin', companyId, activeLocationId: siteA,
    })
    const cageA = await ctx.db.insert('cages', {
      name: 'A1', status: 'active', companyId, locationId: siteA, updatedAt: now,
    })
    const cageB = await ctx.db.insert('cages', {
      name: 'B1', status: 'active', companyId, locationId: siteB, updatedAt: now,
    })
    return { companyId, siteA, siteB, adminId, cageA, cageB }
  })
  const as = t.withIdentity({ subject: `${ids.adminId}|s` })
  return { t, as, ...ids }
}

const daily = (cageId: any, date: string) => ({
  cageId, date, feedAmount: 0, feedPrice: 0, feedCost: 0, mortality: 0,
})

describe('site time zone drives "today"', () => {
  test('a site ahead of UTC can log its local today; tomorrow is refused', async () => {
    vi.setSystemTime(T_2130Z)
    const { as, cageA, cageB } = await setup('Africa/Nairobi')
    // Nairobi is already on the 19th.
    await expect(as.mutation(api.dailyRecords.create, daily(cageA, '2026-11-19'))).resolves.toBeTruthy()
    await expect(as.mutation(api.dailyRecords.create, daily(cageA, '2026-11-20'))).rejects.toThrow(/in the future for this site/)
    // Site B has no zone: company default (Accra, UTC+0) is still on the 18th.
    await expect(as.mutation(api.dailyRecords.create, daily(cageB, '2026-11-19'))).rejects.toThrow(/today is 2026-11-18/)
    await expect(as.mutation(api.dailyRecords.create, daily(cageB, 'not-a-date'))).rejects.toThrow(/real date/)
  })

  test('reminders use each site\'s local date', async () => {
    vi.setSystemTime(T_2130Z)
    const { t, companyId, cageA, adminId } = await setup('Africa/Nairobi')
    // A1 is logged for Nairobi's today (the 19th); B1 (Accra) is not logged for the 18th.
    await t.run((ctx) =>
      ctx.db.insert('dailyRecords', {
        cageId: cageA, date: '2026-11-19', feedAmount: 1, feedPrice: 0, feedCost: 0, mortality: 0, companyId,
      } as any),
    )
    const r = await t.mutation(internal.reminders.companyDigest, { companyId })
    expect(r.missingCages).toBe(1)
    const notes = await t.run((ctx) =>
      ctx.db.query('notifications').withIndex('by_user', (q) => q.eq('userId', adminId)).collect(),
    )
    expect(notes[0].message).toContain('B1')
    expect(notes[0].message).not.toContain('A1')
  })
})

describe('sites and production units', () => {
  test('site metadata is validated and returned', async () => {
    const { as, siteA } = await setup()
    await expect(as.mutation(api.farmLocations.update, { id: siteA, patch: { timezone: 'Mars/Base' } })).rejects.toThrow(/Unknown time zone/)
    await expect(as.mutation(api.farmLocations.update, { id: siteA, patch: { latitude: 120 } })).rejects.toThrow(/Latitude/)
    await as.mutation(api.farmLocations.update, {
      id: siteA,
      patch: { siteType: 'pond_farm', timezone: 'Africa/Accra', latitude: 6.1, longitude: 0.05, waterBody: 'Volta Lake' },
    })
    const sites = await as.query(api.farmLocations.list, {})
    expect(sites.find((s: any) => s.id === siteA)).toMatchObject({
      siteType: 'pond_farm', timezone: 'Africa/Accra', latitude: 6.1, longitude: 0.05, waterBody: 'Volta Lake',
    })
    // Clearing the zone falls back to the company's.
    await as.mutation(api.farmLocations.update, { id: siteA, patch: { timezone: '', latitude: null } })
    expect((await as.query(api.farmLocations.list, {})).find((s: any) => s.id === siteA)).toMatchObject({ timezone: null, latitude: null })
  })

  test('a pond can be created and reads back as a pond; legacy cages read as cages', async () => {
    const { as, siteA } = await setup()
    const id = await as.mutation(api.cages.create, {
      name: 'P1', locationId: siteA, unitType: 'pond', areaM2: 1200, depthM: 1.5, unitGroup: ' Block A ',
    })
    const units = await as.query(api.cages.list, {})
    expect(units.find((u: any) => u.id === id)).toMatchObject({ unitType: 'pond', areaM2: 1200, depthM: 1.5, unitGroup: 'Block A' })
    expect(units.find((u: any) => u.name === 'A1')).toMatchObject({ unitType: 'cage' })
    await expect(as.mutation(api.cages.create, { name: 'T1', unitType: 'tank', volumeM3: -2 })).rejects.toThrow(/positive/)
    // A tank's volume also sets size, which density checks read.
    const tank = await as.mutation(api.cages.create, { name: 'T2', unitType: 'tank', volumeM3: 12 })
    expect((await as.query(api.cages.list, {})).find((u: any) => u.id === tank)).toMatchObject({ size: 12, volumeM3: 12 })
  })

  test('M4 backfill marks legacy units as cages and copies size to volume (dry run first)', async () => {
    const { t, cageA } = await setup()
    await t.run((ctx) => ctx.db.patch(cageA, { size: 50 }))
    const dry = await t.mutation(internal.migrations.m4BackfillUnitTypes, {})
    expect(dry).toMatchObject({ dryRun: true, count: 2 })
    expect((await t.run((ctx) => ctx.db.get(cageA)))?.unitType).toBeUndefined()
    await t.mutation(internal.migrations.m4BackfillUnitTypes, { dryRun: false })
    expect(await t.run((ctx) => ctx.db.get(cageA))).toMatchObject({ unitType: 'cage', volumeM3: 50 })
    expect(await t.mutation(internal.migrations.m4BackfillUnitTypes, { dryRun: false })).toMatchObject({ count: 0 })
  })
})

describe('site filter on inventory and export (FARM-003)', () => {
  test('export and transactions honour the site; alerts use site stock', async () => {
    vi.setSystemTime(T_2030Z)
    const { t, as, companyId, siteA, siteB, cageA, cageB } = await setup()
    await as.mutation(api.dailyRecords.create, daily(cageA, '2026-11-18'))
    await as.mutation(api.dailyRecords.create, daily(cageB, '2026-11-18'))
    const all = await as.query(api.reports.exportBundle, { dateFrom: '2026-11-01', dateTo: '2026-11-30' })
    const a = await as.query(api.reports.exportBundle, { dateFrom: '2026-11-01', dateTo: '2026-11-30', locationId: siteA })
    expect(all.daily_records).toHaveLength(2)
    expect(a.daily_records.map((r: any) => r.cage_id)).toEqual([cageA])

    const feedTypeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('feedTypes', {
        name: 'Grower', currentStock: 1000, minimumStock: 500, pricePerKg: 10, active: true, companyId, updatedAt: Date.now(),
      } as any)
      await ctx.db.insert('feedInventory', {
        feedTypeId: id, quantityKg: 900, companyId, locationId: siteB, updatedAt: Date.now(),
      } as any)
      await ctx.db.insert('feedInventory', {
        feedTypeId: id, quantityKg: 100, companyId, locationId: siteA, updatedAt: Date.now(),
      } as any)
      await ctx.db.insert('feedInventoryTransactions', {
        feedTypeId: id, transactionType: 'purchase', quantityKg: 900, transactionDate: Date.now(), companyId, locationId: siteB,
      } as any)
      return id
    })
    expect(await as.query(api.inventory.listAlerts, {})).toEqual([])
    const alertsA = await as.query(api.inventory.listAlerts, { locationId: siteA })
    expect(alertsA).toHaveLength(1)
    expect(alertsA[0]).toMatchObject({ feed_type_id: feedTypeId })
    expect(await as.query(api.inventory.listTransactions, { locationId: siteA })).toEqual([])
    expect(await as.query(api.inventory.listTransactions, { locationId: siteB })).toHaveLength(1)
  })
})
