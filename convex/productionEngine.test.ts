/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import * as engine from './lib/productionEngine'
import { occupancyKpis } from './lib/kpi'

const modules = import.meta.glob('./**/*.ts')

/**
 * The eight stock scenarios of docs/architecture/05 §7, run against the
 * engine, plus the invariants of §5. Dates are the doc's, moved to 2026.
 */

type Ids = {
  companyId: Id<'companies'>
  otherCompanyId: Id<'companies'>
  userId: Id<'users'>
  locationId: Id<'farmLocations'>
  c: Record<'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'X1', Id<'cages'>>
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids: Ids = await t.run(async (ctx) => {
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
    const userId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const locationId = await ctx.db.insert('farmLocations', {
      companyId,
      name: 'S1',
      active: true,
      updatedAt: Date.now(),
    })
    const cage = (name: string, company = companyId) =>
      ctx.db.insert('cages', {
        name,
        status: 'empty',
        currentCount: 0,
        locationId: company === companyId ? locationId : undefined,
        companyId: company,
        updatedAt: Date.now(),
      })
    return {
      companyId,
      otherCompanyId,
      userId,
      locationId,
      c: {
        C1: await cage('C1'),
        C2: await cage('C2'),
        C3: await cage('C3'),
        C4: await cage('C4'),
        C5: await cage('C5'),
        X1: await cage('X1', otherCompanyId),
      },
    }
  })
  const opts = { companyId: ids.companyId, userId: ids.userId }
  const run = <T>(fn: (ctx: MutationCtx) => Promise<T>) => t.run(fn)
  const src = (sourceTable: engine.StockSourceTable, sourceId: string) => ({ sourceTable, sourceId })

  const count = (unitId: Id<'cages'>) => run(async (ctx) => (await ctx.db.get(unitId))!.currentCount)
  const ledger = (unitId: Id<'cages'>, batchId?: Id<'batches'>) =>
    run(async (ctx) => {
      const ev = batchId
        ? await engine.eventsForPair(ctx, unitId, batchId)
        : await engine.eventsForUnit(ctx, unitId)
      return ev.reduce((s, e) => s + e.qtyDelta, 0)
    })
  const batchTotal = (batchId: Id<'batches'>) =>
    run(async (ctx) => (await engine.eventsForBatch(ctx, batchId)).reduce((s, e) => s + e.qtyDelta, 0))

  /** B1 stocked into C1 on 01-01: 10,000 fish at 20 g; 300 deaths; sample 150 g on 02-25. */
  async function base() {
    return await run(async (ctx) => {
      const b1 = await engine.openBatch(ctx, opts, {
        batchNumber: 'TL-0101',
        origin: 'stocking',
        openedOn: '2026-01-01',
        speciesCode: 'nile_tilapia',
      })
      await engine.stockIn(ctx, opts, src('stockingHistory', 'S1'), {
        unitId: ids.c.C1,
        batchId: b1,
        qty: 10_000,
        abwG: 20,
        date: '2026-01-01',
      })
      await engine.recordMortality(ctx, opts, src('dailyRecords', 'D0'), {
        unitId: ids.c.C1,
        qty: 300,
        date: '2026-02-01',
      })
      await ctx.db.insert('biweeklyRecords', {
        cageId: ids.c.C1,
        date: '2026-02-25',
        batchCode: 'TL-0101',
        averageBodyWeight: 150,
        totalFishCount: 100,
        totalWeight: 15,
        batchId: b1,
        companyId: ids.companyId,
        updatedAt: Date.now(),
      })
      return b1
    })
  }

  return { t, ids, opts, run, src, count, ledger, batchTotal, base }
}

