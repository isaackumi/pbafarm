/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { breachSummary, checkValues, effectiveThresholds, evaluateBreaches } from './lib/waterQuality'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
    } as any)
    const otherCompanyId = await ctx.db.insert('companies', {
      name: 'Other', code: 'OTH', status: 'approved', createdAt: now,
    } as any)
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId, activeLocationId: siteA })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId, activeLocationId: siteA })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cage = await ctx.db.insert('cages', {
      name: 'C1', status: 'active', currentCount: 1000, companyId, locationId: siteA, updatedAt: now,
    })
    const pond = await ctx.db.insert('cages', {
      name: 'P1', unitType: 'pond', status: 'active', currentCount: 1000, areaM2: 1000, companyId, locationId: siteA, updatedAt: now,
    })
    const tank = await ctx.db.insert('cages', {
      name: 'T1', unitType: 'tank', status: 'active', currentCount: 500, volumeM3: 10, companyId, locationId: siteA, updatedAt: now,
    })
    const item = await ctx.db.insert('inventoryItems', {
      companyId, name: 'Agricultural lime', category: 'chemical', unit: 'kg', minimumStock: 0, active: true, updatedAt: now,
    })
    await ctx.db.insert('inventoryItemStock', { companyId, itemId: item, locationId: siteA, quantity: 100, updatedAt: now })
    return { companyId, siteA, adminId, staffId, outsiderId, cage, pond, tank, item }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

async function events(t: ReturnType<typeof convexTest>, type: string) {
  return (await t.run((ctx) => ctx.db.query('domainEvents').collect())).filter((e) => e.type === type)
}

describe('thresholds (pure)', () => {
  test('defaults differ by unit type; overrides apply all then type', () => {
    expect(effectiveThresholds('tank', []).dissolvedOxygen).toEqual({ min: 5 })
    expect(effectiveThresholds('pond', []).dissolvedOxygen).toEqual({ min: 3 })
    expect(effectiveThresholds('pond', []).secchiCm).toEqual({ min: 25, max: 45 })
    const o = [
      { unitType: 'all' as const, parameter: 'dissolvedOxygen', min: 4.5 },
      { unitType: 'tank' as const, parameter: 'dissolvedOxygen', min: 6 },
      { unitType: 'all' as const, parameter: 'ph' },
    ]
    expect(effectiveThresholds('cage', o).dissolvedOxygen).toEqual({ min: 4.5 })
    expect(effectiveThresholds('tank', o).dissolvedOxygen).toEqual({ min: 6 })
    // An override with no limits turns the parameter off.
    expect(effectiveThresholds('cage', o).ph).toBeUndefined()
  })

  test('breaches and summary; impossible values refused', () => {
    const b = evaluateBreaches({ dissolvedOxygen: 2.8, ph: 9.4, temperatureC: 28 }, effectiveThresholds('cage', []))
    expect(b.map((x) => [x.parameter, x.direction])).toEqual([['dissolvedOxygen', 'low'], ['ph', 'high']])
    expect(breachSummary(b)).toBe('DO 2.8 mg/L (min 4); pH 9.4 (max 9)')
    expect(() => checkValues({ ph: 15 })).toThrow(/pH must be between/)
    expect(() => checkValues({})).toThrow(/at least one/)
  })
})

