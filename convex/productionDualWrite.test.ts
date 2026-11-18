/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { activeEvents, eventsForSource, eventsForUnit } from './lib/productionEngine'

const modules = import.meta.glob('./**/*.ts')

/**
 * Dual-write (PROD-004): the existing mutations keep the legacy count and
 * post the same change to the stock ledger, so Σ events per cage equals
 * `cages.currentCount` through a whole cycle. Plus transfer reversal
 * (PROD-007), the M6/M7 backfill (PROD-001/003) and the nightly
 * reconciliation (PROD-005).
 */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
    })
    const userId = await ctx.db.insert('users', { email: 'admin@x.com', role: 'admin', companyId })
    const locationId = await ctx.db.insert('farmLocations', {
      companyId,
      name: 'Site A',
      active: true,
      updatedAt: Date.now(),
    })
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower',
      currentStock: 100000,
      minimumStock: 0,
      pricePerKg: 2,
      active: true,
      companyId,
      updatedAt: Date.now(),
    })
    const cage = (name: string) =>
      ctx.db.insert('cages', {
        name,
        status: 'empty',
        currentCount: 0,
        capacity: 100000,
        locationId,
        companyId,
        updatedAt: Date.now(),
      })
    return { companyId, userId, locationId, feedTypeId, A: await cage('A'), B: await cage('B'), C: await cage('C') }
  })
  const as = t.withIdentity({ subject: `${ids.userId}|s` })

  /** Σ events and currentCount for every cage. */
  const state = () =>
    t.run(async (ctx) => {
      const out: Record<string, { cage: number; ledger: number }> = {}
      for (const [k, id] of [['A', ids.A], ['B', ids.B], ['C', ids.C]] as const) {
        const cage = (await ctx.db.get(id))!
        const ledger = (await eventsForUnit(ctx, id)).reduce((s, e) => s + e.qtyDelta, 0)
        out[k] = { cage: cage.currentCount ?? 0, ledger }
      }
      return out
    })
  const expectInStep = async () => {
    const s = await state()
    for (const k of Object.keys(s)) expect(s[k].ledger, `cage ${k}`).toBe(s[k].cage)
    return s
  }

  const stock = async (cageId: Id<'cages'>, fishCount: number, date: string) => {
    const id = await as.mutation(api.stocking.createStocking, {
      cageId,
      stockingDate: date,
      fishCount,
      initialAbw: 10,
      initialBiomass: (fishCount * 10) / 1000,
    })
    await as.mutation(api.stocking.approveStocking, { id })
    return id
  }
  return { t, as, ids, state, expectInStep, stock }
}

/**
 * A whole cycle through every stock writer. Returns the counts after each
 * step so the cutover run can be compared with the legacy run.
 */