describe('7.1 partial transfer to an empty cage', () => {
  test('moves the batch, credits moved-out biomass in eFCR, and can be reversed', async () => {
    const { ids, opts, run, src, count, batchTotal, base } = await setup()
    const b1 = await base()
    await run((ctx) =>
      engine.transfer(ctx, opts, [
        {
          src: src('fishTransfers', 'T1'),
          sourceUnitId: ids.c.C1,
          destinationUnitId: ids.c.C2,
          qty: 3000,
          abwG: 150,
          date: '2026-03-01',
        },
      ]),
    )
    expect(await count(ids.c.C1)).toBe(6700)
    expect(await count(ids.c.C2)).toBe(3000)
    expect(await batchTotal(b1)).toBe(9700)

    const c2 = await run(async (ctx) => (await ctx.db.get(ids.c.C2))!)
    expect(c2.status).toBe('active')
    expect(c2.currentBatchId).toBe(b1)
    expect(c2.initialAbw).toBe(150)

    // C1 eFCR to date: gain = 6,700 × 0.150 + 450 − 200 = 1,255 kg → 1,500 / 1,255.
    const k = await run(async (ctx) =>
      occupancyKpis({
        events: await engine.eventsForPair(ctx, ids.c.C1, b1),
        samples: await engine.samplesFor(ctx, ids.c.C1, b1),
        feedKg: 1500,
        asOf: '2026-03-01',
      }),
    )
    expect(k.gain_kg).toBe(1255)
    expect(k.efcr).toBe(1.2)
    expect(k.out_count).toBe(3000)

    // S1: the transfer can be corrected by reversal; the destination closes.
    const r = await run((ctx) =>
      engine.reverseOperation(ctx, opts, src('fishTransfers', 'T1'), 'Wrong cage'),
    )
    expect(r.reversed).toBe(2)
    expect(await count(ids.c.C1)).toBe(9700)
    expect(await count(ids.c.C2)).toBe(0)
    const after = await run(async (ctx) => (await ctx.db.get(ids.c.C2))!)
    expect(after.status).toBe('empty')
    expect(after.currentBatchId).toBeUndefined()
  })
})

describe('7.2 multiple destinations', () => {
  test('posts every line in one operation and refuses lines that together exceed the source', async () => {
    const { ids, opts, run, src, count, batchTotal, base } = await setup()
    const b1 = await base()
    const line = (dest: Id<'cages'>, qty: number, id: string) => ({
      src: src('fishTransfers', id),
      sourceUnitId: ids.c.C1,
      destinationUnitId: dest,
      qty,
      abwG: 150,
      date: '2026-03-01',
    })

    // 9,700 on hand: 5,000 + 5,000 is refused as a whole (I3 after all outflows).
    await expect(
      run((ctx) => engine.transfer(ctx, opts, [line(ids.c.C2, 5000, 'X'), line(ids.c.C3, 5000, 'Y')])),
    ).rejects.toThrow(/Not enough fish/)
    expect(await count(ids.c.C2)).toBe(0)
    expect(await count(ids.c.C1)).toBe(9700)

    await run((ctx) =>
      engine.transfer(ctx, opts, [
        line(ids.c.C2, 2000, 'T2a'),
        line(ids.c.C3, 2000, 'T2b'),
        line(ids.c.C4, 1500, 'T2c'),
      ]),
    )
    expect(await count(ids.c.C1)).toBe(4200)
    expect(await count(ids.c.C2)).toBe(2000)
    expect(await count(ids.c.C3)).toBe(2000)
    expect(await count(ids.c.C4)).toBe(1500)
    expect(await batchTotal(b1)).toBe(9700)
  })
})

/** 7.1 then grading on 04-15 (doc 05 §7.3). */
async function graded() {
  const s = await setup()
  const b1 = await s.base()
  await s.run((ctx) =>
    engine.transfer(ctx, s.opts, [
      {
        src: s.src('fishTransfers', 'T1'),
        sourceUnitId: s.ids.c.C1,
        destinationUnitId: s.ids.c.C2,
        qty: 3000,
        abwG: 150,
        date: '2026-03-01',
      },
    ]),
  )
  const g = await s.run((ctx) =>
    engine.gradingSplit(ctx, s.opts, s.src('stockOperations', 'G1'), {
      unitId: s.ids.c.C1,
      date: '2026-04-15',
      outputs: [
        { unitId: s.ids.c.C1, qty: 2500, abwG: 260 },
        { unitId: s.ids.c.C5, qty: 4100, abwG: 180 },
      ],
      culls: 100,
    }),
  )
  const [b1a, b1b] = g.childBatchIds
  return { ...s, b1, b1a, b1b, grading: g }
}

