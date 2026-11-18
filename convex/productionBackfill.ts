/**
 * Production engine backfill (doc 05 §9.1, R04 M6/M7). Internal only; every
 * function defaults to `dryRun: true`, which reports and writes nothing.
 *
 *   npx convex run productionBackfill:m6Batches '{}'                       # dry run
 *   npx convex run productionBackfill:m6Batches '{"dryRun":false}'
 *   npx convex run productionBackfill:m7StockEvents '{"phase":"events"}'   # dry run, first page
 *   npx convex run productionBackfill:m7StockEvents '{"dryRun":false,"phase":"events","chain":true}'
 *
 * With `chain: true` (and `dryRun: false`) M7 walks every cage page by page
 * and then runs the next phase: events → closeouts → reconcile. Phases:
 *
 * 1. events: per cage, ledger events for approved stockings and top-ups
 *    (not made by transfers), approved transfers out of the cage (both
 *    sides), daily mortality and harvests (not old sampling-page rows).
 *    Sources that already have events (dual-write) are skipped, so the run
 *    is idempotent. Records get their `batchId`.
 * 2. closeouts: per cage, each complete harvest gets its close-out
 *    adjustment against the now complete ledger (I11).
 * 3. reconcile: per cage, one labelled `count_adjustment` (source
 *    `legacyBackfill`, reason "Legacy reconciliation", dated the run day) so
 *    Σ events equals today's `cages.currentCount`. Re-running replaces it.
 *
 * Writes use the engine in shadow mode with the legacy cache: they never
 * change `cages.currentCount`.
 */
import { insertAuditLog } from './lib/auditChain'
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import * as engine from './lib/productionEngine'
import {
  approvedStockings,
  ensureBatchForStocking,
  postTransfer,
  shadowOpts,
} from './lib/productionDualWrite'
import { biomassKg } from './lib/kpi'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const today = () => new Date().toISOString().slice(0, 10)

async function linkedTransferOf(ctx: MutationCtx, stockingId: Id<'stockingHistory'>) {
  return await ctx.db
    .query('fishTransfers')
    .withIndex('by_destinationStockingId', (q) => q.eq('destinationStockingId', stockingId))
    .first()
}

/**
 * M6: one batch per approved stocking (`origin: 'stocking'`), or a child of
 * the source batch (`origin: 'transfer_split'`) when a fish transfer created
 * the stocking. Links `stockingHistory.batchId`.
 */
export const m6Batches = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    companyId: v.optional(v.id('companies')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { dryRun = true, companyId, limit = 500 }) => {
    const items: Array<{
      stockingId: string
      batchNumber: string
      origin: 'stocking' | 'transfer_split'
      parentStockingId: string | null
    }> = []
    let more = false
    const rows = companyId
      ? ctx.db
          .query('stockingHistory')
          .withIndex('by_company_and_status', (q) => q.eq('companyId', companyId).eq('status', 'approved'))
      : ctx.db.query('stockingHistory').withIndex('by_status', (q) => q.eq('status', 'approved'))
    for await (const s of rows) {
      if (s.deletedAt || s.batchId || !s.companyId) continue
      if (items.length >= limit) {
        more = true
        break
      }
      const transfer = await linkedTransferOf(ctx, s._id)
      const parentStocking = transfer?.sourceStockingId ? await ctx.db.get(transfer.sourceStockingId) : null
      items.push({
        stockingId: s._id,
        batchNumber: s.batchNumber,
        origin: parentStocking ? 'transfer_split' : 'stocking',
        parentStockingId: parentStocking?._id ?? null,
      })
      if (dryRun) continue
      const opts = { companyId: s.companyId }
      const parentBatch =
        parentStocking && parentStocking.status === 'approved' && !parentStocking.deletedAt
          ? await ensureBatchForStocking(ctx, opts, parentStocking)
          : null
      await ensureBatchForStocking(ctx, opts, s, parentBatch)
    }
    return { dryRun, count: items.length, complete: !more, items }
  },
})

type Phase = 'events' | 'closeouts' | 'reconcile'
const NEXT: Record<Phase, Phase | null> = { events: 'closeouts', closeouts: 'reconcile', reconcile: null }