async function fullCycle() {
    const { t, as, ids, expectInStep: inStep, stock } = await setup()
    const trail: unknown[] = []
    const expectInStep = async () => {
      const st = await inStep()
      trail.push(st)
      return st
    }

    const stockingA = await stock(ids.A, 10_000, '2026-05-01')
    let s = await expectInStep()
    expect(s.A.cage).toBe(10_000)
    const stA = await t.run(async (ctx) => (await ctx.db.get(stockingA))!)
    expect(stA.batchId).toBeDefined()

    const topupId = await as.mutation(api.stocking.createTopup, {
      stockingId: stockingA,
      topupDate: '2026-05-10',
      fishCount: 500,
      abw: 12,
    })
    await as.mutation(api.stocking.approveTopup, { id: topupId })
    s = await expectInStep()
    expect(s.A.cage).toBe(10_500)

    const [dailyId] = await as.mutation(api.dailyRecords.createBatch, {
      date: '2026-05-15',
      records: [{ cageId: ids.A, feedAmount: 20, feedTypeId: ids.feedTypeId, mortality: 120 }],
    })
    s = await expectInStep()
    expect(s.A.cage).toBe(10_380)
    const daily = await t.run(async (ctx) => (await ctx.db.get(dailyId))!)
    expect(daily.batchId).toBe(stA.batchId)

    await as.mutation(api.dailyRecords.update, { id: dailyId, patch: { mortality: 80 } })
    s = await expectInStep()
    expect(s.A.cage).toBe(10_420)

    // Transfer into an empty cage (new stocking) and into an occupied one (top-up).
    await stock(ids.C, 3000, '2026-05-02')
    const t1 = await as.mutation(api.fishTransfers.createFishTransfer, {
      sourceCageId: ids.A,
      destinationCageId: ids.B,
      transferDate: '2026-06-01',
      quantity: 2000,
      abw: 80,
    })
    await as.mutation(api.fishTransfers.approveFishTransfer, { id: t1 })
    const t2 = await as.mutation(api.fishTransfers.createFishTransfer, {
      sourceCageId: ids.A,
      destinationCageId: ids.C,
      transferDate: '2026-06-02',
      quantity: 1000,
      abw: 80,
    })
    await as.mutation(api.fishTransfers.approveFishTransfer, { id: t2 })
    s = await expectInStep()
    expect([s.A.cage, s.B.cage, s.C.cage]).toEqual([7420, 2000, 4000])
    const lineage = await t.run(async (ctx) => {
      const tr = (await ctx.db.get(t1))!
      const dest = (await ctx.db.get(tr.destinationStockingId!))!
      return { child: (await ctx.db.get(dest.batchId!))!, source: tr.batchId }
    })
    expect(lineage.child.origin).toBe('transfer_split')
    expect(lineage.child.parentBatchIds).toEqual([lineage.source])

    // Reverse the merge-type transfer: fish go back to A.
    const rev = await as.mutation(api.fishTransfers.reverseFishTransfer, { id: t2, reason: 'Wrong cage' })
    expect(rev.ok).toBe(true)
    s = await expectInStep()
    expect([s.A.cage, s.C.cage]).toEqual([8420, 3000])
    await expect(
      as.mutation(api.fishTransfers.reverseFishTransfer, { id: t2, reason: 'again' }),
    ).rejects.toThrow(/already been reversed/)

    // Partial then complete harvest of A, then edits and deletes.
    const h1 = await as.mutation(api.harvest.create, {
      cageId: ids.A,
      harvestDate: '2026-07-01',
      averageBodyWeight: 300,
      totalWeight: 600,
      estimatedCount: 2000,
      fcr: 1.4,
      harvestType: 'partial',
    })
    s = await expectInStep()
    expect(s.A.cage).toBe(6420)
    const h2 = await as.mutation(api.harvest.create, {
      cageId: ids.A,
      harvestDate: '2026-07-20',
      averageBodyWeight: 350,
      totalWeight: 2170,
      estimatedCount: 6200,
      fcr: 1.5,
      harvestType: 'complete',
    })
    s = await expectInStep()
    expect(s.A.cage).toBe(0)
    const stored = await t.run(async (ctx) => (await ctx.db.get(h2.id))!)
    expect(stored.batchId).toBe(stA.batchId)
    expect(stored.fcrInputs?.method).toBe('complete')

    await as.mutation(api.harvest.update, { id: h2.id, patch: { estimatedCount: 6100 } })
    await expectInStep()
    await as.mutation(api.harvest.remove, { id: h2.id })
    s = await expectInStep()
    expect(s.A.cage).toBe(6420)
    await as.mutation(api.harvest.update, { id: h1.id, patch: { estimatedCount: 1900 } })
    s = await expectInStep()
    expect(s.A.cage).toBe(6520)

    await as.mutation(api.dailyRecords.remove, { id: dailyId })
    s = await expectInStep()
    expect(s.A.cage).toBe(6600)

    // A hand-corrected count becomes a labelled adjustment.
    await as.mutation(api.cages.update, { id: ids.A, patch: { currentCount: 6550 } })
    s = await expectInStep()
    expect(s.A.cage).toBe(6550)
    return { t, ids, trail }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('dual-write keeps the ledger in step with the cage count', () => {
  test('through stocking, top-up, deaths, transfers, harvests, edits and deletes', async () => {
    await fullCycle()
  })

  test('cutover (PROD-004): the engine-written counts equal the legacy computation at every step', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const engineRun = await fullCycle()
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('PROD-004'))).toEqual([])
    vi.stubEnv('PRODUCTION_ENGINE_CUTOVER', 'off')
    const legacyRun = await fullCycle()
    expect(engineRun.trail).toEqual(legacyRun.trail)
  })

  test('cutover: a cage whose count predates the ledger stays on the legacy count', async () => {
    const { t, as, ids } = await setup()
    // Stocked before the ledger existed: a count and a stocking, no events.
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.A, { currentCount: 800, status: 'active', stockingDate: '2026-01-01' })
      await ctx.db.insert('stockingHistory', {
        cageId: ids.A,
        batchNumber: 'OLD-1',
        stockingDate: '2026-01-01',
        fishCount: 800,
        initialAbw: 10,
        initialBiomass: 8,
        status: 'approved',
        companyId: ids.companyId,
      })
    })
    const [d] = await as.mutation(api.dailyRecords.createBatch, {
      date: '2026-02-01',
      records: [{ cageId: ids.A, feedAmount: 0, mortality: 30 }],
    })
    expect((await t.run((ctx) => ctx.db.get(ids.A)))!.currentCount).toBe(770)
    await as.mutation(api.dailyRecords.remove, { id: d })
    expect((await t.run((ctx) => ctx.db.get(ids.A)))!.currentCount).toBe(800)
  })

  test('cutover: the engine refuses a change that would take a cage below zero fish', async () => {
    const { t, as, ids, stock } = await setup()
    await stock(ids.A, 1000, '2026-03-01')
    await expect(
      as.mutation(api.harvest.create, {
        cageId: ids.A,
        harvestDate: '2026-04-01',
        averageBodyWeight: 300,
        totalWeight: 360,
        estimatedCount: 1200,
        harvestType: 'partial',
      }),
    ).rejects.toThrow()
    expect((await t.run((ctx) => ctx.db.get(ids.A)))!.currentCount).toBe(1000)
  })

  test('an old daily record edited after harvest and restock changes neither cycle’s live count', async () => {
    const { t, as, ids, expectInStep, stock } = await setup()
    await stock(ids.A, 1000, '2026-03-01')
    const [d] = await as.mutation(api.dailyRecords.createBatch, {
      date: '2026-03-10',
      records: [{ cageId: ids.A, feedAmount: 0, mortality: 20 }],
    })
    await as.mutation(api.harvest.create, {
      cageId: ids.A,
      harvestDate: '2026-05-01',
      averageBodyWeight: 300,
      totalWeight: 291,
      estimatedCount: 970,
      fcr: 1.5,
      harvestType: 'complete',
    })
    await stock(ids.A, 5000, '2026-05-10')
    await as.mutation(api.dailyRecords.update, { id: d, patch: { mortality: 5 } })
    const s = await expectInStep()
    expect(s.A.cage).toBe(5000)
    const closeouts = await t.run(async (ctx) =>
      activeEvents(await eventsForUnit(ctx, ids.A)).filter((e) => e.component === 'closeout'),
    )
    // 1,000 − 5 deaths − 970 harvested: 25 unaccounted at harvest.
    expect(closeouts.map((e) => e.qtyDelta)).toEqual([-25])
  })

  test('transfer reversal is refused once the source has been harvested', async () => {
    const { as, ids, stock } = await setup()
    await stock(ids.A, 1000, '2026-03-01')
    const tr = await as.mutation(api.fishTransfers.createFishTransfer, {
      sourceCageId: ids.A,
      destinationCageId: ids.B,
      transferDate: '2026-04-01',
      quantity: 300,
      abw: 50,
    })
    await as.mutation(api.fishTransfers.approveFishTransfer, { id: tr })
    await as.mutation(api.harvest.create, {
      cageId: ids.A,
      harvestDate: '2026-05-01',
      averageBodyWeight: 300,
      totalWeight: 210,
      estimatedCount: 700,
      fcr: 1.5,
      harvestType: 'complete',
    })
    await expect(
      as.mutation(api.fishTransfers.reverseFishTransfer, { id: tr, reason: 'late' }),
    ).rejects.toThrow(/harvested or restocked/)
  })
})

