/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

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

describe('S9: two stockings approved for the same cage', () => {
  const stockingArgs = (cageId: any, fishCount: number) => ({
    cageId,
    stockingDate: '2026-11-01',
    fishCount,
    initialAbw: 5,
    initialBiomass: fishCount / 200,
  })

  test('the second approval is refused and the first count stands', async () => {
    const { t, as, emptyId } = await setup()
    const first = await as.mutation(api.stocking.createStocking, stockingArgs(emptyId, 4000))
    const second = await as.mutation(api.stocking.createStocking, stockingArgs(emptyId, 6000))

    await as.mutation(api.stocking.approveStocking, { id: first })
    await expect(as.mutation(api.stocking.approveStocking, { id: second })).rejects.toThrow(
      /cannot be stocked/,
    )
    const cage = await getDoc(t, emptyId)
    expect(cage.currentCount).toBe(4000)
    expect(cage.initialCount).toBe(4000)
    expect((await getDoc(t, second)).status).toBe('pending_approval')
  })

  test('a transfer into a cage stocked since the transfer was created is refused', async () => {
    const { t, as, a, emptyId } = await setup()
    const pending = await as.mutation(api.stocking.createStocking, stockingArgs(emptyId, 4000))
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, emptyId, 3000))
    await as.mutation(api.stocking.approveStocking, { id: pending })

    await expect(as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })).rejects.toThrow(
      /cannot be stocked/,
    )
    expect((await getDoc(t, a.cageId)).currentCount).toBe(10000)
    expect((await getDoc(t, emptyId)).currentCount).toBe(4000)
  })

  test('a transfer top-up into a cage harvested since the transfer was created is refused', async () => {
    const { t, as, a, b } = await setup()
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, b.cageId, 2000))
    await as.mutation(api.harvest.create, {
      cageId: b.cageId,
      harvestDate: '2026-11-05',
      averageBodyWeight: 450,
      totalWeight: 2250,
      estimatedCount: 5000,
      fcr: 1.5,
      harvestType: 'complete',
    })

    await expect(as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })).rejects.toThrow(
      /has been harvested since/,
    )
    expect((await getDoc(t, a.cageId)).currentCount).toBe(10000)
    expect((await getDoc(t, b.cageId)).currentCount).toBe(0)
  })

  test('refused when another approved stocking is still open, even if the status rules allow it', async () => {
    const { t, as, b, companyId } = await setup()
    // A farm that lets active cages be stocked.
    await t.run((ctx: any) =>
      ctx.db.patch(companyId, {
        settings: {
          aiAssistantEnabled: false,
          stockingRules: {
            requireApprovalForStocking: true,
            requireApprovalForTopup: true,
            enforceCageCapacity: true,
            allowStockOnlyEmptyStatuses: ['empty', 'fallow', 'harvested', 'active'],
          },
        },
      }),
    )
    const id = await as.mutation(api.stocking.createStocking, stockingArgs(b.cageId, 3000))
    await expect(as.mutation(api.stocking.approveStocking, { id })).rejects.toThrow(
      /already has an open stocking/,
    )
    expect((await getDoc(t, b.cageId)).currentCount).toBe(5000)
  })

  test('an old stocking never closed by a harvest does not block restocking a harvested cage', async () => {
    const { t, as, b } = await setup()
    // Harvested before harvests closed stockings: the old row has no closedAt.
    await t.run((ctx: any) => ctx.db.patch(b.cageId, { status: 'harvested', currentCount: 0 }))
    const id = await as.mutation(api.stocking.createStocking, stockingArgs(b.cageId, 3000))
    await as.mutation(api.stocking.approveStocking, { id })
    const cage = await getDoc(t, b.cageId)
    expect(cage.status).toBe('active')
    expect(cage.currentCount).toBe(3000)
  })
})

