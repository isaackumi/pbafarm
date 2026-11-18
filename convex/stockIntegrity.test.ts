/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

/**
 * Regression tests for the doc 09 stock-integrity scenarios (PROD-000 d-i).
 * Each describe block reproduces one scenario.
 */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
    } as any)
    const userId = await ctx.db.insert('users', { email: 'admin@example.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 'staff@example.com', role: 'user', companyId })
    const locationId = await ctx.db.insert('farmLocations', {
      companyId,
      name: 'Site A',
      active: true,
      updatedAt: Date.now(),
    } as any)

    /** An active cage with an approved, open stocking. */
    const activeCage = async (name: string, count: number) => {
      const cageId = await ctx.db.insert('cages', {
        name,
        status: 'active',
        currentCount: count,
        initialCount: count,
        initialAbw: 10,
        stockingDate: '2026-05-01',
        capacity: 100000,
        locationId,
        companyId,
        updatedAt: Date.now(),
      } as any)
      const stockingId = await ctx.db.insert('stockingHistory', {
        cageId,
        batchNumber: `${name}-2605`,
        stockingDate: '2026-05-01',
        fishCount: count,
        initialAbw: 10,
        initialBiomass: count / 100,
        status: 'approved',
        locationId,
        companyId,
      } as any)
      return { cageId, stockingId }
    }
    const emptyCage = (name: string, status = 'empty') =>
      ctx.db.insert('cages', {
        name,
        status,
        currentCount: 0,
        capacity: 100000,
        locationId,
        companyId,
        updatedAt: Date.now(),
      } as any)

    const a = await activeCage('A1', 10000)
    const b = await activeCage('B1', 5000)
    const emptyId = await emptyCage('C1')
    return { companyId, userId, staffId, locationId, a, b, emptyId }
  })
  return {
    t,
    as: t.withIdentity({ subject: `${ids.userId}|s` }),
    asStaff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    ...ids,
  }
}

const getDoc = (t: any, id: any) => t.run((ctx: any) => ctx.db.get(id))

const transfer = (sourceCageId: any, destinationCageId: any, quantity: number) => ({
  sourceCageId,
  destinationCageId,
  transferDate: '2026-11-01',
  quantity,
  abw: 50,
})

describe('S2: transfer into an active cage, linked top-up approved directly', () => {
  test('the linked top-up cannot be approved or rejected on its own', async () => {
    const { t, as, a, b } = await setup()
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, b.cageId, 2000))
    const row = await getDoc(t, transferId)
    expect(row.destinationTopupId).toBeTruthy()

    await expect(as.mutation(api.stocking.approveTopup, { id: row.destinationTopupId })).rejects.toThrow(
      /created by a fish transfer/,
    )
    await expect(as.mutation(api.stocking.rejectTopup, { id: row.destinationTopupId })).rejects.toThrow(
      /created by a fish transfer/,
    )
    expect((await getDoc(t, b.cageId)).currentCount).toBe(5000)

    // Approving the transfer moves the fish exactly once.
    await as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })
    expect((await getDoc(t, a.cageId)).currentCount).toBe(8000)
    expect((await getDoc(t, b.cageId)).currentCount).toBe(7000)
    expect((await getDoc(t, row.destinationTopupId)).status).toBe('approved')
  })

  test('a top-up already approved before this fix is not added again when the transfer is approved', async () => {
    const { t, as, a, b } = await setup()
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, b.cageId, 2000))
    const row = await getDoc(t, transferId)
    // Old behaviour: the top-up was approved directly and added its fish.
    await t.run(async (ctx: any) => {
      await ctx.db.patch(row.destinationTopupId, { status: 'approved' })
      await ctx.db.patch(b.cageId, { currentCount: 7000 })
    })

    await as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })
    expect((await getDoc(t, a.cageId)).currentCount).toBe(8000)
    expect((await getDoc(t, b.cageId)).currentCount).toBe(7000)
  })

  test('a transfer whose linked top-up was rejected cannot be approved', async () => {
    const { t, as, a, b } = await setup()
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, b.cageId, 2000))
    const row = await getDoc(t, transferId)
    await t.run((ctx: any) => ctx.db.patch(row.destinationTopupId, { status: 'rejected' }))

    await expect(as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })).rejects.toThrow(
      /was rejected/,
    )
    expect((await getDoc(t, a.cageId)).currentCount).toBe(10000)
    expect((await getDoc(t, b.cageId)).currentCount).toBe(5000)
  })

  test('the top-up detail query says which transfer it belongs to', async () => {
    const { t, as, a, b } = await setup()
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, b.cageId, 2000))
    const row = await getDoc(t, transferId)
    const topup = await as.query(api.stocking.getTopup, { id: row.destinationTopupId })
    expect(topup?.transfer_id).toBe(transferId)
  })
})

describe('S3: transfer into an empty cage, linked stocking approved directly', () => {
  test('the linked stocking cannot be approved or rejected on its own', async () => {
    const { t, as, a, emptyId } = await setup()
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, emptyId, 3000))
    const row = await getDoc(t, transferId)
    expect(row.destinationStockingId).toBeTruthy()

    await expect(
      as.mutation(api.stocking.approveStocking, { id: row.destinationStockingId }),
    ).rejects.toThrow(/created by a fish transfer/)
    await expect(
      as.mutation(api.stocking.rejectStocking, { id: row.destinationStockingId }),
    ).rejects.toThrow(/created by a fish transfer/)
    expect((await getDoc(t, emptyId)).currentCount).toBe(0)

    await as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })
    expect((await getDoc(t, a.cageId)).currentCount).toBe(7000)
    const dest = await getDoc(t, emptyId)
    expect(dest.currentCount).toBe(3000)
    expect(dest.status).toBe('active')

    const stocking = await as.query(api.stocking.getStocking, { id: row.destinationStockingId })
    expect(stocking?.transfer_id).toBe(transferId)
  })

  test('a stocking already approved before this fix is not applied twice', async () => {
    const { t, as, a, emptyId } = await setup()
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, emptyId, 3000))
    const row = await getDoc(t, transferId)
    await t.run(async (ctx: any) => {
      await ctx.db.patch(row.destinationStockingId, { status: 'approved' })
      await ctx.db.patch(emptyId, { status: 'active', currentCount: 3000, initialCount: 3000 })
      // Some fish died in the meantime.
      await ctx.db.patch(emptyId, { currentCount: 2950 })
    })

    await as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })
    expect((await getDoc(t, a.cageId)).currentCount).toBe(7000)
    // The destination count is left alone, not reset to the transfer quantity.
    expect((await getDoc(t, emptyId)).currentCount).toBe(2950)
  })

  test('ordinary stockings and top-ups are still approved directly', async () => {
    const { t, as, b, emptyId } = await setup()
    const stockingId = await as.mutation(api.stocking.createStocking, {
      cageId: emptyId,
      stockingDate: '2026-11-01',
      fishCount: 4000,
      initialAbw: 5,
      initialBiomass: 20,
    })
    await as.mutation(api.stocking.approveStocking, { id: stockingId })
    expect((await getDoc(t, emptyId)).currentCount).toBe(4000)

    const topupId = await as.mutation(api.stocking.createTopup, {
      stockingId: b.stockingId,
      topupDate: '2026-11-01',
      fishCount: 500,
      abw: 20,
    })
    await as.mutation(api.stocking.approveTopup, { id: topupId })
    expect((await getDoc(t, b.cageId)).currentCount).toBe(5500)
  })
})