describe('M6/M7 backfill and reconciliation', () => {
  /** Legacy rows written before the engine: no batches, no events, a drifted count. */
  async function legacy() {
    const s = await setup()
    const ids = await s.t.run(async (ctx) => {
      const base = { companyId: s.ids.companyId, locationId: s.ids.locationId }
      await ctx.db.patch(s.ids.A, { status: 'active', currentCount: 8930, stockingDate: '2026-01-01' })
      const stA = await ctx.db.insert('stockingHistory', {
        cageId: s.ids.A,
        batchNumber: 'A-0101',
        stockingDate: '2026-01-01',
        fishCount: 10_000,
        initialAbw: 10,
        initialBiomass: 100,
        status: 'approved',
        ...base,
      })
      for (const [date, mortality] of [['2026-01-10', 30], ['2026-01-20', 40]] as const) {
        await ctx.db.insert('dailyRecords', {
          cageId: s.ids.A,
          date,
          feedAmount: 0,
          feedPrice: 0,
          feedCost: 0,
          mortality,
          ...base,
        })
      }
      await ctx.db.insert('harvestRecords', {
        cageId: s.ids.A,
        harvestDate: '2026-03-01',
        averageBodyWeight: 200,
        totalWeight: 200,
        estimatedCount: 1000,
        fcr: 1.2,
        harvestType: 'partial',
        ...base,
      })
      // B: harvested out completely with 50 fish unaccounted.
      await ctx.db.patch(s.ids.B, { status: 'harvested', currentCount: 0 })
      await ctx.db.insert('stockingHistory', {
        cageId: s.ids.B,
        batchNumber: 'B-0101',
        stockingDate: '2026-01-05',
        fishCount: 2000,
        initialAbw: 10,
        initialBiomass: 20,
        status: 'approved',
        closedAt: '2026-04-01',
        ...base,
      })
      await ctx.db.insert('harvestRecords', {
        cageId: s.ids.B,
        harvestDate: '2026-04-01',
        averageBodyWeight: 300,
        totalWeight: 585,
        estimatedCount: 1950,
        fcr: 1.3,
        harvestType: 'complete',
        ...base,
      })
      return { stA }
    })
    return { ...s, ...ids }
  }

  const runM7 = async (t: Awaited<ReturnType<typeof setup>>['t'], dryRun: boolean) => {
    const out = []
    for (const phase of ['events', 'closeouts', 'reconcile'] as const) {
      out.push(await t.mutation(internal.productionBackfill.m7StockEvents, { dryRun, phase, cagesPerRun: 50 }))
    }
    return out
  }

  test('dry runs write nothing; the real run makes Σ events equal every cage count', async () => {
    const { t, ids, stA } = await legacy()

    const m6dry = await t.mutation(internal.productionBackfill.m6Batches, {})
    expect(m6dry).toMatchObject({ dryRun: true, count: 2 })
    const [eventsDry] = await runM7(t, true)
    expect(eventsDry.cages.find((c: any) => c.cage === 'A')).toMatchObject({
      planned: { stock_in: 1, mortality: 2, harvest: 1 },
    })
    expect(await t.run(async (ctx) => (await ctx.db.query('stockEvents').take(1)).length)).toBe(0)
    expect(await t.run(async (ctx) => (await ctx.db.query('batches').take(1)).length)).toBe(0)

    await t.mutation(internal.productionBackfill.m6Batches, { dryRun: false })
    const st = await t.run(async (ctx) => (await ctx.db.get(stA))!)
    expect(st.batchId).toBeDefined()

    const [, closeouts, reconcile] = await runM7(t, false)
    // B: 2,000 stocked − 1,950 harvested → close-out −50.
    expect(closeouts.cages).toEqual([
      expect.objectContaining({ cage: 'B', closeouts: [expect.objectContaining({ closeout: -50 })] }),
    ])
    // A: 10,000 − 70 − 1,000 = 8,930 on the ledger = the cage count; nothing to reconcile.
    expect(reconcile.cages).toEqual([])

    const after = await t.run(async (ctx) => {
      const out: Record<string, number[]> = {}
      for (const [k, id] of [['A', ids.A], ['B', ids.B], ['C', ids.C]] as const) {
        const cage = (await ctx.db.get(id))!
        out[k] = [cage.currentCount ?? 0, (await eventsForUnit(ctx, id)).reduce((s, e) => s + e.qtyDelta, 0)]
      }
      return out
    })
    expect(after).toEqual({ A: [8930, 8930], B: [0, 0], C: [0, 0] })

    // Idempotent: a second run posts nothing new.
    const before = await t.run(async (ctx) => (await ctx.db.query('stockEvents').take(1000)).length)
    await runM7(t, false)
    expect(await t.run(async (ctx) => (await ctx.db.query('stockEvents').take(1000)).length)).toBe(before)
  })

  test('a drifted count gets one labelled reconciliation adjustment', async () => {
    const { t, ids } = await legacy()
    await t.run((ctx) => ctx.db.patch(ids.A, { currentCount: 8900 }))
    await t.mutation(internal.productionBackfill.m6Batches, { dryRun: false })
    const [, , reconcile] = await runM7(t, false)
    expect(reconcile.cages).toEqual([expect.objectContaining({ cage: 'A', legacy: 8900, ledger: 8930, diff: -30 })])
    const adj = await t.run(async (ctx) =>
      activeEvents(await eventsForSource(ctx, { sourceTable: 'legacyBackfill', sourceId: `cage:${ids.A}` })),
    )
    expect(adj.map((e) => [e.type, e.qtyDelta, e.reason])).toEqual([['count_adjustment', -30, 'Legacy reconciliation']])
    // Re-running replaces nothing when already reconciled.
    const again = await t.mutation(internal.productionBackfill.m7StockEvents, { dryRun: false, phase: 'reconcile' })
    expect(again.cages).toEqual([expect.objectContaining({ cage: 'A', changed: false })])
  })

  test('the nightly reconciliation notifies admins once about mismatches', async () => {
    const { t, ids } = await legacy()
    // A has fish and no ledger yet → mismatch.
    const r1 = await t.mutation(internal.reconciliation.run, { date: '2026-11-18' })
    expect(r1).toMatchObject({ done: true, total: 1, notified: 1 })
    const r2 = await t.mutation(internal.reconciliation.run, { date: '2026-11-18' })
    expect(r2).toMatchObject({ notified: 0 })
    const notes = await t.run((ctx) =>
      ctx.db.query('notifications').withIndex('by_user', (q) => q.eq('userId', ids.userId)).take(10),
    )
    expect(notes).toHaveLength(1)
    expect(notes[0].message).toMatch(/1 cage differs from the stock ledger: A \(cage 8,930, ledger 0\)/)
  })
})

