/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { Id } from './_generated/dataModel'
import * as engine from './lib/productionEngine'

const modules = import.meta.glob('./**/*.ts')

/**
 * Property tests for the production engine (roadmap Phase 4 "Testing"):
 * random but valid operation sequences, checked after every step against a
 * plain in-memory model.
 *
 * - Conservation: internal moves (transfer, merge, grading) never create or
 *   destroy fish; Σ events of the farm changes only by stock-ins, deaths,
 *   harvests and adjustments.
 * - Cache: for every cage, `currentCount` = Σ qtyDelta of its events.
 * - Reversal idempotence: reversing an event twice equals reversing it once.
 * - No cross-cycle effects: corrections to a closed batch never change the
 *   batch that is in the cage now.
 */

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dateOf = (day: number) =>
  new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().slice(0, 10)

async function farm() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'P',
      code: 'P',
      status: 'approved',
      createdAt: Date.now(),
    })
    const cages: Id<'cages'>[] = []
    for (let i = 0; i < 4; i++) {
      cages.push(
        await ctx.db.insert('cages', {
          name: `P${i}`,
          status: 'empty',
          currentCount: 0,
          companyId,
          updatedAt: Date.now(),
        }),
      )
    }
    return { companyId, cages }
  })
  return { t, ...ids, opts: { companyId: ids.companyId } }
}

type Model = Map<string, { batchId: Id<'batches'>; count: number }>

async function checkInvariants(
  f: Awaited<ReturnType<typeof farm>>,
  model: Model,
  expectedFarmTotal: number,
) {
  await f.t.run(async (ctx) => {
    let farmTotal = 0
    for (const cageId of f.cages) {
      const cage = (await ctx.db.get(cageId))!
      const events = await engine.eventsForUnit(ctx, cageId)
      const ledger = events.reduce((s, e) => s + e.qtyDelta, 0)
      expect(cage.currentCount).toBe(ledger)
      expect(ledger).toBe(model.get(String(cageId))?.count ?? 0)
      expect(ledger).toBeGreaterThanOrEqual(0)
      // I4: at most one batch with fish in a cage.
      const byBatch = new Map<string, number>()
      for (const e of events) byBatch.set(String(e.batchId), (byBatch.get(String(e.batchId)) ?? 0) + e.qtyDelta)
      expect([...byBatch.values()].filter((n) => n > 0).length).toBeLessThanOrEqual(1)
      farmTotal += ledger
    }
    expect(farmTotal).toBe(expectedFarmTotal)
  })
}