describe('S7: restock after harvest carries the old ABW into the new cycle', () => {
  /** Cycle 1 on cage B1 sampled at 600 g, then completely harvested. */
  async function harvestedAt600(t: any, as: any, cageId: any) {
    await as.mutation(api.biweeklyRecords.create, {
      cageId,
      date: '2026-10-01',
      batchCode: 'BW-1',
      averageBodyWeight: 600,
      totalFishCount: 30,
      totalWeight: 18,
    })
    expect((await getDoc(t, cageId)).currentWeight).toBe(600)
    await as.mutation(api.harvest.create, {
      cageId,
      harvestDate: '2026-11-01',
      averageBodyWeight: 600,
      totalWeight: 3000,
      estimatedCount: 5000,
      fcr: 1.5,
      harvestType: 'complete',
    })
  }

  test('approving a new stocking resets the cage weight to the stocking ABW', async () => {
    const { t, as, b } = await setup()
    await harvestedAt600(t, as, b.cageId)
    const id = await as.mutation(api.stocking.createStocking, {
      cageId: b.cageId,
      stockingDate: '2026-11-15',
      fishCount: 6000,
      initialAbw: 10,
      initialBiomass: 60,
    })
    await as.mutation(api.stocking.approveStocking, { id })

    expect((await getDoc(t, b.cageId)).currentWeight).toBe(10)
    const g = (await as.query(api.cages.growth, { id: b.cageId }))!
    expect(g.current_abw_g).toBe(10)
    expect(g.current_biomass_kg).toBe(60)
  })

  test('a stocking approved at creation resets it too', async () => {
    const { t, as, b, companyId } = await setup()
    await t.run((ctx: any) =>
      ctx.db.patch(companyId, {
        settings: {
          aiAssistantEnabled: false,
          stockingRules: {
            requireApprovalForStocking: false,
            requireApprovalForTopup: true,
            enforceCageCapacity: true,
          },
        },
      }),
    )
    await harvestedAt600(t, as, b.cageId)
    await as.mutation(api.stocking.createStocking, {
      cageId: b.cageId,
      stockingDate: '2026-11-15',
      fishCount: 6000,
      initialAbw: 10,
      initialBiomass: 60,
    })
    expect((await getDoc(t, b.cageId)).currentWeight).toBe(10)
  })

  test('a transfer into a harvested cage resets it to the transfer ABW', async () => {
    const { t, as, a, b } = await setup()
    await harvestedAt600(t, as, b.cageId)
    const transferId = await as.mutation(api.fishTransfers.createFishTransfer, transfer(a.cageId, b.cageId, 3000))
    await as.mutation(api.fishTransfers.approveFishTransfer, { id: transferId })
    expect((await getDoc(t, b.cageId)).currentWeight).toBe(50)
  })

  test('growth ignores a stale cage weight when the new cycle has no sample yet', async () => {
    const { t, as, b } = await setup()
    await harvestedAt600(t, as, b.cageId)
    // Restocked before this fix: the cage still says 600 g.
    await t.run(async (ctx: any) => {
      await ctx.db.insert('stockingHistory', {
        cageId: b.cageId,
        batchNumber: 'B1-2611',
        stockingDate: '2026-11-15',
        fishCount: 6000,
        initialAbw: 10,
        initialBiomass: 60,
        status: 'approved',
      })
      await ctx.db.patch(b.cageId, {
        status: 'active',
        stockingDate: '2026-11-15',
        initialCount: 6000,
        currentCount: 6000,
        initialAbw: 10,
      })
    })
    expect((await getDoc(t, b.cageId)).currentWeight).toBe(600)
    const g = (await as.query(api.cages.growth, { id: b.cageId }))!
    expect(g.current_abw_g).toBe(10)

    // M0-b: the dry run reports the cage and changes nothing ...
    const dry = await t.mutation(internal.migrations.repairStaleCageWeight, {})
    expect(dry.dryRun).toBe(true)
    expect(dry.changes).toEqual([
      expect.objectContaining({ cage: 'B1', from: 600, to: 10, lastSampleDate: '2026-10-01' }),
    ])
    expect((await getDoc(t, b.cageId)).currentWeight).toBe(600)
    // ... the real run fixes it and logs the old value.
    await t.mutation(internal.migrations.repairStaleCageWeight, { dryRun: false })
    expect((await getDoc(t, b.cageId)).currentWeight).toBe(10)
    const logs: any[] = await t.run((ctx: any) => ctx.db.query('auditLogs').collect())
    expect(logs.find((l: any) => l.actionType === 'migration')?.previousValues).toEqual({ currentWeight: 600 })
    // Cage A1 was never sampled, so it is left alone.
    expect((await t.mutation(internal.migrations.repairStaleCageWeight, {})).count).toBe(0)
  })

  test('editing an old-cycle sample does not put its weight back on the restocked cage', async () => {
    const { t, as, b } = await setup()
    await harvestedAt600(t, as, b.cageId)
    const id = await as.mutation(api.stocking.createStocking, {
      cageId: b.cageId,
      stockingDate: '2026-11-15',
      fishCount: 6000,
      initialAbw: 10,
      initialBiomass: 60,
    })
    await as.mutation(api.stocking.approveStocking, { id })
    const [old]: any[] = await t.run((ctx: any) =>
      ctx.db.query('biweeklyRecords').withIndex('by_cage', (q: any) => q.eq('cageId', b.cageId)).collect(),
    )
    await as.mutation(api.biweeklyRecords.update, { id: old._id, patch: { averageBodyWeight: 620 } })
    expect((await getDoc(t, b.cageId)).currentWeight).toBe(10)
  })
})