describe('harvest FCR is computed from the ledger and kept current (PROD-009)', () => {
  test('previewed in the form, stored on save, recomputed when feed or stocking change', async () => {
    const { t, as, ids, stock } = await setup()
    // 1,000 fish at 10 g: 10 kg stocked.
    const stockingId = await stock(ids.A, 1000, '2026-03-01')
    const [d] = await as.mutation(api.dailyRecords.createBatch, {
      date: '2026-03-10',
      records: [{ cageId: ids.A, feedAmount: 290, feedTypeId: ids.feedTypeId, mortality: 0 }],
    })
    const harvest = { cageId: ids.A, harvestDate: '2026-04-01', totalWeight: 300, estimatedCount: 1000 }

    // The form shows the computed value with its inputs before saving.
    const preview = await as.query(api.harvest.suggestFcr, { ...harvest, harvestType: 'complete' })
    expect(preview).toMatchObject({ source: 'ledger', method: 'complete', feed_kg: 290, gain_kg: 290, fcr: 1 })

    // A typed FCR is not needed; the stored value comes from the ledger.
    const { id } = await as.mutation(api.harvest.create, {
      ...harvest,
      averageBodyWeight: 300,
      harvestType: 'complete',
    })
    const fcr = async () => (await t.run((ctx) => ctx.db.get(id)))!.fcr
    expect(await fcr()).toBe(1)

    await as.mutation(api.dailyRecords.update, { id: d, patch: { feedAmount: 580 } })
    expect(await fcr()).toBe(2)

    // 1,000 fish at 60 g: 60 kg stocked, so 240 kg gained.
    await as.mutation(api.stocking.updateStocking, { id: stockingId, patch: { initialAbw: 60, initialBiomass: 60 } })
    expect(await fcr()).toBeCloseTo(580 / 240, 2)

    await as.mutation(api.dailyRecords.remove, { id: d })
    expect(await fcr()).toBe(0)
  })

  test('suggestFcr says nothing about another company’s cage', async () => {
    const { t, ids } = await setup()
    const outsider = await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        name: 'Other',
        code: 'OTH',
        status: 'approved',
        createdAt: Date.now(),
      })
      return await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId })
    })
    const other = t.withIdentity({ subject: `${outsider}|s` })
    expect(
      await other.query(api.harvest.suggestFcr, { cageId: ids.A, harvestDate: '2026-04-01', totalWeight: 300 }),
    ).toBeNull()
  })
})