describe('water-quality log', () => {
  test('staff logs a reading; a breach emits events for automation', async () => {
    const { staff, t, tank } = await setup()
    const res = await staff.mutation(api.waterQuality.record, { unitId: tank, dissolvedOxygen: 4.2, temperatureC: 27, ammonia: 0.3 })
    // 4.2 mg/L is fine in a cage but low for a tank (min 5).
    expect(res.breaches).toMatchObject([{ parameter: 'dissolvedOxygen', direction: 'low', limit: 5 }])
    expect(await events(t, 'water.reading.recorded')).toHaveLength(1)
    const breached = await events(t, 'water.threshold.breached')
    expect(breached).toHaveLength(1)
    expect(breached[0].payload).toMatchObject({ unitName: 'T1', lowOxygen: true, source: 'manual', summary: 'DO 4.2 mg/L (min 5)' })
    const log = await staff.query(api.waterQuality.listForUnit, { unitId: tank, since: 0 })
    expect(log?.rows[0]).toMatchObject({ source: 'manual', values: { dissolvedOxygen: 4.2 } })
    expect(log?.rows[0].breaches).toHaveLength(1)
  })

  test('replayed save with the same client id writes once', async () => {
    const { staff, t, cage } = await setup()
    const a = await staff.mutation(api.waterQuality.record, { unitId: cage, ph: 7, clientMutationId: 'wq-1' })
    const b = await staff.mutation(api.waterQuality.record, { unitId: cage, ph: 7, clientMutationId: 'wq-1' })
    expect(b.id).toBe(a.id)
    expect(await t.run((ctx) => ctx.db.query('waterQualityReadings').collect())).toHaveLength(1)
  })

  test('another company cannot log or read', async () => {
    const { outsider, cage } = await setup()
    await expect(outsider.mutation(api.waterQuality.record, { unitId: cage, ph: 7 })).rejects.toThrow(/not found/)
    expect(await outsider.query(api.waterQuality.listForUnit, { unitId: cage, since: 0 })).toBeNull()
  })

  test('organization thresholds change evaluation; only admins set them', async () => {
    const { admin, staff, cage } = await setup()
    await expect(staff.mutation(api.waterQuality.setThreshold, { unitType: 'cage', parameter: 'dissolvedOxygen', min: 6 })).rejects.toThrow(/Insufficient/)
    await expect(admin.mutation(api.waterQuality.setThreshold, { unitType: 'cage', parameter: 'ph', min: 9, max: 7 })).rejects.toThrow(/Minimum/)
    await admin.mutation(api.waterQuality.setThreshold, { unitType: 'cage', parameter: 'dissolvedOxygen', min: 6 })
    const res = await staff.mutation(api.waterQuality.record, { unitId: cage, dissolvedOxygen: 5.5 })
    expect(res.breaches).toHaveLength(1)
    const th = await admin.query(api.waterQuality.thresholds, {})
    expect(th.byUnitType.cage.dissolvedOxygen).toEqual({ min: 6 })
    expect(th.byUnitType.pond.dissolvedOxygen).toEqual({ min: 3 })
    await admin.mutation(api.waterQuality.setThreshold, { unitType: 'cage', parameter: 'dissolvedOxygen', reset: true })
    expect((await admin.query(api.waterQuality.thresholds, {})).byUnitType.cage.dissolvedOxygen).toEqual({ min: 4 })
  })

  test('sensor readings merge into the unit log and breaches emit an event', async () => {
    const { admin, t, cage, companyId } = await setup()
    await t.run(async (ctx) => {
      const userId = (await ctx.db.query('users').first())!._id
      const apiKeyId = await ctx.db.insert('apiKeys', {
        companyId, name: 'gw', prefix: 'p', hash: 'h', scopes: ['ingest:write'], createdBy: userId, createdAt: Date.now(),
      })
      await ctx.runMutation(internal.sensors.ingest, {
        apiKeyId,
        readings: [
          { index: 0, deviceId: 'probe-1', parameter: 'dissolved_oxygen', value: 2.5, measuredAt: Date.now() - 60000, cageId: cage },
          { index: 1, deviceId: 'probe-1', parameter: 'temperature_c', value: 29, measuredAt: Date.now() - 60000, cageId: cage },
        ],
      })
    })
    const breached = await events(t, 'water.threshold.breached')
    expect(breached[0].payload).toMatchObject({ source: 'sensor', unitName: 'C1', lowOxygen: true })
    const log = await admin.query(api.waterQuality.listForUnit, { unitId: cage, since: 0 })
    expect(log?.rows[0]).toMatchObject({ source: 'sensor', deviceId: 'probe-1', values: { dissolvedOxygen: 2.5, temperatureC: 29 } })
  })
})

