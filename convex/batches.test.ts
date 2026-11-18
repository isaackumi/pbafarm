/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { eventsForUnit } from './lib/productionEngine'

const modules = import.meta.glob('./**/*.ts')

/** Multi-destination transfer, grading, cage history and batch page (PROD-006, TRACE-001). */
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
        status: 'empty',
        currentCount: 0,
        capacity: 100000,
        companyId,
        updatedAt: Date.now(),
      })
    const cages = {
      C1: await cage('C1'),
      C2: await cage('C2'),
      C3: await cage('C3'),
      C4: await cage('C4'),
      C5: await cage('C5'),
    }
    return { companyId, adminId, staffId, outsiderId, cages }
  })
  const as = t.withIdentity({ subject: `${ids.adminId}|s` })
  const asStaff = t.withIdentity({ subject: `${ids.staffId}|s` })
  const asOutsider = t.withIdentity({ subject: `${ids.outsiderId}|s` })
  const stock = async (cageId: Id<'cages'>, fishCount: number, date: string) => {
    const id = await as.mutation(api.stocking.createStocking, {
      cageId,
      stockingDate: date,
      fishCount,
      initialAbw: 20,
      initialBiomass: (fishCount * 20) / 1000,
    })
    await as.mutation(api.stocking.approveStocking, { id })
    return id
  }
  const counts = () =>
    t.run(async (ctx) => {
      const out: Record<string, [number, number]> = {}
      for (const [k, id] of Object.entries(ids.cages)) {
        const cage = (await ctx.db.get(id))!
        out[k] = [cage.currentCount ?? 0, (await eventsForUnit(ctx, id)).reduce((s, e) => s + e.qtyDelta, 0)]
      }
      return out
    })
  return { t, as, asStaff, asOutsider, ids, stock, counts }
}

describe('multi-destination transfer', () => {
  test('moves fish to three cages in one operation, conserving fish, and keeps cycle rows', async () => {
    const { t, as, ids, stock, counts } = await setup()
    await stock(ids.cages.C1, 10_000, '2026-01-01')
    await stock(ids.cages.C4, 1000, '2026-01-02')
    const r = await as.mutation(api.batches.transferGroup, {
      sourceCageId: ids.cages.C1,
      transferDate: '2026-03-01',
      lines: [
        { destinationCageId: ids.cages.C2, quantity: 2000, abw: 150 },
        { destinationCageId: ids.cages.C3, quantity: 2000, abw: 150 },
        { destinationCageId: ids.cages.C4, quantity: 1500, abw: 150 },
      ],
    })
    expect(r.ids).toHaveLength(3)
    expect(await counts()).toMatchObject({
      C1: [4500, 4500],
      C2: [2000, 2000],
      C3: [2000, 2000],
      C4: [2500, 2500],
    })
    const rows = await t.run(async (ctx) => Promise.all(r.ids.map((id) => ctx.db.get(id))))
    expect(rows.map((x) => x!.mode)).toEqual(['move', 'move', 'merge'])
    expect(new Set(rows.map((x) => x!.transferGroupId)).size).toBe(1)
    const c2 = await t.run(async (ctx) => (await ctx.db.get(ids.cages.C2))!)
    expect(c2.status).toBe('active')
    expect(c2.initialAbw).toBe(150)

    // A later daily record on C2 dual-writes onto the moved batch.
    await as.mutation(api.dailyRecords.createBatch, {
      date: '2026-03-05',
      records: [{ cageId: ids.cages.C2, feedAmount: 0, mortality: 10 }],
    })
    expect((await counts()).C2).toEqual([1990, 1990])

    // One line can be reversed on its own.
    await as.mutation(api.fishTransfers.reverseFishTransfer, { id: r.ids[1], reason: 'Wrong cage' })
    expect(await counts()).toMatchObject({ C1: [6500, 6500], C3: [0, 0] })
  })

  test('refuses lines that together exceed the source, non-admins, and cages without a ledger', async () => {
    const { t, as, asStaff, ids, stock } = await setup()
    await stock(ids.cages.C1, 1000, '2026-01-01')
    const lines = [
      { destinationCageId: ids.cages.C2, quantity: 600, abw: 50 },
      { destinationCageId: ids.cages.C3, quantity: 600, abw: 50 },
    ]
    await expect(
      as.mutation(api.batches.transferGroup, { sourceCageId: ids.cages.C1, transferDate: '2026-02-01', lines }),
    ).rejects.toThrow(/more than the 1,000/)
    await expect(
      asStaff.mutation(api.batches.transferGroup, {
        sourceCageId: ids.cages.C1,
        transferDate: '2026-02-01',
        lines: lines.slice(0, 1),
      }),
    ).rejects.toThrow(/Insufficient permissions/)
    await t.run((ctx) => ctx.db.patch(ids.cages.C5, { currentCount: 500, status: 'active' }))
    await expect(
      as.mutation(api.batches.transferGroup, {
        sourceCageId: ids.cages.C5,
        transferDate: '2026-02-01',
        lines: [{ destinationCageId: ids.cages.C2, quantity: 100, abw: 50 }],
      }),
    ).rejects.toThrow(/has not been built yet/)
  })
})

