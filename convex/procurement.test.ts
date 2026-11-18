/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

async function setup({ trackLots = true } = {}) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
      settings: { aiAssistantEnabled: false, feedRules: { trackLots } },
    } as any)
    const otherId = await ctx.db.insert('companies', { name: 'Other', code: 'OTH', status: 'approved', createdAt: now } as any)
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherId })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'Site B', active: true, updatedAt: now })
    const cageB = await ctx.db.insert('cages', { name: 'B1', status: 'active', companyId, locationId: siteB, updatedAt: now } as any)
    const supplierId = await ctx.db.insert('feedSuppliers', { name: 'Raanan', companyId, updatedAt: now })
    const otherSupplierId = await ctx.db.insert('feedSuppliers', { name: 'Theirs', companyId: otherId, updatedAt: now })
    const feed = (name: string) =>
      ctx.db.insert('feedTypes', {
        name, currentStock: 0, minimumStock: 0, pricePerKg: 10, active: true, bagSizeKg: 25, companyId, updatedAt: now,
      } as any)
    const grower = await feed('Grower')
    const starter = await feed('Starter')
    return { companyId, adminId, staffId, outsiderId, siteA, siteB, cageB, supplierId, otherSupplierId, grower, starter }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

describe('purchase orders', () => {
  test('draft → ordered → received books purchases into stock at the delivery site', async () => {
    const { t, staff, admin, supplierId, siteB, grower, starter } = await setup()
    const id = await staff.mutation(api.procurement.create, {
      supplierId, locationId: siteB,
      lines: [
        { feedTypeId: grower, quantityKg: 1000, pricePerKg: 7 },
        { feedTypeId: starter, quantityKg: 200, pricePerKg: 9 },
      ],
    })
    let [po] = await staff.query(api.procurement.list, {})
    expect(po.po_number).toBe('PO-0001')
    expect(po.status).toBe('draft')
    expect(po.ordered_value).toBe(7000 + 1800)

    // Receiving before ordering, and staff placing the order, are refused.
    await expect(staff.mutation(api.procurement.receive, { id, receivedDate: '2026-11-18' })).rejects.toThrow(/Only an ordered/)
    await expect(staff.mutation(api.procurement.markOrdered, { id })).rejects.toThrow(/Insufficient permissions/)
    await admin.mutation(api.procurement.markOrdered, { id })
    await expect(staff.mutation(api.procurement.update, { id, notes: 'x' })).rejects.toThrow(/Only a draft/)

    // Short delivery of grower at a better price; starter in full.
    await staff.mutation(api.procurement.receive, {
      id, receivedDate: '2026-11-18',
      lines: [{ index: 0, receivedKg: 950, pricePerKg: 6.5, batchNumber: 'L-77' }],
    })
    ;[po] = await staff.query(api.procurement.list, {})
    expect(po.status).toBe('received')
    expect(po.received_value).toBe(950 * 6.5 + 200 * 9)

    const state = await t.run(async (ctx) => ({
      grower: await ctx.db.get(grower),
      purchases: await ctx.db.query('feedPurchases').collect(),
      lots: await ctx.db.query('feedInventory').collect(),
      txns: await ctx.db.query('feedInventoryTransactions').collect(),
    }))
    expect(state.grower?.currentStock).toBe(950)
    expect(state.purchases).toHaveLength(2)
    const gp = state.purchases.find((p) => p.feedTypeId === grower)!
    expect(gp.pricePerKg).toBe(6.5)
    expect(gp.locationId).toBe(siteB)
    expect(gp.supplierId).toBe(supplierId)
    const lot = state.lots.find((l) => l.feedTypeId === grower)!
    expect(lot.locationId).toBe(siteB)
    expect(lot.batchNumber).toBe('L-77')
    expect(state.txns.filter((x) => x.transactionType === 'purchase')).toHaveLength(2)

    // A received PO cannot be received again or cancelled.
    await expect(staff.mutation(api.procurement.receive, { id, receivedDate: '2026-11-19' })).rejects.toThrow(/Only an ordered/)
    await expect(admin.mutation(api.procurement.cancel, { id })).rejects.toThrow(/cannot be cancelled/)
  })

  test('the received price feeds P&L costing', async () => {
    const { admin, supplierId, siteB, grower } = await setup()
    const id = await admin.mutation(api.procurement.create, {
      supplierId, locationId: siteB, lines: [{ feedTypeId: grower, quantityKg: 100, pricePerKg: 7 }],
    })
    await admin.mutation(api.procurement.markOrdered, { id })
    await admin.mutation(api.procurement.receive, { id, receivedDate: '2026-11-01' })
    const purchases = await admin.query(api.feed.listPurchases, {})
    expect(purchases[0].price_per_kg).toBe(7)
  })

  test('numbers are sequential; lines and supplier are validated', async () => {
    const { admin, outsider, supplierId, otherSupplierId, grower } = await setup()
    await admin.mutation(api.procurement.create, { supplierId, lines: [{ feedTypeId: grower, quantityKg: 1, pricePerKg: 1 }] })
    await admin.mutation(api.procurement.create, { supplierId, lines: [{ feedTypeId: grower, quantityKg: 1, pricePerKg: 1 }] })
    const list = await admin.query(api.procurement.list, {})
    expect(list.map((p) => p.po_number).sort()).toEqual(['PO-0001', 'PO-0002'])

    await expect(admin.mutation(api.procurement.create, { supplierId, lines: [] })).rejects.toThrow(/at least one/)
    await expect(
      admin.mutation(api.procurement.create, { supplierId, lines: [{ feedTypeId: grower, quantityKg: 0, pricePerKg: 1 }] }),
    ).rejects.toThrow(/greater than zero/)
    await expect(
      admin.mutation(api.procurement.create, { supplierId: otherSupplierId, lines: [{ feedTypeId: grower, quantityKg: 1, pricePerKg: 1 }] }),
    ).rejects.toThrow(/Supplier not found/)
    // Another company sees none of it and cannot order with this company's feed.
    expect(await outsider.query(api.procurement.list, {})).toHaveLength(0)
    await expect(
      outsider.mutation(api.procurement.create, { supplierId: otherSupplierId, lines: [{ feedTypeId: grower, quantityKg: 1, pricePerKg: 1 }] }),
    ).rejects.toThrow(/Feed type not found/)
    await expect(outsider.mutation(api.procurement.markOrdered, { id: list[0].id })).rejects.toThrow(/not found/)
  })

  test('cancel is admin only; nothing received is refused', async () => {
    const { admin, staff, supplierId, grower } = await setup()
    const id = await staff.mutation(api.procurement.create, { supplierId, lines: [{ feedTypeId: grower, quantityKg: 5, pricePerKg: 1 }] })
    await admin.mutation(api.procurement.markOrdered, { id })
    await expect(
      staff.mutation(api.procurement.receive, { id, receivedDate: '2026-11-18', lines: [{ index: 0, receivedKg: 0 }] }),
    ).rejects.toThrow(/Nothing was received/)
    await expect(staff.mutation(api.procurement.cancel, { id })).rejects.toThrow(/Insufficient/)
    await admin.mutation(api.procurement.cancel, { id, reason: 'Supplier out of stock' })
    const [po] = await admin.query(api.procurement.list, { status: 'cancelled' })
    expect(po.notes).toMatch(/Supplier out of stock/)
  })
})

