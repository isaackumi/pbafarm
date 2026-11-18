/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

/** Harvest lots, dispatches, batch trace and withdrawal enforcement (Phase 12). */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
    })
    const otherCompanyId = await ctx.db.insert('companies', {
      name: 'Other',
      code: 'OTH',
      status: 'approved',
      createdAt: Date.now(),
    })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cage = (name: string) =>
      ctx.db.insert('cages', {
        name,
        code: name,
        status: 'empty',
        currentCount: 0,
        capacity: 100000,
        companyId,
        updatedAt: Date.now(),
      })
    const C1 = await cage('C1')
    const C5 = await cage('C5')
    const supplierId = await ctx.db.insert('feedSuppliers', { name: 'Raanan', companyId, updatedAt: Date.now() })
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower 4mm',
      currentStock: 100000,
      minimumStock: 0,
      pricePerKg: 1.2,
      active: true,
      supplierId,
      companyId,
      updatedAt: Date.now(),
    })
    const purchase = (batchNumber: string, purchaseDate: string) =>
      ctx.db.insert('feedPurchases', {
        feedTypeId,
        quantity: 1000,
        pricePerKg: 1.2,
        purchaseDate,
        supplierId,
        batchNumber,
        notes: 'Received on PO-0007',
        companyId,
        updatedAt: Date.now(),
      })
    await purchase('FL-OLD', '2025-10-01')
    await purchase('FL-1', '2025-12-20')
    await purchase('FL-2', '2026-02-01')
    await purchase('FL-LATE', '2026-12-01')
    const customerId = await ctx.db.insert('customers', { name: 'Accra Market', active: true, companyId, updatedAt: Date.now() })
    return { companyId, adminId, staffId, outsiderId, C1, C5, feedTypeId, customerId }
  })
  const as = t.withIdentity({ subject: `${ids.adminId}|s` })
  const asStaff = t.withIdentity({ subject: `${ids.staffId}|s` })
  const asOutsider = t.withIdentity({ subject: `${ids.outsiderId}|s` })
  return { t, as, asStaff, asOutsider, ids }
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    const raw = (e as { data?: unknown }).data
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { code?: string; message: string } | undefined
    return data ?? { message: String((e as Error).message) }
  }
  throw new Error('expected a rejection')
}

/** C1 stocked from a hatchery, fed and treated, then graded into C1 + C5. */
async function grownAndGraded(ctx: Awaited<ReturnType<typeof setup>>) {
  const { as, ids } = ctx
  const stockingId = await as.mutation(api.stocking.createStocking, {
    cageId: ids.C1,
    stockingDate: '2026-01-01',
    fishCount: 6000,
    initialAbw: 20,
    initialBiomass: 120,
    sourceLocation: 'Volta Hatchery',
  })
  await as.mutation(api.stocking.approveStocking, { id: stockingId })
  await as.mutation(api.dailyRecords.create, {
    cageId: ids.C1,
    date: '2026-01-10',
    feedAmount: 50,
    feedTypeId: ids.feedTypeId,
    feedPrice: 1.2,
    feedCost: 60,
    mortality: 0,
  })
  await as.mutation(api.dailyRecords.create, {
    cageId: ids.C1,
    date: '2026-02-10',
    feedAmount: 40,
    feedTypeId: ids.feedTypeId,
    feedPrice: 1.2,
    feedCost: 48,
    mortality: 0,
  })
  await as.mutation(api.health.create, {
    cageId: ids.C1,
    date: '2026-03-01',
    diagnosis: 'Streptococcus',
    treatment: 'Medicated feed',
    productName: 'Oxytetracycline',
    withdrawalDays: 60,
  })
  const g = await as.mutation(api.batches.grade, {
    cageId: ids.C1,
    date: '2026-04-01',
    outputs: [
      { cageId: ids.C1, quantity: 2000, abw: 260 },
      { cageId: ids.C5, quantity: 4000, abw: 180 },
    ],
    culls: 0,
  })
  return { childInC5: g.childBatchIds[1] as Id<'batches'> }
}

const harvestArgs = (cageId: Id<'cages'>, harvestDate: string) => ({
  cageId,
  harvestDate,
  averageBodyWeight: 450,
  totalWeight: 1800,
  estimatedCount: 4000,
  fcr: 1.5,
  harvestType: 'complete' as const,
  status: 'completed' as const,
})

