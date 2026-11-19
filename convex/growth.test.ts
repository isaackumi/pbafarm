/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { adg, biomassKg, fcr, sgr } from './lib/growth'
import * as kpi from './lib/kpi'

const modules = import.meta.glob('./**/*.ts')

describe('growth formulas', () => {
  test('biomass, FCR, SGR and ADG', () => {
    expect(biomassKg(10000, 450)).toBe(4500)
    expect(fcr(6000, 4000)).toBe(1.5)
    expect(fcr(6000, 0)).toBeNull()
    // 5 g to 450 g over 180 days
    expect(sgr(5, 450, 180)!).toBeCloseTo(2.5, 1)
    expect(adg(5, 455, 180)).toBe(2.5)
    expect(sgr(0, 450, 180)).toBeNull()
  })
})

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
    } as any)
    const userId = await ctx.db.insert('users', {
      email: 'manager@example.com',
      role: 'admin',
      companyId,
    })
    const cageId = await ctx.db.insert('cages', {
      name: 'B2',
      status: 'active',
      currentCount: 9500,
      initialCount: 10000,
      initialAbw: 5,
      capacity: 12000,
      stockingDate: '2026-05-01',
      companyId,
      updatedAt: Date.now(),
    } as any)
    await ctx.db.insert('stockingHistory', {
      cageId,
      batchNumber: 'B2-2605',
      stockingDate: '2026-05-01',
      fishCount: 10000,
      initialAbw: 5,
      initialBiomass: 50,
      status: 'approved',
      companyId,
    } as any)
    // 3 days of feed and mortality inside the cycle, 1 day before it
    for (const [date, feed, dead] of [
      ['2026-04-30', 999, 0],
      ['2026-06-01', 2000, 200],
      ['2026-07-01', 2500, 200],
      ['2026-08-01', 3000, 100],
    ] as const) {
      await ctx.db.insert('dailyRecords', {
        cageId,
        date,
        feedAmount: feed,
        feedPrice: 10,
        feedCost: feed * 10,
        mortality: dead,
        companyId,
      } as any)
    }
    return { userId, cageId }
  })
  return { t, as: t.withIdentity({ subject: `${ids.userId}|s` }), ...ids }
}

describe('cage cycle growth', () => {
  test('a bi-weekly sample sets the cage weight and drives eFCR', async () => {
    const { t, as, cageId } = await setup()

    await as.mutation(api.biweeklyRecords.create, {
      cageId,
      date: '2026-08-02',
      batchCode: 'BW-1',
      averageBodyWeight: 400,
      totalFishCount: 30,
      totalWeight: 12,
    })
    expect((await t.run((ctx) => ctx.db.get(cageId)))?.currentWeight).toBe(400)

    const g = (await as.query(api.cages.growth, { id: cageId }))!
    expect(g.feed_kg).toBe(7500) // the 2026-04-30 row is before stocking
    expect(g.mortality).toBe(500)
    expect(g.current_abw_g).toBe(400)
    expect(g.current_biomass_kg).toBe(3800) // 9,500 fish x 400 g
    // 7,500 kg feed / (3,800 - 50) kg gained
    expect(g.efcr).toBe(2)
    expect(g.survival_pct).toBe(95)
    expect(g.sgr_pct_day).toBeGreaterThan(0)
  })

  test('deleting the latest sample falls back to the previous weight', async () => {
    const { t, as, cageId } = await setup()
    await as.mutation(api.biweeklyRecords.create, {
      cageId, date: '2026-07-15', batchCode: 'BW-1', averageBodyWeight: 250, totalFishCount: 30, totalWeight: 7.5,
    })
    const second = await as.mutation(api.biweeklyRecords.create, {
      cageId, date: '2026-08-02', batchCode: 'BW-2', averageBodyWeight: 400, totalFishCount: 30, totalWeight: 12,
    })
    await as.mutation(api.biweeklyRecords.remove, { id: second })
    expect((await t.run((ctx) => ctx.db.get(cageId)))?.currentWeight).toBe(250)
  })

  test('suggested harvest FCR uses feed since stocking and harvested weight', async () => {
    const { as, cageId } = await setup()
    const s = (await as.query(api.harvest.suggestFcr, {
      cageId,
      harvestDate: '2026-11-10',
      totalWeight: 5050,
    }))!
    // 7,500 kg feed / (5,050 - 50) kg produced
    expect(s.fcr).toBe(1.5)
    expect(s.feed_kg).toBe(7500)
  })

  test('farm eFCR combines active cages', async () => {
    const { as, cageId } = await setup()
    await as.mutation(api.biweeklyRecords.create, {
      cageId, date: '2026-08-02', batchCode: 'BW-1', averageBodyWeight: 400, totalFishCount: 30, totalWeight: 12,
    })
    const all = await as.query(api.cages.growthAll, {})
    expect(all.cages).toHaveLength(1)
    expect(all.farm_efcr).toBe(2)
    expect(all.farm_biomass_kg).toBe(3800)
  })

  test('ANLY-901: the cage figures are the KPI service definitions, on every screen', async () => {
    const { as, cageId } = await setup()
    await as.mutation(api.biweeklyRecords.create, {
      cageId, date: '2026-08-02', batchCode: 'BW-1', averageBodyWeight: 400, totalFishCount: 30, totalWeight: 12,
    })
    const g = (await as.query(api.cages.growth, { id: cageId, asOf: '2026-08-10' }))!
    const days = kpi.daysBetween('2026-05-01', '2026-08-02')
    const biomass = kpi.biomassKg(9500, 400)
    expect(g.current_biomass_kg).toBe(kpi.round(biomass, 1))
    expect(g.efcr).toBe(kpi.round(kpi.efcr(7500, biomass - 50), 2))
    expect(g.sgr_pct_day).toBe(kpi.round(kpi.sgr(5, 400, days), 2))
    expect(g.adg_g_day).toBe(kpi.round(kpi.adg(5, 400, days), 2))
    expect(g.survival_pct).toBe(kpi.round((9500 / 10000) * 100, 1))
    expect(g.days_of_culture).toBe(kpi.daysBetween('2026-05-01', '2026-08-10'))

    // The farm view shows the same cage figures.
    const all = await as.query(api.cages.growthAll, { asOf: '2026-08-10' })
    const row: any = all.cages.find((c: any) => c.cage_id === cageId)
    for (const k of ['efcr', 'sgr_pct_day', 'adg_g_day', 'survival_pct', 'current_biomass_kg', 'current_abw_g'] as const) {
      expect(row[k]).toBe((g as any)[k])
    }
  })
})