describe('non-feed inventory items', () => {
  async function item(s: Awaited<ReturnType<typeof setup>>) {
    return await s.staff.mutation(api.inventoryItems.createItem, {
      name: 'Formalin', category: 'chemical', unit: 'L', minimumStock: 20, supplierId: s.supplierId,
    })
  }

  test('receive, issue to a cage, and per-site levels', async () => {
    const s = await setup()
    const itemId = await item(s)
    await s.staff.mutation(api.inventoryItems.receive, { itemId, quantity: 50, locationId: s.siteB, unitCost: 3 })
    await s.staff.mutation(api.inventoryItems.issue, { itemId, quantity: 10, cageId: s.cageB })
    await expect(
      s.staff.mutation(api.inventoryItems.issue, { itemId, quantity: 5, locationId: s.siteA }),
    ).rejects.toThrow(/Not enough Formalin at Site A: 0 L there, 5 L needed/)
    const [row] = await s.staff.query(api.inventoryItems.listItems, { locationId: s.siteB })
    expect(row.total).toBe(40)
    expect(row.site_quantity).toBe(40)
    expect(row.low).toBe(false)
    const moves = await s.staff.query(api.inventoryItems.listMovements, { itemId })
    expect(moves.map((m) => [m.type, m.quantity])).toEqual(
      expect.arrayContaining([['receipt', 50], ['issue', -10]]),
    )
    expect(moves.find((m) => m.type === 'issue')?.cage_name).toBe('B1')
  })

  test('transfers are two legs and keep the company total; admin only', async () => {
    const s = await setup()
    const itemId = await item(s)
    await s.admin.mutation(api.inventoryItems.receive, { itemId, quantity: 30, locationId: s.siteA })
    await expect(
      s.staff.mutation(api.inventoryItems.transfer, { itemId, quantity: 10, fromLocationId: s.siteA, toLocationId: s.siteB }),
    ).rejects.toThrow(/Insufficient/)
    await expect(
      s.admin.mutation(api.inventoryItems.transfer, { itemId, quantity: 40, fromLocationId: s.siteA, toLocationId: s.siteB }),
    ).rejects.toThrow(/Not enough Formalin at Site A/)
    await s.admin.mutation(api.inventoryItems.transfer, { itemId, quantity: 10, fromLocationId: s.siteA, toLocationId: s.siteB })
    const [row] = await s.admin.query(api.inventoryItems.listItems, {})
    expect(row.total).toBe(30)
    expect(Object.fromEntries(row.levels.map((l) => [l.location_name, l.quantity]))).toEqual({ 'Site A': 20, 'Site B': 10 })
    const moves = await s.admin.query(api.inventoryItems.listMovements, { itemId })
    const legs = moves.filter((m) => m.type.startsWith('transfer'))
    expect(legs).toHaveLength(2)
  })

  test('adjustments need admin and a reason; archive needs zero stock', async () => {
    const s = await setup()
    const itemId = await item(s)
    await s.admin.mutation(api.inventoryItems.receive, { itemId, quantity: 5, locationId: s.siteA })
    await expect(s.staff.mutation(api.inventoryItems.adjust, { itemId, delta: -1, locationId: s.siteA, reason: 'count' })).rejects.toThrow(/Insufficient/)
    await expect(s.admin.mutation(api.inventoryItems.adjust, { itemId, delta: -1, locationId: s.siteA, reason: ' ' })).rejects.toThrow(/reason/)
    await expect(s.admin.mutation(api.inventoryItems.archiveItem, { id: itemId })).rejects.toThrow(/still has stock/)
    await s.admin.mutation(api.inventoryItems.adjust, { itemId, delta: -5, locationId: s.siteA, reason: 'Spilled' })
    await s.admin.mutation(api.inventoryItems.archiveItem, { id: itemId })
    expect(await s.admin.query(api.inventoryItems.listItems, {})).toHaveLength(0)
  })

  test('another company cannot touch the item', async () => {
    const s = await setup()
    const itemId = await item(s)
    expect(await s.outsider.query(api.inventoryItems.listItems, {})).toHaveLength(0)
    await expect(s.outsider.mutation(api.inventoryItems.receive, { itemId, quantity: 1 })).rejects.toThrow(/Item not found/)
    await expect(s.outsider.mutation(api.inventoryItems.updateItem, { id: itemId, minimumStock: 0 })).rejects.toThrow(/Item not found/)
  })

  test('low items reach admins through the daily reminders', async () => {
    const s = await setup()
    const itemId = await item(s)
    await s.admin.mutation(api.inventoryItems.receive, { itemId, quantity: 12, locationId: s.siteA })
    const res = await s.t.mutation(internal.reminders.companyDigest, { companyId: s.companyId, date: '2026-11-18' })
    expect(res.lowItems).toBe(1)
    const notes = await s.t.run((ctx) =>
      ctx.db.query('notifications').withIndex('by_user', (q) => q.eq('userId', s.adminId)).collect(),
    )
    const low = notes.find((n) => n.title.startsWith('Low stock: 1 item'))
    expect(low?.message).toMatch(/Formalin 12 L left \(minimum 20 L\)/)
    const staffNotes = await s.t.run((ctx) =>
      ctx.db.query('notifications').withIndex('by_user', (q) => q.eq('userId', s.staffId)).collect(),
    )
    expect(staffNotes.some((n) => n.title.startsWith('Low stock'))).toBe(false)
  })
})