/** ABW (g) on a date from the cage's samples in the cycle, else the stocking ABW. */
function abwOn(
  samples: Doc<'biweeklyRecords'>[],
  stocking: Doc<'stockingHistory'> | null,
  date: string,
) {
  let abw = stocking?.initialAbw ?? 0
  for (const s of samples) {
    if (s.date > date) break
    if (!stocking || s.date >= stocking.stockingDate) abw = s.averageBodyWeight || abw
  }
  return abw
}

/** Phase 1 for one cage. Returns what was (or would be) posted. */
async function backfillCageEvents(ctx: MutationCtx, cage: Doc<'cages'>, dryRun: boolean) {
  const opts = shadowOpts(cage)
  const planned = { stock_in: 0, topup: 0, transfer: 0, mortality: 0, harvest: 0, skipped: 0 }
  if (!opts) return { planned, warnings: ['Cage has no company'] }

  const stockings = await approvedStockings(ctx, cage._id)
  const stockingAt = (date: string) => {
    let found: Doc<'stockingHistory'> | null = null
    for (const s of stockings) if (s.stockingDate <= date) found = s
    return found
  }
  const samples = (
    await ctx.db
      .query('biweeklyRecords')
      .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
      .take(2000)
  ).sort((a, b) => a.date.localeCompare(b.date))
  const has = (sourceTable: engine.StockSourceTable, sourceId: string) =>
    engine.sourceHasEvents(ctx, { sourceTable, sourceId })
  const batchOf = async (s: Doc<'stockingHistory'> | null) =>
    s && !dryRun ? await ensureBatchForStocking(ctx, opts, s) : null

  type Item = { date: string; order: number; run: () => Promise<void> }
  const items: Item[] = []
  const op = engine.beginOperation(ctx, opts)

  for (const s of stockings) {
    if (!DATE_RE.test(s.stockingDate) || !(Number.isInteger(s.fishCount) && s.fishCount > 0)) {
      planned.skipped++
      continue
    }
    // Stockings written by a grading carry their fish as grading events already.
    const gradedChild = s.batchId ? (await ctx.db.get(s.batchId))?.origin === 'grading_split' : false
    if (!gradedChild && !(await linkedTransferOf(ctx, s._id)) && !(await has('stockingHistory', s._id))) {
      planned.stock_in++
      items.push({
        date: s.stockingDate,
        order: 0,
        run: async () => {
          const batchId = (await batchOf(s))!
          await op.stockIn({ sourceTable: 'stockingHistory', sourceId: s._id }, {
            unitId: cage._id,
            batchId,
            qty: s.fishCount,
            abwG: s.initialAbw,
            biomassKg: s.initialBiomass,
            date: s.stockingDate,
          })
        },
      })
    }
    const topups = await ctx.db
      .query('topupHistory')
      .withIndex('by_stocking', (q) => q.eq('stockingId', s._id))
      .take(500)
    for (const t of topups) {
      if (t.status !== 'approved' || !DATE_RE.test(t.topupDate) || !(Number.isInteger(t.fishCount) && t.fishCount > 0)) continue
      const viaTransfer = await ctx.db
        .query('fishTransfers')
        .withIndex('by_destinationTopupId', (q) => q.eq('destinationTopupId', t._id))
        .first()
      if (viaTransfer || (await has('topupHistory', t._id))) continue
      planned.topup++
      items.push({
        date: t.topupDate,
        order: 0,
        run: async () => {
          const batchId = (await batchOf(s))!
          if (t.batchId !== batchId) await ctx.db.patch(t._id, { batchId })
          await op.stockIn({ sourceTable: 'topupHistory', sourceId: t._id }, {
            unitId: cage._id,
            batchId,
            qty: t.fishCount,
            abwG: t.abw,
            date: t.topupDate,
          })
        },
      })
    }
  }

  const transfers = await ctx.db
    .query('fishTransfers')
    .withIndex('by_source_cage', (q) => q.eq('sourceCageId', cage._id))
    .take(2000)
  for (const tr of transfers) {
    if (tr.status !== 'approved' || tr.reversedAt) continue
    if (await has('fishTransfers', tr._id)) continue
    planned.transfer++
    items.push({ date: tr.transferDate, order: 3, run: () => postTransfer(ctx, op, opts, tr) })
  }

  const daily = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
    .take(10_000)
  for (const d of daily) {
    if (!DATE_RE.test(d.date)) continue
    const s = stockingAt(d.date)
    items.push({
      date: d.date,
      order: 2,
      run: async () => {
        const batchId = await batchOf(s)
        if (batchId && d.batchId !== batchId) await ctx.db.patch(d._id, { batchId })
        if (!batchId || !(Number.isInteger(d.mortality) && d.mortality > 0)) return
        if (await has('dailyRecords', d._id)) return
        const abw = abwOn(samples, s, d.date)
        await op.post({ sourceTable: 'dailyRecords', sourceId: d._id }, [
          {
            type: 'mortality',
            unitId: cage._id,
            batchId,
            qtyDelta: -d.mortality,
            biomassKgDelta: -biomassKg(d.mortality, abw),
            abwG: abw || undefined,
            abwSource: 'estimated',
            eventDate: d.date,
          },
        ])
      },
    })
    if (d.mortality > 0 && s && !(await has('dailyRecords', d._id))) planned.mortality++
  }

  const harvests = await ctx.db
    .query('harvestRecords')
    .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
    .take(2000)
  for (const h of harvests) {
    if (h.source === 'sampling_page' || !DATE_RE.test(h.harvestDate)) continue
    const s = stockingAt(h.harvestDate)
    if (!s || (await has('harvestRecords', h._id))) continue
    planned.harvest++
    const qty = Math.max(0, Math.round(h.estimatedCount || 0))
    items.push({
      date: h.harvestDate,
      order: 3,
      run: async () => {
        const batchId = (await batchOf(s))!
        if (h.batchId !== batchId) await ctx.db.patch(h._id, { batchId })
        if (qty <= 0) return
        await op.post({ sourceTable: 'harvestRecords', sourceId: h._id }, [
          {
            type: 'harvest',
            unitId: cage._id,
            batchId,
            qtyDelta: -qty,
            biomassKgDelta: -Math.max(0, h.totalWeight || 0),
            abwG: h.averageBodyWeight || undefined,
            abwSource: 'measured',
            eventDate: h.harvestDate,
          },
        ])
      },
    })
  }

  for (const r of samples) {
    if (dryRun || !DATE_RE.test(r.date)) continue
    const batchId = await batchOf(stockingAt(r.date))
    if (batchId && r.batchId !== batchId) await ctx.db.patch(r._id, { batchId })
  }

  if (dryRun) return { planned, warnings: [] as string[] }
  items.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date.localeCompare(b.date)))
  for (const it of items) await it.run()
  const { warnings } = await op.commit()
  return { planned, warnings }
}

