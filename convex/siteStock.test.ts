/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

async function setup({ lots = true } = {}) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: Date.now(),
    } as any)
    const userId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const site = (name: string) =>
      ctx.db.insert('farmLocations', { companyId, name, active: true, updatedAt: Date.now() })
    const siteA = await site('Site A')
    const siteB = await site('Site B')
    const cage = (name: string, locationId: any) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, companyId, locationId, updatedAt: Date.now(),
      } as any)
    const cageA = await cage('A1', siteA)
    const cageB = await cage('B1', siteB)
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 1000, minimumStock: 0, pricePerKg: 10, active: true,
      bagSizeKg: 20, companyId, updatedAt: Date.now(),
    } as any)
    if (lots) {
      await ctx.db.insert('feedInventory', {
        feedTypeId, quantityKg: 1000, location: 'Site A', locationId: siteA, companyId, updatedAt: Date.now(),
      } as any)
    }
    return { userId, siteA, siteB, cageA, cageB, feedTypeId }
  })
  return { t, as: t.withIdentity({ subject: `${ids.userId}|s` }), ...ids }
}

const daily = (cageId: any, feedTypeId: any, kg: number) => ({
  cageId, date: '2026-11-18', feedAmount: kg, feedTypeId, feedPrice: 10, feedCost: kg * 10, mortality: 0,
})

describe('feed stock is checked per site', () => {
  test("a site can't feed from another site's store", async () => {
    const { as, cageB, feedTypeId } = await setup()
    await expect(as.mutation(api.dailyRecords.create, daily(cageB, feedTypeId, 100))).rejects.toThrow(
      /Not enough Grower at Site B: 0 kg there, 100 kg needed\. 1000 kg across all sites/,
    )
  })

  test('feeding at the site that holds the stock works and draws its lot down', async () => {
    const { t, as, cageA, feedTypeId, siteA } = await setup()
    await as.mutation(api.dailyRecords.create, daily(cageA, feedTypeId, 100))
    const lots = await t.run((ctx) =>
      ctx.db.query('feedInventory').withIndex('by_location', (q) => q.eq('locationId', siteA)).collect(),
    )
    expect(lots[0].quantityKg).toBe(900)
    expect((await t.run((ctx) => ctx.db.get(feedTypeId)))?.currentStock).toBe(900)
  })

  test('stock from before lots were tracked can be used by any site', async () => {
    const { as, cageB, feedTypeId } = await setup({ lots: false })
    await expect(as.mutation(api.dailyRecords.create, daily(cageB, feedTypeId, 100))).resolves.toBeTruthy()
  })

  test('site stock levels match what the ledger allows', async () => {
    const { as, siteA, siteB } = await setup()
    const a = await as.query(api.inventory.listStockLevels, { locationId: siteA })
    const b = await as.query(api.inventory.listStockLevels, { locationId: siteB })
    expect(a[0].current_stock).toBe(1000)
    expect(b[0].current_stock).toBe(0)
  })

  test("a transfer can't move more than the source site holds", async () => {
    const { t, as, feedTypeId, siteA, siteB } = await setup()
    await expect(
      as.mutation(api.inventory.createTransfer, {
        feedTypeId, quantityKg: 100, fromLocationId: siteB, toLocationId: siteA,
      }),
    ).rejects.toThrow(/Not enough Grower at Site B/)

    await as.mutation(api.inventory.createTransfer, {
      feedTypeId, quantityKg: 300, fromLocationId: siteA, toLocationId: siteB,
    })
    const b = await as.query(api.inventory.listStockLevels, { locationId: siteB })
    expect(b[0].current_stock).toBe(300)
    // Moving between sites never changes the company total.
    expect((await t.run((ctx) => ctx.db.get(feedTypeId)))?.currentStock).toBe(1000)
  })
})
