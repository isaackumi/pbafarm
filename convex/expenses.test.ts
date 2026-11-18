/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { buildPriceBook, ledgerPricePerKg, feedCostFromLedger, summarizeCost, categoryKey } from './lib/costing'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
      settings: { aiAssistantEnabled: false, locale: { currency: 'USD' } },
    } as any)
    const otherCompanyId = await ctx.db.insert('companies', {
      name: 'Other', code: 'OTH', status: 'approved', createdAt: now,
    } as any)
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'Site B', active: true, updatedAt: now })
    const cageA = await ctx.db.insert('cages', {
      name: 'A1', status: 'active', currentCount: 1000, companyId, locationId: siteA, updatedAt: now,
    } as any)
    const supplierId = await ctx.db.insert('feedSuppliers', { name: 'Raanan', companyId, updatedAt: now })
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 0, minimumStock: 0, pricePerKg: 10, active: true,
      bagSizeKg: 20, companyId, updatedAt: now,
    } as any)
    return { companyId, adminId, staffId, outsiderId, siteA, siteB, cageA, supplierId, feedTypeId }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

describe('costing helpers', () => {
  const purchases = [
    { feedTypeId: 'f1', quantity: 100, pricePerKg: 8, purchaseDate: '2026-01-01' },
    { feedTypeId: 'f1', quantity: 300, pricePerKg: 12, purchaseDate: '2026-02-01' },
    { feedTypeId: 'f1', quantity: 999, pricePerKg: 1, purchaseDate: '2026-02-02', deletedAt: 1 },
  ] as any[]
  const book = buildPriceBook(purchases)

  test('feed is priced at the weighted average of purchases up to the day', () => {
    expect(ledgerPricePerKg(book, 'f1', '2026-01-15')).toBe(8)
    expect(ledgerPricePerKg(book, 'f1', '2026-02-10')).toBe((100 * 8 + 300 * 12) / 400)
    // Before any purchase: the first purchase's price. Voided purchases never count.
    expect(ledgerPricePerKg(book, 'f1', '2025-12-01')).toBe(8)
    expect(ledgerPricePerKg(book, 'nope', '2026-02-10')).toBeNull()
  })

  test('daily feed cost uses purchase prices, list price only when nothing was bought', () => {
    const cost = feedCostFromLedger(
      [
        { feedAmount: 10, feedTypeId: 'f1', feedCost: 100, date: '2026-01-10' },
        { feedAmount: 5, feedTypeId: 'f2', feedCost: 75, date: '2026-01-10' },
      ] as any,
      book,
    )
    expect(cost.cost).toBe(10 * 8 + 75)
    expect(cost.listCost).toBe(175)
    expect(cost.listPricedKg).toBe(5)
  })

  test('cost per kg over harvested kg, else sold kg', () => {
    const s = summarizeCost({ feedCost: 600, fingerlingCost: 300, otherExpenses: 100, revenue: 1500, harvestKg: 500, soldKg: 400 })
    expect(s.total_cost).toBe(1000)
    expect(s.cost_per_kg).toBe(2)
    expect(s.net_margin).toBe(500)
    expect(summarizeCost({ feedCost: 10, fingerlingCost: 0, otherExpenses: 0, revenue: 0, harvestKg: 0, soldKg: 0 }).cost_per_kg).toBeNull()
  })

  test('custom category keys', () => {
    expect(categoryKey('  Boat fuel & oil ')).toBe('boat_fuel_oil')
  })
})