/** Phase 2 for one cage: close-outs of complete harvests against the full ledger. */
async function backfillCageCloseouts(ctx: MutationCtx, cage: Doc<'cages'>, dryRun: boolean) {
  const opts = shadowOpts(cage)
  const out: Array<{ harvestId: string; date: string; closeout: number }> = []
  if (!opts) return out
  const harvests = (
    await ctx.db
      .query('harvestRecords')
      .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
      .take(2000)
  )
    .filter((h) => h.source !== 'sampling_page' && h.harvestType !== 'partial' && h.batchId)
    .sort((a, b) => a.harvestDate.localeCompare(b.harvestDate))
  const op = engine.beginOperation(ctx, opts)
  for (const h of harvests) {
    const src = { sourceTable: 'harvestRecords' as const, sourceId: h._id }
    const live = engine.activeEvents(await engine.eventsForSource(ctx, src))
    if (live.some((e) => e.component === engine.CLOSEOUT)) continue
    const pair = await engine.eventsForPair(ctx, cage._id, h.batchId!)
    const left = pair.filter((e) => e.eventDate <= h.harvestDate).reduce((s, e) => s + e.qtyDelta, 0)
    if (left === 0) continue
    out.push({ harvestId: h._id, date: h.harvestDate, closeout: -left })
    if (dryRun) continue
    await op.post(src, [
      {
        type: 'count_adjustment',
        unitId: cage._id,
        batchId: h.batchId!,
        qtyDelta: -left,
        biomassKgDelta: 0,
        abwSource: 'estimated',
        eventDate: h.harvestDate,
        component: engine.CLOSEOUT,
        reason: left > 0 ? 'Unaccounted at harvest' : 'More fish harvested than on record',
      },
    ])
  }
  if (!dryRun) await op.commit()
  return out
}