describe('7.3 split by grading', () => {
  test('creates child batches with lineage and closes the parent occupancy', async () => {
    const { ids, run, count, ledger, b1, b1a, b1b, grading } = await graded()
    expect(grading.unaccounted).toBe(0)
    expect(await ledger(ids.c.C1, b1)).toBe(0)
    expect(await ledger(ids.c.C1, b1a)).toBe(2500)
    expect(await ledger(ids.c.C5, b1b)).toBe(4100)
    expect(await count(ids.c.C1)).toBe(2500)
    expect(await count(ids.c.C5)).toBe(4100)

    const { cage, children, lin, parentLin } = await run(async (ctx) => ({
      cage: (await ctx.db.get(ids.c.C1))!,
      children: [(await ctx.db.get(b1a))!, (await ctx.db.get(b1b))!],
      lin: await engine.lineage(ctx, b1b),
      parentLin: await engine.lineage(ctx, b1),
    }))
    expect(cage.currentBatchId).toBe(b1a)
    expect(children.map((b) => b.batchNumber)).toEqual(['TL-0101-A', 'TL-0101-B'])
    expect(children.every((b) => b.origin === 'grading_split')).toBe(true)
    expect(lin.ancestors.map((a) => a._id)).toEqual([b1])
    expect(parentLin.descendants.map((d) => d._id).sort()).toEqual([b1a, b1b].sort())
  })

  test('posts a close-out when grades and culls do not account for every fish', async () => {
    const s = await setup()
    await s.base()
    const g = await s.run((ctx) =>
      engine.gradingSplit(ctx, s.opts, s.src('stockOperations', 'G2'), {
        unitId: s.ids.c.C1,
        date: '2026-04-15',
        outputs: [{ unitId: s.ids.c.C5, qty: 9000, abwG: 180 }],
      }),
    )
    expect(g.unaccounted).toBe(700)
    expect(await s.count(s.ids.c.C1)).toBe(0)
    expect(await s.count(s.ids.c.C5)).toBe(9000)
  })
})

/** 7.3, 50 deaths in C1, sample 300 g, then merge of 4,000 B1-B from C5 on 05-01. */
async function merged() {
  const s = await graded()
  await s.run(async (ctx) => {
    await engine.recordMortality(ctx, s.opts, s.src('dailyRecords', 'D2'), {
      unitId: s.ids.c.C1,
      qty: 50,
      date: '2026-04-20',
    })
    await ctx.db.insert('biweeklyRecords', {
      cageId: s.ids.c.C1,
      date: '2026-04-28',
      batchCode: 'TL-0101-A',
      averageBodyWeight: 300,
      totalFishCount: 100,
      totalWeight: 30,
      batchId: s.b1a,
      companyId: s.ids.companyId,
      updatedAt: Date.now(),
    })
  })
  const r = await s.run((ctx) =>
    engine.transfer(ctx, s.opts, [
      {
        src: s.src('fishTransfers', 'T5'),
        sourceUnitId: s.ids.c.C5,
        destinationUnitId: s.ids.c.C1,
        qty: 4000,
        abwG: 220,
        date: '2026-05-01',
      },
    ]),
  )
  return { ...s, mergeResult: r }
}

describe('7.4 merge into an occupied cage', () => {
  test('joins the batch already there, records lineage, and blends ABW by count', async () => {
    const { ids, run, count, b1a, b1b, mergeResult } = await merged()
    expect(mergeResult.lines[0].kind).toBe('merge')
    expect(await count(ids.c.C1)).toBe(6450)
    expect(await count(ids.c.C5)).toBe(100)
    const { target, abw } = await run(async (ctx) => ({
      target: (await ctx.db.get(b1a))!,
      abw: await engine.estimateAbw(ctx, ids.c.C1, b1a, '2026-05-01'),
    }))
    expect(target.parentBatchIds).toContain(b1b)
    // (2,450 × 300 + 4,000 × 220) ÷ 6,450
    expect(abw).toBeCloseTo(250.39, 2)
  })
})