describe('production engine properties', () => {
  for (const seed of [1, 7, 42, 2026]) {
    test(`random operations keep the ledger, caches and model in step (seed ${seed})`, async () => {
      const f = await farm()
      const r = rng(seed)
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
      const model: Model = new Map()
      let total = 0
      let day = 0
      let n = 0
      const reversible: Array<{ id: Id<'stockEvents'>; unit: string; qty: number; gen: number }> = []
      // Bumped whenever a cage empties, so only deaths of the occupancy still there are reversed.
      const gen = new Map<string, number>()
      const genOf = (c: Id<'cages'>) => gen.get(String(c)) ?? 0

      for (let step = 0; step < 40; step++) {
        day += 1 + Math.floor(r() * 3)
        const date = dateOf(day)
        const occupied = f.cages.filter((c) => (model.get(String(c))?.count ?? 0) > 0)
        const empty = f.cages.filter((c) => !model.get(String(c)) || model.get(String(c))!.count === 0)
        const kind = pick(['stock', 'mortality', 'transfer', 'partial', 'complete', 'adjust', 'reverse'])
        if (kind === 'stock' || occupied.length === 0) {
          if (!empty.length) continue
          const cage = pick(empty)
          const qty = 500 + Math.floor(r() * 5000)
          const batchId = await f.t.run(async (ctx) => {
            const b = await engine.openBatch(ctx, f.opts, { batchNumber: `B${seed}-${step}`, origin: 'stocking', openedOn: date })
            await engine.stockIn(ctx, f.opts, { sourceTable: 'stockingHistory', sourceId: `s${step}` }, {
              unitId: cage,
              batchId: b,
              qty,
              abwG: 10,
              date,
            })
            return b
          })
          model.set(String(cage), { batchId, count: qty })
          total += qty
        } else if (kind === 'mortality') {
          const cage = pick(occupied)
          const m = model.get(String(cage))!
          const qty = 1 + Math.floor(r() * Math.min(200, m.count))
          const res = await f.t.run((ctx) =>
            engine.recordMortality(ctx, f.opts, { sourceTable: 'dailyRecords', sourceId: `d${step}` }, { unitId: cage, qty, date }),
          )
          reversible.push({ id: res.eventIds[0], unit: String(cage), qty: -qty, gen: genOf(cage) })
          m.count -= qty
          total -= qty
        } else if (kind === 'transfer') {
          const cage = pick(occupied)
          const m = model.get(String(cage))!
          const dests = f.cages.filter((c) => c !== cage).slice(0, 1 + Math.floor(r() * 3))
          const lines = dests.map((d) => ({ d, qty: 1 + Math.floor(r() * Math.max(1, m.count / (dests.length + 1))) }))
          if (lines.reduce((s, l) => s + l.qty, 0) > m.count) continue
          await f.t.run((ctx) =>
            engine.transfer(
              ctx,
              f.opts,
              lines.map((l) => ({
                src: { sourceTable: 'fishTransfers' as const, sourceId: `t${step}-${String(l.d)}` },
                sourceUnitId: cage,
                destinationUnitId: l.d,
                qty: l.qty,
                abwG: 50,
                date,
              })),
            ),
          )
          for (const l of lines) {
            m.count -= l.qty
            const dm = model.get(String(l.d))
            // Into an occupied cage the fish join the batch there; into an empty one the batch moves.
            if (dm && dm.count > 0) dm.count += l.qty
            else model.set(String(l.d), { batchId: m.batchId, count: l.qty })
          }
          // conservation: total unchanged
        } else if (kind === 'partial' || kind === 'complete') {
          const cage = pick(occupied)
          const m = model.get(String(cage))!
          const qty = kind === 'complete' ? Math.max(0, m.count - Math.floor(r() * 50)) : 1 + Math.floor(r() * (m.count - 1 || 1))
          if (kind === 'partial' && qty >= m.count) continue
          await f.t.run((ctx) =>
            engine.harvest(ctx, f.opts, { sourceTable: 'harvestRecords', sourceId: `h${step}` }, {
              unitId: cage,
              qty,
              kg: qty * 0.3,
              date,
              complete: kind === 'complete',
            }),
          )
          total -= kind === 'complete' ? m.count : qty
          m.count = kind === 'complete' ? 0 : m.count - qty
        } else if (kind === 'adjust') {
          const cage = pick(occupied)
          const m = model.get(String(cage))!
          const delta = Math.floor(r() * 21) - 10 || 1
          if (m.count + delta < 0) continue
          await f.t.run((ctx) =>
            engine.adjustCount(ctx, f.opts, { sourceTable: 'stockOperations', sourceId: `a${step}` }, {
              unitId: cage,
              qtyDelta: delta,
              date,
              reason: 'physical count',
            }),
          )
          m.count += delta
          total += delta
        } else if (kind === 'reverse') {
          // Only reverse a death still in the open occupancy, so the model stays simple.
          const candidates = reversible.filter(
            (x) => (model.get(x.unit)?.count ?? 0) > 0 && (gen.get(x.unit) ?? 0) === x.gen,
          )
          if (!candidates.length) continue
          const target = pick(candidates)
          reversible.splice(reversible.indexOf(target), 1)
          const first = await f.t.run((ctx) => engine.reverse(ctx, f.opts, target.id, 'property test'))
          // Reversing again changes nothing.
          const again = await f.t.run((ctx) => engine.reverse(ctx, f.opts, target.id, 'property test'))
          expect(again.alreadyReversed).toBe(true)
          expect(again.reversalId).toBe(first.reversalId)
          // A reversed death of a batch that left the cage would not be in this cage's model; skip those.
          const m = model.get(target.unit)!
          m.count -= target.qty
          total -= target.qty
        }
        for (const [k, v] of model) if (v.count === 0) gen.set(k, (gen.get(k) ?? 0) + 1)
        n++
        await checkInvariants(f, model, total)
      }
      expect(n).toBeGreaterThan(10)
    })
  }

  test('corrections to a closed batch never touch the batch now in the cage', async () => {
    const f = await farm()
    const [c] = f.cages
    const src = (t: engine.StockSourceTable, id: string) => ({ sourceTable: t, sourceId: id })
    const { old, current } = await f.t.run(async (ctx) => {
      const old = await engine.openBatch(ctx, f.opts, { batchNumber: 'OLD', origin: 'stocking', openedOn: '2026-01-01' })
      await engine.stockIn(ctx, f.opts, src('stockingHistory', 's1'), { unitId: c, batchId: old, qty: 1000, abwG: 10, date: '2026-01-01' })
      await engine.recordMortality(ctx, f.opts, src('dailyRecords', 'd1'), { unitId: c, qty: 40, date: '2026-01-10' })
      await engine.harvest(ctx, f.opts, src('harvestRecords', 'h1'), { unitId: c, qty: 900, kg: 300, date: '2026-03-01', complete: true })
      const current = await engine.openBatch(ctx, f.opts, { batchNumber: 'NEW', origin: 'stocking', openedOn: '2026-03-10' })
      await engine.stockIn(ctx, f.opts, src('stockingHistory', 's2'), { unitId: c, batchId: current, qty: 2000, abwG: 10, date: '2026-03-10' })
      return { old, current }
    })
    for (const [i, change] of [
      async (ctx: any) => engine.reverseOperation(ctx, f.opts, src('dailyRecords', 'd1'), 'deleted'),
      async (ctx: any) => engine.recordMortality(ctx, f.opts, src('dailyRecords', 'd2'), { unitId: c, batchId: old, qty: 15, date: '2026-02-01' }),
      async (ctx: any) => {
        const op = engine.beginOperation(ctx, f.opts)
        await op.reverseSource(src('harvestRecords', 'h1'), 'edit')
        await op.harvest(src('harvestRecords', 'h1'), { unitId: c, batchId: old, qty: 850, kg: 280, date: '2026-03-01', complete: true })
        return await op.commit()
      },
    ].entries()) {
      await f.t.run(change)
      const state = await f.t.run(async (ctx) => ({
        cage: (await ctx.db.get(c))!.currentCount,
        current: (await engine.eventsForPair(ctx, c, current)).reduce((s, e) => s + e.qtyDelta, 0),
        old: (await engine.eventsForPair(ctx, c, old)).reduce((s, e) => s + e.qtyDelta, 0),
      }))
      expect(state, `change ${i}`).toEqual({ cage: 2000, current: 2000, old: 0 })
    }
  })
})
