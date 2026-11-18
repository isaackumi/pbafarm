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
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherId })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'Site B', active: true, updatedAt: now })
    const supplierId = await ctx.db.insert('feedSuppliers', { name: 'Raanan', companyId, updatedAt: now })
    const grower = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 0, minimumStock: 0, pricePerKg: 10, active: true, bagSizeKg: 25, companyId, updatedAt: now,
    } as any)
    return { adminId, outsiderId, siteA, siteB, supplierId, grower }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

const ledger = (t: any) =>
  t.run(async (ctx: any) => ({
    txns: await ctx.db.query('feedInventoryTransactions').collect(),
    lots: await ctx.db.query('feedInventory').collect(),
  }))

describe('feed movements carry a site (INV-002)', () => {
  test('a site-to-site transfer posts two legs and keeps the lot batch and expiry', async () => {
    const { t, admin, outsider, siteA, siteB, supplierId, grower } = await setup()
    await admin.mutation(api.feed.createPurchase, {
      feedTypeId: grower, quantity: 100, pricePerKg: 8, purchaseDate: '2026-05-01', supplierId,
      batchNumber: 'L-1', expiryDate: '2027-01-31', locationId: siteA,
    })

    await admin.mutation(api.inventory.createTransfer, {
      feedTypeId: grower, quantityKg: 40, fromLocationId: siteA, toLocationId: siteB,
    })

    const { txns, lots } = await ledger(t)
    const out = txns.find((x: any) => x.transactionType === 'transfer_out')
    const inn = txns.find((x: any) => x.transactionType === 'transfer_in')
    expect(out).toMatchObject({ quantityKg: -40, locationId: siteA })
    expect(inn).toMatchObject({ quantityKg: 40, locationId: siteB, batchNumber: 'L-1', expiryDate: '2027-01-31' })
    expect(out.transferId).toBeDefined()
    expect(inn.transferId).toBe(out.transferId)

    const atB = lots.find((l: any) => l.locationId === siteB)
    expect(atB).toMatchObject({ quantityKg: 40, batchNumber: 'L-1', expiryDate: '2027-01-31' })
    expect(lots.find((l: any) => l.locationId === siteA)?.quantityKg).toBe(60)
    // Company stock is unchanged by a transfer.
    const feedType = await t.run((ctx) => ctx.db.get(grower))
    expect(feedType?.currentStock).toBe(100)

    // The per-site ledger agrees with the lots at every site.
    const tally = await admin.query(api.inventory.siteLedgerTally, { feedTypeId: grower })
    expect(tally.length).toBeGreaterThan(0)
    expect(tally.every((r: any) => r.ok)).toBe(true)

    // A transfer leg cannot be reversed on its own.
    await expect(admin.mutation(api.inventory.reverseTransaction, { transactionId: out._id, reason: 'oops' })).rejects.toThrow(/Transfer reversals/)

    // Another company sees nothing and cannot move this feed.
    expect(await outsider.query(api.inventory.siteLedgerTally, { feedTypeId: grower })).toEqual([])
    await expect(
      outsider.mutation(api.inventory.createTransfer, { feedTypeId: grower, quantityKg: 1, fromLocationId: siteA, toLocationId: siteB }),
    ).rejects.toThrow()
  })

  test('adjustments and purchase edits and voids post at the right site', async () => {
    const { t, admin, siteB, supplierId, grower } = await setup()
    const purchaseId = await admin.mutation(api.feed.createPurchase, {
      feedTypeId: grower, quantity: 50, pricePerKg: 8, purchaseDate: '2026-05-01', supplierId, locationId: siteB,
    })
    await admin.mutation(api.inventory.createAdjustment, { feedTypeId: grower, quantityKg: -5, notes: 'Spilled', locationId: siteB })
    await admin.mutation(api.feed.updatePurchase, { id: purchaseId, quantity: 60 })
    await admin.mutation(api.feed.voidPurchase, { id: purchaseId, reason: 'Wrong supplier' })

    const { txns } = await ledger(t)
    expect(txns.length).toBeGreaterThanOrEqual(4)
    for (const txn of txns) expect({ type: txn.transactionType, site: txn.locationId }).toEqual({ type: txn.transactionType, site: siteB })
  })
})