describe('7.5 mortality correction after harvest and restock', () => {
  test('changes only the old batch and recomputes its close-out', async () => {
    const { ids, opts, run, src, count, ledger, base } = await setup()
    const b1 = await base()
    await run((ctx) =>
      engine.transfer(ctx, opts, [
        { src: src('fishTransfers', 'T2c'), sourceUnitId: ids.c.C1, destinationUnitId: ids.c.C4, qty: 1500, abwG: 150, date: '2026-03-01' },
      ]),
    )
    await run((ctx) =>
      engine.recordMortality(ctx, opts, src('dailyRecords', 'D1'), { unitId: ids.c.C4, qty: 50, date: '2026-03-10' }),
    )
    const h = await run((ctx) =>
      engine.harvest(ctx, opts, src('harvestRecords', 'H4'), {
        unitId: ids.c.C4,
        qty: 1370,
        kg: 685,
        date: '2026-07-15',
        complete: true,
      }),
    )
    expect(h.unaccounted).toBe(80)
    expect(await count(ids.c.C4)).toBe(0)
    expect((await run(async (ctx) => (await ctx.db.get(ids.c.C4))!)).status).toBe('harvested')

    const b3 = await run(async (ctx) => {
      const b3 = await engine.openBatch(ctx, opts, { batchNumber: 'TL-0801', origin: 'stocking', openedOn: '2026-08-01' })
      await engine.stockIn(ctx, opts, src('stockingHistory', 'S3'), { unitId: ids.c.C4, batchId: b3, qty: 8000, abwG: 15, date: '2026-08-01' })
      return b3
    })
    expect(await count(ids.c.C4)).toBe(8000)

    // September: D1 corrected from 50 to 35 (replaceOperation).
    const r = await run(async (ctx) => {
      const op = engine.beginOperation(ctx, opts)
      await op.reverseSource(src('dailyRecords', 'D1'), 'Corrected')
      await op.mortality(src('dailyRecords', 'D1'), { unitId: ids.c.C4, qty: 35, date: '2026-03-10' })
      return await op.commit()
    })
    expect(r.warnings.join(' ')).toMatch(/Unaccounted loss for TL-0101 in C4 changed from 80 to 95/)
    expect(await count(ids.c.C4)).toBe(8000)
    expect(await ledger(ids.c.C4, b3)).toBe(8000)
    expect(await ledger(ids.c.C4, b1)).toBe(0)
  })
})

/** 7.4, partial harvest H2, 70 deaths, complete harvest H3 (doc 05 §7.6). */
async function harvested() {
  const s = await merged()
  await s.run((ctx) =>
    engine.harvest(ctx, s.opts, s.src('harvestRecords', 'H2'), {
      unitId: s.ids.c.C1,
      qty: 2000,
      kg: 700,
      date: '2026-06-01',
      complete: false,
    }),
  )
  await s.run((ctx) =>
    engine.recordMortality(ctx, s.opts, s.src('dailyRecords', 'D3'), { unitId: s.ids.c.C1, qty: 70, date: '2026-06-20' }),
  )
  const h3 = await s.run((ctx) =>
    engine.harvest(ctx, s.opts, s.src('harvestRecords', 'H3'), {
      unitId: s.ids.c.C1,
      qty: 4300,
      kg: 1720,
      date: '2026-07-15',
      complete: true,
    }),
  )
  return { ...s, h3 }
}

describe('7.6 partial harvest, then complete harvest', () => {
  test('a partial keeps the occupancy open; the complete one closes it with a close-out', async () => {
    const { ids, run, count, b1a, h3 } = await harvested()
    expect(h3.unaccounted).toBe(80)
    expect(await count(ids.c.C1)).toBe(0)
    const { cage, batch, kpi } = await run(async (ctx) => ({
      cage: (await ctx.db.get(ids.c.C1))!,
      batch: (await ctx.db.get(b1a))!,
      kpi: occupancyKpis({
        events: await engine.eventsForPair(ctx, ids.c.C1, b1a),
        samples: [],
        feedKg: 3000,
        asOf: '2026-07-31',
      }),
    }))
    expect(cage.status).toBe('harvested')
    expect(cage.currentBatchId).toBeUndefined()
    expect(batch.status).toBe('closed')
    expect(batch.closedOn).toBe('2026-07-15')
    expect(kpi.harvested_count).toBe(6300)
    expect(kpi.harvested_kg).toBe(2420)
    expect(kpi.unaccounted).toBe(80)
    expect(kpi.closed_on).toBe('2026-07-15')
    // eFCR = feed ÷ (700 + 1,720 − 650 graded in − 880 merged in)
    expect(kpi.gain_kg).toBe(890)
  })
})