describe('expenses', () => {
  test('staff quick-add takes the cage site and company currency', async () => {
    const { t, staff, cageA, siteA } = await setup()
    const id = await staff.mutation(api.expenses.create, {
      category: 'labour', amount: 250, date: '2026-11-01', cageId: cageA,
    })
    const row = await t.run((ctx) => ctx.db.get(id))
    expect(row?.locationId).toBe(siteA)
    expect(row?.currency).toBe('USD')
  })

  test('only admins edit and delete', async () => {
    const { staff, admin } = await setup()
    const id = await staff.mutation(api.expenses.create, { category: 'transport', amount: 40, date: '2026-11-02' })
    await expect(staff.mutation(api.expenses.update, { id, amount: 50 })).rejects.toThrow(/Insufficient permissions/)
    await expect(staff.mutation(api.expenses.remove, { id })).rejects.toThrow(/Insufficient permissions/)
    await admin.mutation(api.expenses.update, { id, amount: 50 })
    let list = await admin.query(api.expenses.list, {})
    expect(list.total).toBe(50)
    await admin.mutation(api.expenses.remove, { id })
    list = await admin.query(api.expenses.list, {})
    expect(list.rows).toHaveLength(0)
  })

  test('another company cannot see, edit or attribute to the cage', async () => {
    const { admin, outsider, cageA } = await setup()
    const id = await admin.mutation(api.expenses.create, { category: 'labour', amount: 10, date: '2026-11-02' })
    expect((await outsider.query(api.expenses.list, {})).rows).toHaveLength(0)
    await expect(outsider.mutation(api.expenses.update, { id, amount: 1 })).rejects.toThrow(/not found/)
    await expect(outsider.mutation(api.expenses.remove, { id })).rejects.toThrow(/not found/)
    await expect(
      outsider.mutation(api.expenses.create, { category: 'labour', amount: 5, date: '2026-11-02', cageId: cageA }),
    ).rejects.toThrow(/Cage not found/)
  })

  test('the cage must be at the chosen site; amount and category are checked', async () => {
    const { admin, cageA, siteB } = await setup()
    await expect(
      admin.mutation(api.expenses.create, { category: 'labour', amount: 5, date: '2026-11-02', cageId: cageA, locationId: siteB }),
    ).rejects.toThrow(/not at that site/)
    await expect(admin.mutation(api.expenses.create, { category: 'labour', amount: 0, date: '2026-11-02' })).rejects.toThrow(/greater than zero/)
    await expect(admin.mutation(api.expenses.create, { category: 'boat_fuel', amount: 5, date: '2026-11-02' })).rejects.toThrow(/Unknown expense category/)
  })

  test('custom categories: admin creates, staff uses, retired ones are refused', async () => {
    const { admin, staff } = await setup()
    await expect(staff.mutation(api.expenses.createCategory, { label: 'Boat fuel' })).rejects.toThrow(/Insufficient/)
    const catId = await admin.mutation(api.expenses.createCategory, { label: 'Boat fuel' })
    await expect(admin.mutation(api.expenses.createCategory, { label: 'boat fuel' })).rejects.toThrow(/already exists/)
    await staff.mutation(api.expenses.create, { category: 'boat_fuel', amount: 30, date: '2026-11-03' })
    const cats = await staff.query(api.expenses.listCategories, {})
    expect(cats.map((c) => c.key)).toContain('boat_fuel')
    await admin.mutation(api.expenses.updateCategory, { id: catId, active: false })
    await expect(staff.mutation(api.expenses.create, { category: 'boat_fuel', amount: 30, date: '2026-11-03' })).rejects.toThrow(/Unknown/)
  })

  test('list filters and totals by category', async () => {
    const { admin, cageA, siteB } = await setup()
    await admin.mutation(api.expenses.create, { category: 'labour', amount: 100, date: '2026-10-01', cageId: cageA })
    await admin.mutation(api.expenses.create, { category: 'labour', amount: 50, date: '2026-11-01' , locationId: siteB })
    await admin.mutation(api.expenses.create, { category: 'utilities', amount: 20, date: '2026-11-05' })
    const nov = await admin.query(api.expenses.list, { dateFrom: '2026-11-01', dateTo: '2026-11-30' })
    expect(nov.total).toBe(70)
    expect(nov.by_category).toEqual({ labour: 50, utilities: 20 })
    expect(nov.rows[0].date).toBe('2026-11-05')
    expect((await admin.query(api.expenses.list, { cageId: cageA })).total).toBe(100)
    expect((await admin.query(api.expenses.list, { locationId: siteB })).total).toBe(50)
    expect((await admin.query(api.expenses.list, { category: 'utilities' })).total).toBe(20)
  })
})