describe('dual-write and M15 backfill', () => {
  test('daily record water values are mirrored, edited and removed with the record', async () => {
    const { admin, t, cage } = await setup()
    const id = await admin.mutation(api.dailyRecords.create, {
      cageId: cage, date: '2026-01-10', feedAmount: 0, feedPrice: 0, feedCost: 0, mortality: 0, dissolvedOxygen: 3.1, temperatureC: 28,
    } as any)
    let rows = await t.run((ctx) => ctx.db.query('waterQualityReadings').collect())
    expect(rows).toMatchObject([{ source: 'daily_record', sourceId: id, dissolvedOxygen: 3.1, date: '2026-01-10', breachCount: 1 }])
    await admin.mutation(api.dailyRecords.update, { id, patch: { dissolvedOxygen: 5 } } as any)
    rows = await t.run((ctx) => ctx.db.query('waterQualityReadings').collect())
    expect(rows).toMatchObject([{ dissolvedOxygen: 5, breachCount: 0 }])
    await admin.mutation(api.dailyRecords.remove, { id })
    expect(await t.run((ctx) => ctx.db.query('waterQualityReadings').collect())).toHaveLength(0)
  })

  test('backfill: dry run counts, real run copies once (count equality), originals untouched', async () => {
    const { t, cage, companyId, siteA } = await setup()
    await t.run(async (ctx) => {
      for (const [date, oxygen] of [['2025-06-01', 5.1], ['2025-06-02', undefined], ['2025-06-03', 3.9]] as const) {
        await ctx.db.insert('dailyRecords', {
          cageId: cage, date, feedAmount: 0, feedPrice: 0, feedCost: 0, mortality: 0, dissolvedOxygen: oxygen, companyId, locationId: siteA,
        })
      }
      await ctx.db.insert('biweeklyRecords', {
        cageId: cage, date: '2025-06-05', batchCode: 'B1', averageBodyWeight: 50, totalFishCount: 10, totalWeight: 0.5, secchiCm: 30, companyId, updatedAt: Date.now(),
      })
    })
    const dry = await t.mutation(internal.waterQuality.backfillFromRecords, { table: 'dailyRecords' })
    expect(dry).toMatchObject({ dryRun: true, withWater: 2, created: 0 })
    expect(await t.run((ctx) => ctx.db.query('waterQualityReadings').collect())).toHaveLength(0)
    await t.mutation(internal.waterQuality.backfillFromRecords, { table: 'dailyRecords', dryRun: false })
    await t.mutation(internal.waterQuality.backfillFromRecords, { table: 'biweeklyRecords', dryRun: false })
    const again = await t.mutation(internal.waterQuality.backfillFromRecords, { table: 'dailyRecords', dryRun: false })
    expect(again).toMatchObject({ created: 0, alreadyMirrored: 2 })
    const rows = await t.run((ctx) => ctx.db.query('waterQualityReadings').collect())
    expect(rows).toHaveLength(3)
    expect(await events(t, 'water.threshold.breached')).toHaveLength(0)
    const originals = await t.run((ctx) => ctx.db.query('dailyRecords').collect())
    expect(originals.map((r) => r.dissolvedOxygen)).toEqual([5.1, undefined, 3.9])
  })
})

describe('pond water management (POND-002)', () => {
  test('liming from inventory issues the product to the pond', async () => {
    const { staff, t, pond, item } = await setup()
    await staff.mutation(api.waterQuality.logWaterEvent, { unitId: pond, date: '2026-01-05', kind: 'liming', inventoryItemId: item, quantity: 40 })
    await staff.mutation(api.waterQuality.logWaterEvent, { unitId: pond, date: '2026-01-06', kind: 'exchange', exchangePct: 20 })
    await expect(staff.mutation(api.waterQuality.logWaterEvent, { unitId: pond, date: '2026-01-06', kind: 'exchange' })).rejects.toThrow(/%/)
    await expect(staff.mutation(api.waterQuality.logWaterEvent, { unitId: pond, date: '2026-01-06', kind: 'fertilization' })).rejects.toThrow(/product/)
    await expect(staff.mutation(api.waterQuality.logWaterEvent, { unitId: pond, date: '2026-01-07', kind: 'liming', inventoryItemId: item, quantity: 500 })).rejects.toThrow(/Not enough/)
    const list = await staff.query(api.waterQuality.listWaterEvents, { unitId: pond })
    expect(list.map((e) => e.kind)).toEqual(['exchange', 'liming'])
    expect(list[1]).toMatchObject({ product: 'Agricultural lime', quantityUnit: 'kg' })
    const stock = await t.run((ctx) => ctx.db.query('inventoryItemStock').collect())
    expect(stock[0].quantity).toBe(60)
  })
})