describe('7.7 correcting an old harvest after restock', () => {
  test('touches only the old batch; leaving fish behind while a new batch is open is refused', async () => {
    const s = await harvested()
    const { ids, opts, run, src, count, ledger, b1a } = s
    const b2 = await run(async (ctx) => {
      const b2 = await engine.openBatch(ctx, opts, { batchNumber: 'TL-0802', origin: 'stocking', openedOn: '2026-08-01' })
      await engine.stockIn(ctx, opts, src('stockingHistory', 'S2'), { unitId: ids.c.C1, batchId: b2, qty: 10_000, abwG: 15, date: '2026-08-01' })
      return b2
    })

    // H3 count 4,300 → 4,250: close-out −80 → −130, B2 untouched.
    const edit = await run(async (ctx) => {
      const op = engine.beginOperation(ctx, opts)
      await op.reverseSource(src('harvestRecords', 'H3'), 'Edited')
      await op.harvest(src('harvestRecords', 'H3'), { unitId: ids.c.C1, batchId: b1a, qty: 4250, kg: 1700, date: '2026-07-15', complete: true })
      return await op.commit()
    })
    expect(edit.eventIds.length).toBe(4)
    expect(await ledger(ids.c.C1, b1a)).toBe(0)
    expect(await ledger(ids.c.C1, b2)).toBe(10_000)
    expect(await count(ids.c.C1)).toBe(10_000)
    const closeouts = await run(async (ctx) =>
      engine.activeEvents(await engine.eventsForPair(ctx, ids.c.C1, b1a)).filter((e) => e.component === 'closeout'),
    )
    expect(closeouts.map((e) => e.qtyDelta)).toEqual([-130])

    // Complete → partial would leave 130 fish of B1-A beside B2.
    await expect(
      run(async (ctx) => {
        const op = engine.beginOperation(ctx, opts)
        await op.reverseSource(src('harvestRecords', 'H3'), 'Edited')
        await op.harvest(src('harvestRecords', 'H3'), { unitId: ids.c.C1, batchId: b1a, qty: 4250, kg: 1700, date: '2026-07-15', complete: false })
        return await op.commit()
      }),
    ).rejects.toThrow(/two batches at once/)
    expect(await count(ids.c.C1)).toBe(10_000)

    // Deleting the old partial H2: the close-out absorbs the 2,000; no phantom fish in B2.
    const del = await run((ctx) => engine.reverseOperation(ctx, opts, src('harvestRecords', 'H2'), 'Deleted'))
    expect(del.warnings.join(' ')).toMatch(/changed from 130 to 2130/)
    expect(await ledger(ids.c.C1, b2)).toBe(10_000)
    expect(await count(ids.c.C1)).toBe(10_000)
  })
})

describe('7.8 historical report', () => {
  test('answers as of a date, and as known at an earlier time', async () => {
    const { ids, opts, run, src, base } = await setup()
    await base()
    await run((ctx) =>
      engine.transfer(ctx, opts, [
        { src: src('fishTransfers', 'T1'), sourceUnitId: ids.c.C1, destinationUnitId: ids.c.C2, qty: 3000, abwG: 150, date: '2026-03-01' },
      ]),
    )
    const knownAt = Date.now()
    await new Promise((r) => setTimeout(r, 5))
    // Later, a February mortality is entered.
    await run((ctx) =>
      engine.recordMortality(ctx, opts, src('dailyRecords', 'D9'), { unitId: ids.c.C1, qty: 100, date: '2026-02-10' }),
    )
    const r = await run(async (ctx) => ({
      now: await engine.stockAsOf(ctx, { unitId: ids.c.C1, date: '2026-03-31' }),
      then: await engine.stockAsOf(ctx, { unitId: ids.c.C1, date: '2026-03-31', knownAt }),
      feb: await engine.stockAsOf(ctx, { unitId: ids.c.C1, date: '2026-02-28' }),
    }))
    expect(r.now.count).toBe(6600)
    expect(r.then.count).toBe(6700)
    expect(r.feb.count).toBe(9600)
    expect(r.now.biomassKg).toBeCloseTo(6600 * 0.15, 5)
  })
})