/** A feed type with 1,000 kg in stock (no lots, so any site can draw on it). */
async function withFeed(t: any, companyId: any) {
  return await t.run((ctx: any) =>
    ctx.db.insert('feedTypes', {
      name: 'Grower',
      currentStock: 1000,
      minimumStock: 0,
      pricePerKg: 10,
      active: true,
      bagSizeKg: 20,
      companyId,
      updatedAt: Date.now(),
    }),
  )
}

const ledger = (t: any, feedTypeId: any) =>
  t.run((ctx: any) =>
    ctx.db
      .query('feedInventoryTransactions')
      .withIndex('by_feed_type', (q: any) => q.eq('feedTypeId', feedTypeId))
      .collect(),
  )

describe('S13: ledger reversals', () => {
  test('a transaction can only be reversed once', async () => {
    const { t, as, a, companyId } = await setup()
    const feedTypeId = await withFeed(t, companyId)
    await as.mutation(api.feed.createIssue, {
      feedTypeId,
      cageId: a.cageId,
      quantity: 100,
      usageDate: '2026-11-10',
    })
    const issue = (await ledger(t, feedTypeId)).find((r: any) => r.transactionType === 'issue')
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(900)

    await as.mutation(api.inventory.reverseTransaction, { transactionId: issue._id, reason: 'Wrong cage' })
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(1000)
    await expect(
      as.mutation(api.inventory.reverseTransaction, { transactionId: issue._id, reason: 'Again' }),
    ).rejects.toThrow(/already been reversed/)
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(1000)
  })

  test('daily usage rows are corrected through the daily record, not reversed', async () => {
    const { t, as, a, companyId } = await setup()
    const feedTypeId = await withFeed(t, companyId)
    await as.mutation(api.dailyRecords.create, {
      cageId: a.cageId,
      date: '2026-11-10',
      feedAmount: 50,
      feedTypeId,
      feedPrice: 10,
      feedCost: 500,
      mortality: 0,
    })
    const usage = (await ledger(t, feedTypeId)).find((r: any) => r.transactionType === 'daily_usage')
    await expect(
      as.mutation(api.inventory.reverseTransaction, { transactionId: usage._id, reason: 'Typo' }),
    ).rejects.toThrow(/edit the daily record/)
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(950)
  })
})