describe('withdrawal enforcement (PROD-012)', () => {
  test('a treatment before grading blocks harvesting the child batch; admin override is audited', async () => {
    const ctx = await setup()
    const { as, asStaff, t, ids } = ctx
    await grownAndGraded(ctx)

    // Withdrawal runs until 2026-04-30: the treatment was in C1, the fish are now in C5.
    const status = await as.query(api.traceability.withdrawalStatus, { cageId: ids.C5, date: '2026-04-20' })
    expect(status).toMatchObject({ blocked: true, until: '2026-04-30' })

    const refused = await errorOf(as.mutation(api.harvest.create, harvestArgs(ids.C5, '2026-04-20')))
    expect(refused).toMatchObject({ code: 'WITHDRAWAL_ACTIVE' })
    expect(refused.message).toMatch(/until 2026-04-30.*Oxytetracycline/)

    const staff = await errorOf(
      asStaff.mutation(api.harvest.create, { ...harvestArgs(ids.C5, '2026-04-20'), withdrawalOverrideReason: 'Buyer accepted' }),
    )
    expect(staff).toMatchObject({ code: 'FORBIDDEN' })

    const { id } = await as.mutation(api.harvest.create, {
      ...harvestArgs(ids.C5, '2026-04-20'),
      withdrawalOverrideReason: 'Lab test negative for residues',
    })
    const rec = await t.run((c) => c.db.get(id))
    expect(rec!.withdrawalOverride).toMatchObject({ reason: 'Lab test negative for residues', until: '2026-04-30' })
    const audit = await t.run((c) =>
      c.db
        .query('auditLogs')
        .withIndex('by_company', (q) => q.eq('companyId', ids.companyId))
        .filter((q) => q.eq(q.field('actionType'), 'withdrawal_override'))
        .collect(),
    )
    expect(audit).toHaveLength(1)
  })

  test('after the withdrawal ends, harvest and sale go through; a sale inside it is refused', async () => {
    const ctx = await setup()
    const { as, ids } = ctx
    await grownAndGraded(ctx)
    expect(await as.query(api.traceability.withdrawalStatus, { cageId: ids.C5, date: '2026-05-01' })).toMatchObject({
      blocked: false,
    })
    const saleArgs = {
      cageId: ids.C1,
      customerId: ids.customerId,
      saleDate: '2026-04-10',
      weightKg: 100,
      pricePerKg: 3,
    }
    expect(await errorOf(as.mutation(api.sales.createSale, saleArgs))).toMatchObject({ code: 'WITHDRAWAL_ACTIVE' })
    await as.mutation(api.sales.createSale, { ...saleArgs, saleDate: '2026-05-02' })
    const { id } = await as.mutation(api.harvest.create, harvestArgs(ids.C5, '2026-05-01'))
    expect(id).toBeTruthy()
  })

  test('a cage with no treatments is never blocked', async () => {
    const { as, ids } = await setup()
    const stockingId = await as.mutation(api.stocking.createStocking, {
      cageId: ids.C5,
      stockingDate: '2026-01-01',
      fishCount: 1000,
      initialAbw: 20,
      initialBiomass: 20,
    })
    await as.mutation(api.stocking.approveStocking, { id: stockingId })
    const { id } = await as.mutation(api.harvest.create, { ...harvestArgs(ids.C5, '2026-03-01'), estimatedCount: 1000 })
    expect(id).toBeTruthy()
  })
})