describe('invariants (doc 05 §5)', () => {
  test('I10: quantities must be whole and carry the right sign', async () => {
    const { ids, opts, run, src, base } = await setup()
    const b1 = await base()
    await expect(
      run((ctx) => engine.recordMortality(ctx, opts, src('dailyRecords', 'N'), { unitId: ids.c.C1, qty: -5, date: '2026-03-01' })),
    ).rejects.toThrow(/Wrong sign/)
    await expect(
      run((ctx) =>
        engine.stockIn(ctx, opts, src('topupHistory', 'N'), { unitId: ids.c.C1, batchId: b1, qty: 1.5, abwG: 20, date: '2026-03-01' }),
      ),
    ).rejects.toThrow(/whole numbers/)
  })

  test('I3: strict mode refuses negative stock and rolls back; shadow mode warns', async () => {
    const { ids, opts, run, src, base, count } = await setup()
    await base()
    await expect(
      run((ctx) => engine.recordMortality(ctx, opts, src('dailyRecords', 'BIG'), { unitId: ids.c.C1, qty: 20_000, date: '2026-03-01' })),
    ).rejects.toThrow(/Not enough fish/)
    expect(await run(async (ctx) => (await engine.eventsForSource(ctx, src('dailyRecords', 'BIG'))).length)).toBe(0)
    expect(await count(ids.c.C1)).toBe(9700)

    const shadow = await run((ctx) =>
      engine.recordMortality(ctx, { ...opts, mode: 'shadow', cache: 'legacy' }, src('dailyRecords', 'BIG'), {
        unitId: ids.c.C1,
        qty: 20_000,
        date: '2026-03-01',
      }),
    )
    expect(shadow.warnings.join(' ')).toMatch(/Not enough fish/)
    // Legacy cache mode leaves the count to the caller.
    expect(await count(ids.c.C1)).toBe(9700)
  })

  test('I6: reversal is idempotent and a reversal cannot be reversed', async () => {
    const { ids, opts, run, src, base, count } = await setup()
    await base()
    const m = await run((ctx) =>
      engine.recordMortality(ctx, opts, src('dailyRecords', 'D5'), { unitId: ids.c.C1, qty: 40, date: '2026-03-02' }),
    )
    const first = await run((ctx) => engine.reverse(ctx, opts, m.eventIds[0], 'typo'))
    const second = await run((ctx) => engine.reverse(ctx, opts, m.eventIds[0], 'typo'))
    expect(first.alreadyReversed).toBe(false)
    expect(second.alreadyReversed).toBe(true)
    expect(second.reversalId).toBe(first.reversalId)
    expect(await count(ids.c.C1)).toBe(9700)
    await expect(run((ctx) => engine.reverse(ctx, opts, first.reversalId, 'again'))).rejects.toThrow(/cannot be reversed/)
  })

  test('I2: another company’s cage or batch is refused', async () => {
    const { ids, opts, run, src, base } = await setup()
    const b1 = await base()
    await expect(
      run((ctx) =>
        engine.stockIn(ctx, opts, src('stockingHistory', 'X'), { unitId: ids.c.X1, batchId: b1, qty: 10, abwG: 5, date: '2026-03-01' }),
      ),
    ).rejects.toThrow(/Cage not found/)
    await expect(
      run((ctx) =>
        engine.stockIn(ctx, { ...opts, companyId: ids.otherCompanyId }, src('stockingHistory', 'X'), {
          unitId: ids.c.X1,
          batchId: b1,
          qty: 10,
          abwG: 5,
          date: '2026-03-01',
        }),
      ),
    ).rejects.toThrow(/Batch not found/)
  })

  test('I9: future dates are refused', async () => {
    const { ids, opts, run, src, base } = await setup()
    await base()
    await expect(
      run((ctx) => engine.recordMortality(ctx, opts, src('dailyRecords', 'F'), { unitId: ids.c.C1, qty: 1, date: '2099-01-01' })),
    ).rejects.toThrow(/future/)
  })

  test('I1: no module other than the engine writes stockEvents', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const writers = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts') && path !== './lib/productionEngine.ts')
      .filter(([, code]) => /insert\(\s*['"]stockEvents['"]/.test(code) || /stockEvents['"]?\s*,\s*[^)]*\)\s*;?\s*\/\/\s*patch/.test(code))
      .map(([path]) => path)
    expect(writers).toEqual([])
  })
})
