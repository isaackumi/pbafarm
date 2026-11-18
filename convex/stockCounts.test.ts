/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
      settings: { aiAssistantEnabled: false, feedRules: { trackLots: true } },
    } as any)
    const otherId = await ctx.db.insert('companies', { name: 'Other', code: 'OTH', status: 'approved', createdAt: now } as any)
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherId })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const supplierId = await ctx.db.insert('feedSuppliers', { name: 'Raanan', companyId, updatedAt: now })
    const grower = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 0, minimumStock: 0, pricePerKg: 10, active: true, bagSizeKg: 25, companyId, updatedAt: now,
    } as any)
    return { adminId, staffId, outsiderId, siteA, supplierId, grower }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

describe('stock counts (INV-011)', () => {
  test('a posted count adjusts feed and items at the site to what was counted', async () => {
    const { t, admin, staff, siteA, supplierId, grower } = await setup()
    await admin.mutation(api.feed.createPurchase, {
      feedTypeId: grower, quantity: 100, pricePerKg: 8, purchaseDate: '2026-05-01', supplierId, locationId: siteA,
    })
    const itemId = await admin.mutation(api.inventoryItems.createItem, { name: 'Lime', category: 'chemical', unit: 'bag' })
    await admin.mutation(api.inventoryItems.receive, { itemId, quantity: 10, locationId: siteA })

    const id = await staff.mutation(api.stockCounts.startCount, { locationId: siteA, countDate: '2026-05-10' })
    await expect(staff.mutation(api.stockCounts.startCount, { locationId: siteA, countDate: '2026-05-10' })).rejects.toThrow(
      /already open/,
    )
    let count = (await staff.query(api.stockCounts.getCount, { id }))!
    const feedLine = count.lines.find((l) => l.kind === 'feed')!
    const itemLine = count.lines.find((l) => l.kind === 'item')!
    expect(feedLine.expected).toBe(100)
    expect(itemLine.expected).toBe(10)

    await expect(staff.mutation(api.stockCounts.postCount, { id })).rejects.toThrow(/Insufficient permissions/)
    await expect(admin.mutation(api.stockCounts.postCount, { id })).rejects.toThrow(/at least one/)
    await expect(
      staff.mutation(api.stockCounts.updateCountLines, { id, lines: [{ index: feedLine.index, counted: -1 }] }),
    ).rejects.toThrow()
    await staff.mutation(api.stockCounts.updateCountLines, {
      id,
      lines: [
        { index: feedLine.index, counted: 92.5 },
        { index: itemLine.index, counted: 12 },
      ],
    })

    expect(await admin.mutation(api.stockCounts.postCount, { id })).toEqual({ adjusted: 2 })
    count = (await staff.query(api.stockCounts.getCount, { id }))!
    expect(count.status).toBe('posted')
    expect(count.lines.find((l) => l.kind === 'feed')?.variance).toBe(-7.5)

    const state = await t.run(async (ctx) => ({
      feed: await ctx.db.get(grower),
      txns: await ctx.db.query('feedInventoryTransactions').collect(),
      stock: await ctx.db.query('inventoryItemStock').collect(),
    }))
    expect(state.feed?.currentStock).toBe(92.5)
    const adj = state.txns.find((x) => x.transactionType === 'adjustment')!
    expect(adj).toMatchObject({ quantityKg: -7.5, locationId: siteA, referenceId: String(id) })
    expect(state.stock.find((s) => s.itemId === itemId)?.quantity).toBe(12)

    // Posted counts are closed.
    await expect(admin.mutation(api.stockCounts.cancelCount, { id })).rejects.toThrow(/already posted/)
  })

  test('another company cannot see, edit or post a count', async () => {
    const { admin, outsider, siteA, supplierId, grower } = await setup()
    await admin.mutation(api.feed.createPurchase, {
      feedTypeId: grower, quantity: 5, pricePerKg: 8, purchaseDate: '2026-05-01', supplierId, locationId: siteA,
    })
    const id = await admin.mutation(api.stockCounts.startCount, { locationId: siteA, countDate: '2026-05-10' })

    expect(await outsider.query(api.stockCounts.getCount, { id })).toBeNull()
    expect(await outsider.query(api.stockCounts.listCounts, {})).toEqual([])
    await expect(outsider.mutation(api.stockCounts.startCount, { locationId: siteA, countDate: '2026-05-10' })).rejects.toThrow()
    await expect(
      outsider.mutation(api.stockCounts.updateCountLines, { id, lines: [{ index: 0, counted: 1 }] }),
    ).rejects.toThrow(/not found/i)
    await expect(outsider.mutation(api.stockCounts.postCount, { id })).rejects.toThrow(/not found/i)
    await expect(outsider.mutation(api.stockCounts.cancelCount, { id })).rejects.toThrow(/not found/i)
  })
})