describe('harvest lots, dispatches and the trace report (TRACE-001..004)', () => {
  test('a lot traces back to the hatchery, the feed lots and the treatment, and forward to the customer', async () => {
    const ctx = await setup()
    const { as, asStaff, asOutsider, ids } = ctx
    const { childInC5 } = await grownAndGraded(ctx)
    const { id: harvestId } = await as.mutation(api.harvest.create, harvestArgs(ids.C5, '2026-05-10'))

    const a = await asStaff.mutation(api.traceability.createLot, { harvestId, weightKg: 1000, grade: 'Reg' })
    expect(a.lotCode).toMatch(/-260510-1$/)
    await asStaff.mutation(api.traceability.createLot, { harvestId, weightKg: 800, lotCode: 'export-1' })
    expect(await errorOf(asStaff.mutation(api.traceability.createLot, { harvestId, weightKg: 10 }))).toMatchObject({
      code: 'VALIDATION',
    })
    expect(
      await errorOf(asStaff.mutation(api.traceability.createLot, { harvestId, weightKg: 0.01, lotCode: 'EXPORT-1' })),
    ).toMatchObject({ code: expect.stringMatching(/DUPLICATE|VALIDATION/) })

    await asStaff.mutation(api.traceability.createDispatch, {
      harvestLotId: a.id,
      dispatchDate: '2026-05-11',
      weightKg: 600,
      customerId: ids.customerId,
      vehicle: 'GT-1234-26',
      temperatureC: 2.5,
    })
    expect(
      await errorOf(
        asStaff.mutation(api.traceability.createDispatch, {
          harvestLotId: a.id,
          dispatchDate: '2026-05-11',
          weightKg: 500,
          customerName: 'Walk-in',
        }),
      ),
    ).toMatchObject({ code: 'VALIDATION' })

    const lots = await as.query(api.traceability.listLots, { harvestId })
    expect(lots.find((l) => l.id === a.id)).toMatchObject({ dispatched_kg: 600, remaining_kg: 400, batch_id: childInC5 })

    const report = await as.query(api.traceability.lotReport, { lotId: a.id })
    expect(report!.trace!.origins).toEqual([expect.objectContaining({ source: 'Volta Hatchery', stocked_count: 6000 })])
    expect(report!.trace!.journey.map((s) => s.kind)).toEqual(['stocked', 'graded', 'harvested'])
    expect(report!.trace!.treatments).toEqual([
      expect.objectContaining({ product_name: 'Oxytetracycline', cage_name: 'C1', withdrawal_until: '2026-04-30' }),
    ])
    const feed = report!.trace!.feed
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ feed_type: 'Grower 4mm', kg_fed: 90, first_fed: '2026-01-10', last_fed: '2026-02-10' })
    // FIFO candidates: the lot in stock at first feeding and lots received until the last one.
    expect(feed[0].lots.map((l) => l.lot_number)).toEqual(['FL-1', 'FL-2'])
    expect(feed[0].lots[0]).toMatchObject({ supplier: 'Raanan', po_number: 'PO-0007' })
    expect(report!.dispatches).toEqual([
      expect.objectContaining({ customer_name: 'Accra Market', weight_kg: 600, vehicle: 'GT-1234-26' }),
    ])
    expect(report!.withdrawal_clear_at_harvest).toBe(true)

    const trace = await as.query(api.traceability.batchTrace, { batchId: childInC5 })
    expect(trace!.lots).toHaveLength(2)
    expect(trace!.batches).toHaveLength(2)

    expect(await asOutsider.query(api.traceability.lotReport, { lotId: a.id })).toBeNull()
    expect(await asOutsider.query(api.traceability.batchTrace, { batchId: childInC5 })).toBeNull()
    await expect(
      asOutsider.mutation(api.traceability.createDispatch, {
        harvestLotId: a.id,
        dispatchDate: '2026-05-12',
        customerName: 'Thief',
      }),
    ).rejects.toThrow(/not found/)
    await expect(asStaff.mutation(api.traceability.removeLot, { id: a.id })).rejects.toThrow(/permission/i)
    expect(await errorOf(as.mutation(api.traceability.removeLot, { id: a.id }))).toMatchObject({ code: 'CONFLICT' })
  })

  test('treatment history per batch includes the parent batch', async () => {
    const ctx = await setup()
    const { childInC5 } = await grownAndGraded(ctx)
    const rows = await ctx.as.query(api.traceability.batchTreatments, { batchId: childInC5 })
    expect(rows).toHaveLength(1)
    expect(rows![0].batch_number).not.toContain('-B')
  })
})

describe('M18 default harvest lots', () => {
  test('dry run reports, the real run creates one lot per harvest, and a rerun is a no-op', async () => {
    const { t, as, ids } = await setup()
    const stockingId = await as.mutation(api.stocking.createStocking, {
      cageId: ids.C5,
      stockingDate: '2026-01-01',
      fishCount: 1000,
      initialAbw: 20,
      initialBiomass: 20,
    })
    await as.mutation(api.stocking.approveStocking, { id: stockingId })
    await as.mutation(api.harvest.create, { ...harvestArgs(ids.C5, '2026-03-01'), estimatedCount: 1000 })

    const dry = await t.mutation(internal.migrations.m18DefaultHarvestLots, {})
    expect(dry).toMatchObject({ dryRun: true, count: 1 })
    expect(await t.run((c) => c.db.query('harvestLots').collect())).toHaveLength(0)

    const run = await t.mutation(internal.migrations.m18DefaultHarvestLots, { dryRun: false })
    expect(run).toMatchObject({ count: 1, isDone: true })
    const lots = await t.run((c) => c.db.query('harvestLots').collect())
    expect(lots[0]).toMatchObject({ weightKg: 1800, backfilled: true })

    expect(await t.mutation(internal.migrations.m18DefaultHarvestLots, { dryRun: false })).toMatchObject({ count: 0 })
  })
})