/** Phase 3 for one cage: one labelled adjustment so Σ events = currentCount. */
async function reconcileCage(ctx: MutationCtx, cage: Doc<'cages'>, dryRun: boolean, date: string) {
  const opts = shadowOpts(cage)
  if (!opts) return null
  const src = { sourceTable: 'legacyBackfill' as const, sourceId: `cage:${cage._id}` }
  const prior = engine.activeEvents(await engine.eventsForSource(ctx, src))
  const ledger =
    (await engine.eventsForUnit(ctx, cage._id)).reduce((s, e) => s + e.qtyDelta, 0) -
    prior.reduce((s, e) => s + e.qtyDelta, 0)
  const legacy = cage.currentCount ?? 0
  const diff = legacy - ledger
  const priorDiff = prior.reduce((s, e) => s + e.qtyDelta, 0)
  if (diff === priorDiff) {
    return diff === 0 ? null : { cage: cage.name, cageId: cage._id, legacy, ledger, diff, changed: false }
  }

  let batchId = await engine.openBatchInUnit(ctx, cage._id)
  if (!batchId) {
    const stockings = await approvedStockings(ctx, cage._id)
    const last = stockings[stockings.length - 1]
    batchId = last?.batchId ?? null
    if (!batchId && last && !dryRun) batchId = await ensureBatchForStocking(ctx, opts, last)
  }
  const row = { cage: cage.name, cageId: cage._id, legacy, ledger, diff, changed: true, noBatch: !batchId && !dryRun }
  if (dryRun) return row
  const op = engine.beginOperation(ctx, opts)
  await op.reverseSource(src, 'Legacy reconciliation replaced')
  if (diff !== 0 && batchId) {
    await op.post(src, [
      {
        type: 'count_adjustment',
        unitId: cage._id,
        batchId,
        qtyDelta: diff,
        biomassKgDelta: 0,
        eventDate: date,
        reason: 'Legacy reconciliation',
      },
    ])
  }
  await op.commit()
  return row
}

/**
 * M7: stock events from history, then close-outs, then one reconciliation
 * adjustment per cage (see the header). One page of cages per call.
 */
export const m7StockEvents = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    phase: v.optional(v.union(v.literal('events'), v.literal('closeouts'), v.literal('reconcile'))),
    companyId: v.optional(v.id('companies')),
    cursor: v.optional(v.union(v.string(), v.null())),
    cagesPerRun: v.optional(v.number()),
    chain: v.optional(v.boolean()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true
    const phase: Phase = args.phase ?? 'events'
    const date = args.date ?? today()
    const numItems = Math.max(1, Math.min(50, args.cagesPerRun ?? 10))
    const q = args.companyId
      ? ctx.db.query('cages').withIndex('by_company', (x) => x.eq('companyId', args.companyId))
      : ctx.db.query('cages')
    const page = await q.paginate({ cursor: args.cursor ?? null, numItems })

    const cages: unknown[] = []
    for (const cage of page.page) {
      if (phase === 'events') {
        const r = await backfillCageEvents(ctx, cage, dryRun)
        cages.push({ cage: cage.name, cageId: cage._id, ...r })
      } else if (phase === 'closeouts') {
        const r = await backfillCageCloseouts(ctx, cage, dryRun)
        if (r.length) cages.push({ cage: cage.name, cageId: cage._id, closeouts: r })
      } else {
        const r = await reconcileCage(ctx, cage, dryRun, date)
        if (r) cages.push(r)
      }
    }

    let scheduled: string | null = null
    if (args.chain && !dryRun) {
      const base = { dryRun: false, companyId: args.companyId, cagesPerRun: numItems, chain: true, date }
      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.productionBackfill.m7StockEvents, {
          ...base,
          phase,
          cursor: page.continueCursor,
        })
        scheduled = `${phase} (next page)`
      } else if (NEXT[phase]) {
        await ctx.scheduler.runAfter(0, internal.productionBackfill.m7StockEvents, {
          ...base,
          phase: NEXT[phase]!,
          cursor: null,
        })
        scheduled = NEXT[phase]
      }
    }
    if (!dryRun && cages.length) {
      await insertAuditLog(ctx, {
        actionType: 'migration',
        tableName: 'stockEvents',
        newValues: { migration: 'M7', phase, cages: cages.length },
        companyId: args.companyId,
      })
    }
    return {
      dryRun,
      phase,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      scheduled,
      cages,
    }
  },
})