describe('P&L with full cost', () => {
  async function farm() {
    const s = await setup()
    const stockingId = await s.t.run(async (ctx) => {
      const { companyId, cageA, feedTypeId, siteA, supplierId } = s
      await ctx.db.insert('feedPurchases', {
        feedTypeId, quantity: 1000, pricePerKg: 6, purchaseDate: '2026-01-01', supplierId, companyId, locationId: siteA, updatedAt: 0,
      })
      // Daily records carry the list price (10/kg).
      for (const date of ['2026-02-01', '2026-03-01']) {
        await ctx.db.insert('dailyRecords', {
          cageId: cageA, date, feedAmount: 100, feedTypeId, feedPrice: 10, feedCost: 1000, mortality: 0, companyId, locationId: siteA,
        })
      }
      await ctx.db.insert('harvestRecords', {
        cageId: cageA, harvestDate: '2026-04-01', averageBodyWeight: 400, totalWeight: 500, estimatedCount: 1250, fcr: 1.2,
        harvestType: 'complete', companyId, locationId: siteA,
      })
      await ctx.db.insert('sales', {
        cageId: cageA, saleDate: '2026-04-02', weightKg: 500, pricePerKg: 5, totalAmount: 2500, companyId, locationId: siteA, updatedAt: 0,
      })
      return await ctx.db.insert('stockingHistory', {
        cageId: cageA, batchNumber: 'B-1', stockingDate: '2026-01-15', fishCount: 1500, initialAbw: 5, initialBiomass: 7.5,
        status: 'approved', closedAt: '2026-04-01', companyId, locationId: siteA,
      })
    })
    await s.admin.mutation(api.expenses.create, { category: 'fingerlings', amount: 300, date: '2026-01-15', cageId: s.cageA, stockingId })
    await s.admin.mutation(api.expenses.create, { category: 'labour', amount: 100, date: '2026-03-15', cageId: s.cageA })
    await s.admin.mutation(api.expenses.create, { category: 'utilities', amount: 75, date: '2026-03-15' })
    return { ...s, stockingId }
  }

  test('cage P&L costs feed at purchase price and adds fingerlings and expenses', async () => {
    const { admin, cageA } = await farm()
    const p = await admin.query(api.reports.getCagePnL, { cageId: cageA })
    expect(p?.feed_cost).toBe(1200)
    expect(p?.feed_cost_list).toBe(2000)
    expect(p?.fingerling_cost).toBe(300)
    expect(p?.other_expenses).toBe(100)
    expect(p?.total_cost).toBe(1600)
    expect(p?.cost_per_kg).toBeCloseTo(3.2)
    expect(p?.net_margin).toBe(900)
    expect(p?.gross_margin).toBe(1300)

    const rows = await admin.query(api.reports.listCagePnL, {})
    expect(rows[0].total_cost).toBe(1600)
    const over = await admin.query(api.reports.pnlOverheads, {})
    expect(over.total).toBe(75)
  })

  test('cycle P&L covers the stocking to its close', async () => {
    const { admin, stockingId } = await farm()
    const cycles = await admin.query(api.reports.listCyclePnL, {})
    expect(cycles).toHaveLength(1)
    expect(cycles[0].cycle_id).toBe(stockingId)
    expect(cycles[0].end_date).toBe('2026-04-01')
    expect(cycles[0].total_cost).toBe(1600)
    // The sale the day after the close falls outside the cycle.
    expect(cycles[0].revenue).toBe(0)
    expect(cycles[0].cost_per_kg).toBeCloseTo(3.2)
  })

  test('another company gets nothing', async () => {
    const { outsider, cageA } = await farm()
    expect(await outsider.query(api.reports.getCagePnL, { cageId: cageA })).toBeNull()
    expect(await outsider.query(api.reports.listCyclePnL, {})).toHaveLength(0)
    expect((await outsider.query(api.reports.pnlOverheads, {})).total).toBe(0)
  })
})