describe('INV-003: reversals linked to their source records', () => {
  test('reversing an issue voids its usage row, so listUsage matches the ledger', async () => {
    const { t, as, a, companyId } = await setup()
    const feedTypeId = await withFeed(t, companyId)
    const kept = await as.mutation(api.feed.createIssue, {
      feedTypeId,
      cageId: a.cageId,
      quantity: 30,
      usageDate: '2026-11-09',
    })
    const wrong = await as.mutation(api.feed.createIssue, {
      feedTypeId,
      cageId: a.cageId,
      quantity: 100,
      usageDate: '2026-11-10',
    })
    const issue = (await ledger(t, feedTypeId)).find(
      (r: any) => r.transactionType === 'issue' && r.referenceId === String(wrong),
    )
    await as.mutation(api.inventory.reverseTransaction, { transactionId: issue._id, reason: 'Wrong cage' })

    const usage = await as.query(api.feed.listUsage, { feedTypeId })
    expect(usage.map((u: any) => u._id)).toEqual([kept])
    expect((await getDoc(t, wrong)).deletedAt).toBeTypeOf('number')
    const netOut = (await ledger(t, feedTypeId))
      .filter((r: any) => r.transactionType !== 'purchase')
      .reduce((sum: number, r: any) => sum - r.quantityKg, 0)
    expect(usage.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(netOut)
  })

  test("deleting a daily record removes only its own usage row", async () => {
    const { t, as, a, companyId } = await setup()
    const feedTypeId = await withFeed(t, companyId)
    const recordId = await as.mutation(api.dailyRecords.create, {
      cageId: a.cageId,
      date: '2026-11-10',
      feedAmount: 50,
      feedTypeId,
      feedPrice: 10,
      feedCost: 500,
      mortality: 0,
    })
    const own: any[] = await t.run((ctx: any) => ctx.db.query('feedUsage').collect())
    expect(own.map((u: any) => u.dailyRecordId)).toEqual([recordId])

    // Another daily-sourced row for the same cage and date, from a different record.
    const otherId = await t.run(async (ctx: any) => {
      const otherRecord = await ctx.db.insert('dailyRecords', {
        cageId: a.cageId,
        date: '2026-11-09',
        feedAmount: 0,
        feedPrice: 0,
        feedCost: 0,
        mortality: 0,
        companyId,
      })
      return await ctx.db.insert('feedUsage', {
        feedTypeId,
        cageId: a.cageId,
        quantity: 20,
        usageDate: '2026-11-10',
        source: 'daily',
        dailyRecordId: otherRecord,
        companyId,
        updatedAt: Date.now(),
      })
    })

    await as.mutation(api.dailyRecords.remove, { id: recordId })
    const left: any[] = await t.run((ctx: any) => ctx.db.query('feedUsage').collect())
    expect(left.map((u: any) => u._id)).toEqual([otherId])
  })
})

describe('S12: the sampling page no longer records a harvest (interim)', () => {
  const today = new Date().toISOString().split('T')[0]
  const harvestRows = (t: any) => t.run((ctx: any) => ctx.db.query('harvestRecords').collect())

  test('saving a sample writes a sampling row only', async () => {
    const { t, as, b } = await setup()
    const res = await as.mutation(api.harvest.createFromSampling, {
      cageId: b.cageId,
      date: today,
      weight: 45,
      fishCount: 100,
      sizes: { Reg: 60, Eco: 40 },
    })
    expect(res.harvestId).toBeNull()
    expect(await harvestRows(t)).toHaveLength(0)
    const sample = await getDoc(t, res.samplingId)
    expect(sample.harvestId).toBeUndefined()
    expect(sample.cageId).toBe(b.cageId)
    expect(sample.weight).toBe(45)
    expect((await getDoc(t, b.cageId)).currentCount).toBe(5000)
    expect(await as.query(api.harvest.listSampling, { cageId: b.cageId })).toHaveLength(1)
  })

  test('old sampling-page harvests are left out of harvest KPIs once tagged', async () => {
    const { t, as, b, companyId } = await setup()
    const legacyId = await t.run(async (ctx: any) => {
      // What createFromSampling used to write: a complete harvest, FCR 1.5,
      // no cage effect, plus a sampling row pointing at it.
      const harvestId = await ctx.db.insert('harvestRecords', {
        cageId: b.cageId,
        harvestDate: today,
        averageBodyWeight: 0.45,
        totalWeight: 45,
        estimatedCount: 100,
        fcr: 1.5,
        harvestType: 'complete',
        status: 'completed',
        companyId,
      })
      await ctx.db.insert('harvestSampling', {
        harvestId,
        cageId: b.cageId,
        date: today,
        weight: 45,
        fishCount: 100,
        samples: {},
        companyId,
      })
      // An old real harvest (before harvests recorded their cage effect).
      await ctx.db.insert('harvestRecords', {
        cageId: b.cageId,
        harvestDate: today,
        averageBodyWeight: 450,
        totalWeight: 2000,
        estimatedCount: 4444,
        fcr: 1.5,
        harvestType: 'partial',
        status: 'completed',
        companyId,
      })
      return harvestId
    })
    expect((await as.query(api.reports.dashboardKpis, {})).harvest_weight_kg).toBe(2045)

    // M0-c dry run finds only the sampling-page row and writes nothing.
    const dry = await t.mutation(internal.migrations.tagSamplingPageHarvests, {})
    expect(dry.dryRun).toBe(true)
    expect(dry.changes.map((c: any) => c.harvestId)).toEqual([legacyId])
    expect((await getDoc(t, legacyId)).source).toBeUndefined()

    await t.mutation(internal.migrations.tagSamplingPageHarvests, { dryRun: false })
    expect((await getDoc(t, legacyId)).source).toBe('sampling_page')
    expect((await as.query(api.reports.dashboardKpis, {})).harvest_weight_kg).toBe(2000)
    const summary = await as.query(api.reports.dashboardSummary, {})
    expect(summary.recent_harvest_weight_kg).toBe(2000)
    expect(summary.recent_harvest_count).toBe(1)
    const report = await as.query(api.reports.productionReport, {
      reportType: 'summary',
      startDate: today,
      endDate: today,
      cageIds: [b.cageId],
    })
    expect(report.summary.harvest_weight_kg).toBe(2000)
    // A second run has nothing left to tag.
    expect((await t.mutation(internal.migrations.tagSamplingPageHarvests, {})).count).toBe(0)
  })
})

describe('S14: feed issued to a cage and also logged in the daily entry (interim)', () => {
  const issue = (feedTypeId: any, cageId: any, extra: Record<string, unknown> = {}) => ({
    feedTypeId,
    cageId,
    quantity: 40,
    usageDate: '2026-11-10',
    ...extra,
  })
  const dailyEntry = (feedTypeId: any, cageId: any, extra: Record<string, unknown> = {}) => ({
    cageId,
    date: '2026-11-10',
    feedAmount: 40,
    feedTypeId,
    feedPrice: 10,
    feedCost: 400,
    mortality: 0,
    ...extra,
  })

  test('a daily entry after a feed issue for the same cage and date is refused', async () => {
    const { t, as, asStaff, a, companyId } = await setup()
    const feedTypeId = await withFeed(t, companyId)
    await asStaff.mutation(api.feed.createIssue, issue(feedTypeId, a.cageId))
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(960)

    await expect(asStaff.mutation(api.dailyRecords.create, dailyEntry(feedTypeId, a.cageId))).rejects.toThrow(
      /already issued from the store/,
    )
    await expect(
      asStaff.mutation(api.dailyRecords.createBatch, {
        date: '2026-11-10',
        records: [{ cageId: a.cageId, feedAmount: 40, feedTypeId, mortality: 0 }],
      }),
    ).rejects.toThrow(/already issued from the store/)
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(960)

    // Mortality-only entries are fine.
    await asStaff.mutation(api.dailyRecords.create, dailyEntry(feedTypeId, a.cageId, { feedAmount: 0, feedCost: 0 }))
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(960)

    // Staff cannot override; an admin can, with a reason.
    const rec: any = await t.run((ctx: any) =>
      ctx.db.query('dailyRecords').withIndex('by_cage_date', (q: any) => q.eq('cageId', a.cageId)).first(),
    )
    await expect(
      asStaff.mutation(api.dailyRecords.update, {
        id: rec._id,
        patch: { feedAmount: 40, feedTypeId },
        feedOverlapReason: 'Second feeding',
      }),
    ).rejects.toThrow()
    await as.mutation(api.dailyRecords.update, {
      id: rec._id,
      patch: { feedAmount: 40, feedTypeId },
      feedOverlapReason: 'Second feeding from a new bag',
    })
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(920)
    // Once both exist, editing the daily record's feed again does not need the override.
    await asStaff.mutation(api.dailyRecords.update, { id: rec._id, patch: { feedAmount: 30 } })
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(930)
  })

  test('a feed issue after a daily entry for the same cage and date is refused', async () => {
    const { t, as, asStaff, a, b, companyId } = await setup()
    const feedTypeId = await withFeed(t, companyId)
    await asStaff.mutation(api.dailyRecords.create, dailyEntry(feedTypeId, a.cageId))
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(960)

    await expect(asStaff.mutation(api.feed.createIssue, issue(feedTypeId, a.cageId))).rejects.toThrow(
      /already recorded in the daily entry/,
    )
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(960)

    // Other cages, other days and issues without a cage are unaffected.
    await asStaff.mutation(api.feed.createIssue, issue(feedTypeId, b.cageId))
    await asStaff.mutation(api.feed.createIssue, issue(feedTypeId, a.cageId, { usageDate: '2026-11-11' }))
    await asStaff.mutation(api.feed.createIssue, issue(feedTypeId, undefined))
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(840)

    await as.mutation(api.feed.createIssue, issue(feedTypeId, a.cageId, { feedOverlapReason: 'Extra ration' }))
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(800)
  })

  test('a reversed issue no longer blocks the daily entry', async () => {
    const { t, as, asStaff, a, companyId } = await setup()
    const feedTypeId = await withFeed(t, companyId)
    await asStaff.mutation(api.feed.createIssue, issue(feedTypeId, a.cageId))
    const txn = (await ledger(t, feedTypeId)).find((r: any) => r.transactionType === 'issue')
    await as.mutation(api.inventory.reverseTransaction, { transactionId: txn._id, reason: 'Entered by mistake' })

    await asStaff.mutation(api.dailyRecords.create, dailyEntry(feedTypeId, a.cageId))
    expect((await getDoc(t, feedTypeId)).currentStock).toBe(960)
  })
})