describe('grading', () => {
  test('splits a cage into child batches with lineage; the batch and cage views show it', async () => {
    const { as, asOutsider, ids, stock, counts } = await setup()
    await stock(ids.cages.C1, 6700, '2026-01-01')
    const g = await as.mutation(api.batches.grade, {
      cageId: ids.cages.C1,
      date: '2026-04-15',
      outputs: [
        { cageId: ids.cages.C1, quantity: 2500, abw: 260 },
        { cageId: ids.cages.C5, quantity: 4100, abw: 180 },
      ],
      culls: 100,
    })
    expect(g.childBatchIds).toHaveLength(2)
    expect(g.unaccounted).toBe(0)
    expect(await counts()).toMatchObject({ C1: [2500, 2500], C5: [4100, 4100] })

    const child = await as.query(api.batches.get, { id: g.childBatchIds[1], asOf: '2026-04-20' })
    expect(child!.origin).toBe('grading_split')
    expect(child!.parents).toHaveLength(1)
    expect(child!.occupancies).toEqual([expect.objectContaining({ cage_name: 'C5', count: 4100 })])
    const parent = await as.query(api.batches.get, { id: child!.parents[0].id, asOf: '2026-04-20' })
    expect(parent!.descendants.map((d) => d.batch_number).sort()).toEqual(
      [`${parent!.batch_number}-A`, `${parent!.batch_number}-B`].sort(),
    )
    expect(parent!.status).toBe('closed')
    expect(parent!.totals).toMatchObject({ stocked: 6700, mortality: 100, moved_out: 6600, count: 0 })

    // Later deaths in C1 land on the child batch now in the cage.
    await as.mutation(api.dailyRecords.createBatch, {
      date: '2026-04-20',
      records: [{ cageId: ids.cages.C1, feedAmount: 0, mortality: 50 }],
    })
    expect((await counts()).C1).toEqual([2450, 2450])

    const history = await as.query(api.batches.forCage, { cageId: ids.cages.C1, asOf: '2026-03-01' })
    expect(history).toMatchObject({ in_step: true, ledger_count: 2450, as_of: { count: 6700 } })
    expect(history!.occupancies.map((o) => o.count)).toEqual([2450, 0])
    expect(history!.events[0]).toMatchObject({ label: 'Deaths', qty: -50 })

    expect(await asOutsider.query(api.batches.get, { id: g.childBatchIds[0] })).toBeNull()
    expect(await asOutsider.query(api.batches.forCage, { cageId: ids.cages.C1 })).toBeNull()
  })
})

describe('cage growth reads the ledger', () => {
  test('a transfer out no longer distorts eFCR or survival', async () => {
    const { as, ids, stock } = await setup()
    await stock(ids.cages.C1, 10_000, '2026-01-01')
    await as.mutation(api.dailyRecords.createBatch, {
      date: '2026-02-01',
      records: [{ cageId: ids.cages.C1, feedAmount: 0, mortality: 300 }],
    })
    await as.mutation(api.biweeklyRecords.create, {
      cageId: ids.cages.C1,
      date: '2026-02-25',
      batchCode: 'S1',
      averageBodyWeight: 150,
      totalFishCount: 100,
      totalWeight: 15,
    })
    const tr = await as.mutation(api.fishTransfers.createFishTransfer, {
      sourceCageId: ids.cages.C1,
      destinationCageId: ids.cages.C2,
      transferDate: '2026-03-01',
      quantity: 3000,
      abw: 150,
    })
    await as.mutation(api.fishTransfers.approveFishTransfer, { id: tr })
    const g = await as.query(api.cages.growth, { id: ids.cages.C1, asOf: '2026-03-01' })
    expect(g).toMatchObject({ source: 'ledger', live_count: 6700, stocked_count: 10_000, mortality: 300 })
    // (6,700 + 3,000 moved out) ÷ 10,000: the transfer is not a loss.
    expect(g!.survival_pct).toBe(97)
    // gain = 6,700 × 0.15 + 450 out − 200 stocked = 1,255 kg
    expect((g as any).gain_kg).toBe(1255)
  })
})
