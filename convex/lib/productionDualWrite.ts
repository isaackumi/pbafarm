/**
 * Dual-write bridge (doc 05 §9.2 step 3, PROD-004).
 *
 * The existing writers (stocking, top-up, fish transfer, harvest, daily
 * mortality, bi-weekly sampling, manual count edits) keep patching
 * `cages.currentCount` themselves; after doing so they call these helpers,
 * which post the same change to the stock ledger in `shadow` mode with the
 * `legacy` cache. A ledger that has not been backfilled yet therefore never
 * blocks daily work: invariant breaches come back as warnings, and the
 * nightly reconciliation (convex/reconciliation.ts) reports any drift.
 *
 * Batches follow the legacy cycle: each approved stocking opens one batch
 * (`stockingHistory.batchId`); a record belongs to the batch of the latest
 * approved stocking on or before its date in that cage (the date-window rule
 * the backfill uses, doc 05 §9.1).
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import {
  beginOperation,
  openBatch,
  sourceHasEvents,
  type EngineOptions,
  type SourceRef,
  type StockOperation,
} from './productionEngine'
import { efcr, occupancyKpis } from './kpi'
import * as engine from './productionEngine'

type Ctx = QueryCtx | MutationCtx

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isWhole = (n: number) => Number.isInteger(n) && n > 0

/** Shadow options for a cage's company; null for cages with no company. */
export function shadowOpts(
  cage: { companyId?: Id<'companies'> } | null | undefined,
  userId?: Id<'users'>,
): EngineOptions | null {
  if (!cage?.companyId) return null
  return { companyId: cage.companyId, userId, mode: 'shadow', cache: 'legacy' }
}

/** Approved, live stockings of a cage, oldest first (date, then creation). */
export async function approvedStockings(ctx: Ctx, cageId: Id<'cages'>) {
  const rows = await ctx.db
    .query('stockingHistory')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .take(1000)
  return rows
    .filter((s) => s.status === 'approved' && !s.deletedAt)
    .sort((a, b) =>
      a.stockingDate === b.stockingDate
        ? a._creationTime - b._creationTime
        : a.stockingDate.localeCompare(b.stockingDate),
    )
}

/** The approved stocking whose cycle a record dated `date` belongs to. */
export async function stockingAt(ctx: Ctx, cageId: Id<'cages'>, date: string) {
  const rows = await approvedStockings(ctx, cageId)
  let found: Doc<'stockingHistory'> | null = null
  for (const s of rows) if (s.stockingDate <= date) found = s
  return found
}

/**
 * The batch a stocking opened, created (and linked) on first use. A stocking
 * made by a fish transfer is a child of the source batch.
 */
export async function ensureBatchForStocking(
  ctx: MutationCtx,
  opts: EngineOptions,
  stocking: Doc<'stockingHistory'>,
  parentBatchId?: Id<'batches'> | null,
): Promise<Id<'batches'>> {
  if (stocking.batchId) return stocking.batchId
  const existing = await ctx.db
    .query('batches')
    .withIndex('by_legacyStockingId', (q) => q.eq('legacyStockingId', stocking._id))
    .first()
  const batchId =
    existing?._id ??
    (await openBatch(ctx, opts, {
      batchNumber: stocking.batchNumber,
      origin: parentBatchId ? 'transfer_split' : 'stocking',
      parentBatchIds: parentBatchId ? [parentBatchId] : undefined,
      openedOn: stocking.stockingDate,
      speciesCode: stocking.species,
      homeLocationId: stocking.locationId,
      legacyStockingId: stocking._id,
    }))
  await ctx.db.patch(stocking._id, { batchId })
  return batchId
}

/** The batch of the cycle a record dated `date` belongs to (creating it if needed). */
export async function legacyBatchAt(
  ctx: MutationCtx,
  opts: EngineOptions,
  cageId: Id<'cages'>,
  date: string,
): Promise<Id<'batches'> | null> {
  const s = await stockingAt(ctx, cageId, date)
  return s ? await ensureBatchForStocking(ctx, opts, s) : null
}

const transferForStocking = (ctx: Ctx, stockingId: Id<'stockingHistory'>) =>
  ctx.db
    .query('fishTransfers')
    .withIndex('by_destinationStockingId', (q) => q.eq('destinationStockingId', stockingId))
    .first()

const transferForTopup = (ctx: Ctx, topupId: Id<'topupHistory'>) =>
  ctx.db
    .query('fishTransfers')
    .withIndex('by_destinationTopupId', (q) => q.eq('destinationTopupId', topupId))
    .first()

type Result = { warnings: string[] }
const none: Result = { warnings: [] }

/** stock_in for an approved stocking (transfer-made stockings are posted by the transfer). */
export async function shadowStocking(
  ctx: MutationCtx,
  stocking: Doc<'stockingHistory'>,
  userId?: Id<'users'>,
): Promise<Result> {
  const cage = await ctx.db.get(stocking.cageId)
  const opts = shadowOpts(cage, userId)
  if (!opts || stocking.status !== 'approved' || stocking.deletedAt) return none
  if (await transferForStocking(ctx, stocking._id)) return none
  const src: SourceRef = { sourceTable: 'stockingHistory', sourceId: stocking._id }
  const batchId = await ensureBatchForStocking(ctx, opts, stocking)
  if (await sourceHasEvents(ctx, src)) return none
  if (!isWhole(stocking.fishCount) || !DATE_RE.test(stocking.stockingDate)) return none
  return await engine.stockIn(ctx, opts, src, {
    unitId: stocking.cageId,
    batchId,
    qty: stocking.fishCount,
    abwG: stocking.initialAbw,
    biomassKg: stocking.initialBiomass,
    date: stocking.stockingDate,
  })
}

/** stock_in on the stocking's batch for an approved top-up (not transfer-made). */
export async function shadowTopup(
  ctx: MutationCtx,
  topup: Doc<'topupHistory'>,
  userId?: Id<'users'>,
): Promise<Result> {
  if (topup.status !== 'approved') return none
  if (await transferForTopup(ctx, topup._id)) return none
  const stocking = await ctx.db.get(topup.stockingId)
  if (!stocking) return none
  const cage = await ctx.db.get(stocking.cageId)
  const opts = shadowOpts(cage, userId)
  if (!opts) return none
  const batchId = await ensureBatchForStocking(ctx, opts, stocking)
  if (topup.batchId !== batchId) await ctx.db.patch(topup._id, { batchId })
  const src: SourceRef = { sourceTable: 'topupHistory', sourceId: topup._id }
  if (await sourceHasEvents(ctx, src)) return none
  if (!isWhole(topup.fishCount) || !DATE_RE.test(topup.topupDate)) return none
  return await engine.stockIn(ctx, opts, src, {
    unitId: stocking.cageId,
    batchId,
    qty: topup.fishCount,
    abwG: topup.abw,
    date: topup.topupDate,
  })
}

/**
 * Post an approved fish transfer: out of the source batch; into the batch the
 * legacy flow put the fish in (the new stocking's child batch, or the
 * topped-up stocking's batch, which makes it a merge).
 */
export async function postTransfer(
  ctx: MutationCtx,
  op: StockOperation,
  opts: EngineOptions,
  transfer: Doc<'fishTransfers'>,
) {
  const src: SourceRef = { sourceTable: 'fishTransfers', sourceId: transfer._id }
  if (await sourceHasEvents(ctx, src)) return
  if (!isWhole(transfer.quantity) || !DATE_RE.test(transfer.transferDate)) return
  const sourceStocking = transfer.sourceStockingId
    ? await ctx.db.get(transfer.sourceStockingId)
    : await stockingAt(ctx, transfer.sourceCageId, transfer.transferDate)
  const batchId = sourceStocking ? await ensureBatchForStocking(ctx, opts, sourceStocking) : null
  if (!batchId) {
    op.warnings.push('Transfer source has no stocking on record; not posted to the ledger')
    return
  }
  let destinationBatchId: Id<'batches'> | undefined
  if (transfer.destinationStockingId) {
    const st = await ctx.db.get(transfer.destinationStockingId)
    if (st) destinationBatchId = await ensureBatchForStocking(ctx, opts, st, batchId)
  } else if (transfer.destinationTopupId) {
    const topup = await ctx.db.get(transfer.destinationTopupId)
    const st = topup ? await ctx.db.get(topup.stockingId) : null
    if (st && topup) {
      destinationBatchId = await ensureBatchForStocking(ctx, opts, st)
      if (topup.batchId !== destinationBatchId) await ctx.db.patch(topup._id, { batchId: destinationBatchId })
    }
  }
  if (transfer.batchId !== batchId) await ctx.db.patch(transfer._id, { batchId })
  await op.transfer([
    {
      src,
      sourceUnitId: transfer.sourceCageId,
      batchId,
      destinationUnitId: transfer.destinationCageId,
      destinationBatchId,
      qty: transfer.quantity,
      abwG: transfer.abw,
      date: transfer.transferDate,
    },
  ])
}

export async function shadowTransfer(
  ctx: MutationCtx,
  transfer: Doc<'fishTransfers'>,
  userId?: Id<'users'>,
): Promise<Result> {
  if (transfer.status !== 'approved' || transfer.reversedAt) return none
  const cage = await ctx.db.get(transfer.sourceCageId)
  const opts = shadowOpts(cage, userId)
  if (!opts) return none
  const op = beginOperation(ctx, opts)
  await postTransfer(ctx, op, opts, transfer)
  return await op.commit()
}

/** Reverse every event of a source document (shadow). */
export async function shadowReverse(
  ctx: MutationCtx,
  cage: Doc<'cages'> | null,
  src: SourceRef,
  reason: string,
  userId?: Id<'users'>,
): Promise<Result> {
  const opts = shadowOpts(cage, userId)
  if (!opts) return none
  return await engine.reverseOperation(ctx, opts, src, reason)
}

/**
 * Daily mortality: (re)post the record's deaths on its cycle's batch and tag
 * the record with the batch. With `replace`, earlier events of the record
 * are reversed first (edit).
 */
export async function shadowDailyRecord(
  ctx: MutationCtx,
  record: Doc<'dailyRecords'>,
  userId: Id<'users'> | undefined,
  replace: boolean,
): Promise<Result> {
  const cage = await ctx.db.get(record.cageId)
  const opts = shadowOpts(cage, userId)
  if (!opts || !DATE_RE.test(record.date)) return none
  const batchId = await legacyBatchAt(ctx, opts, record.cageId, record.date)
  if (record.batchId !== (batchId ?? undefined)) {
    await ctx.db.patch(record._id, { batchId: batchId ?? undefined })
  }
  const src: SourceRef = { sourceTable: 'dailyRecords', sourceId: record._id }
  const op = beginOperation(ctx, opts)
  if (replace) await op.reverseSource(src, 'Daily record edited')
  else if (await sourceHasEvents(ctx, src)) return none
  if (batchId && isWhole(record.mortality)) {
    await op.mortality(src, { unitId: record.cageId, batchId, qty: record.mortality, date: record.date })
  }
  return await op.commit()
}

/** Tag a bi-weekly sample with the batch of its cycle. */
export async function tagBiweekly(
  ctx: MutationCtx,
  record: Doc<'biweeklyRecords'>,
  userId?: Id<'users'>,
) {
  const cage = await ctx.db.get(record.cageId)
  const opts = shadowOpts(cage, userId)
  if (!opts || !DATE_RE.test(record.date)) return
  const batchId = await legacyBatchAt(ctx, opts, record.cageId, record.date)
  if (record.batchId !== (batchId ?? undefined)) {
    await ctx.db.patch(record._id, { batchId: batchId ?? undefined })
  }
}

/** Feed (kg, cost) logged for a batch in a cage up to a date. */
export async function feedFor(
  ctx: Ctx,
  cageId: Id<'cages'>,
  batchId: Id<'batches'>,
  from: string,
  to: string,
) {
  const rows = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', cageId).gte('date', from).lte('date', to))
    .take(5000)
  let kg = 0
  let cost = 0
  for (const r of rows) {
    // Untagged rows (before the backfill) belong to the cycle by date window.
    if (r.batchId && r.batchId !== batchId) continue
    kg += r.feedAmount || 0
    cost += r.feedCost || 0
  }
  return { kg, cost }
}

/**
 * Harvest (create, edit, delete): reverse the record's earlier events when
 * replacing, then post the harvest on its cycle's batch; a complete harvest
 * carries the close-out. Stores the batch and the FCR computed from the
 * ledger with its inputs (PROD-009). Rows from the old sampling page post
 * nothing (doc 09 S12).
 */
export async function shadowHarvest(
  ctx: MutationCtx,
  record: Doc<'harvestRecords'>,
  userId: Id<'users'> | undefined,
  action: 'create' | 'update' | 'remove',
): Promise<Result> {
  const cage = await ctx.db.get(record.cageId)
  const opts = shadowOpts(cage, userId)
  if (!opts) return none
  const src: SourceRef = { sourceTable: 'harvestRecords', sourceId: record._id }
  const op = beginOperation(ctx, opts)
  if (action !== 'create') await op.reverseSource(src, action === 'remove' ? 'Harvest deleted' : 'Harvest edited')
  else if (await sourceHasEvents(ctx, src)) return none
  if (action === 'remove' || record.source === 'sampling_page' || !DATE_RE.test(record.harvestDate)) {
    return await op.commit()
  }
  const batchId = await legacyBatchAt(ctx, opts, record.cageId, record.harvestDate)
  if (!batchId) {
    op.warnings.push('Harvest cage has no stocking on record; not posted to the ledger')
    return await op.commit()
  }
  const complete = record.harvestType !== 'partial'
  await op.harvest(src, {
    unitId: record.cageId,
    batchId,
    qty: Math.max(0, Math.round(record.estimatedCount || 0)),
    kg: record.totalWeight,
    abwG: record.averageBodyWeight || undefined,
    date: record.harvestDate,
    complete,
  })
  const result = await op.commit()

  // FCR from the ledger as of the harvest date, stored with its inputs.
  const batch = await ctx.db.get(batchId)
  const events = await engine.eventsForPair(ctx, record.cageId, batchId)
  const feed = await feedFor(ctx, record.cageId, batchId, batch?.openedOn ?? '0000-00-00', record.harvestDate)
  const k = occupancyKpis({
    events,
    samples: await engine.samplesFor(ctx, record.cageId, batchId),
    feedKg: feed.kg,
    feedCost: feed.cost,
    asOf: record.harvestDate,
  })
  const fcrValue = efcr(feed.kg, k.gain_kg)
  await ctx.db.patch(record._id, {
    batchId,
    fcrInputs: {
      feedKg: Math.round(feed.kg * 10) / 10,
      gainKg: k.gain_kg,
      method: complete ? 'complete' : 'interim',
      efcr: fcrValue == null ? null : Math.round(fcrValue * 100) / 100,
    },
  })
  return result
}

/**
 * A manual count edit on the cage form becomes a labelled count adjustment
 * (with a `stockOperations` source document) on the cage's open batch.
 */
export async function shadowCountEdit(
  ctx: MutationCtx,
  cage: Doc<'cages'>,
  from: number,
  to: number,
  userId: Id<'users'> | undefined,
  date: string,
): Promise<Result> {
  const opts = shadowOpts(cage, userId)
  const delta = to - from
  if (!opts || !Number.isInteger(delta) || delta === 0) return none
  const batchId =
    (await engine.openBatchInUnit(ctx, cage._id, date)) ?? (await legacyBatchAt(ctx, opts, cage._id, date))
  if (!batchId) return none
  const opId = await ctx.db.insert('stockOperations', {
    companyId: opts.companyId,
    locationId: cage.locationId,
    kind: 'count_adjustment',
    operationDate: date,
    status: 'approved',
    unitId: cage._id,
    reason: 'Count edited on the cage form',
    createdBy: userId,
    updatedAt: Date.now(),
  })
  return await engine.adjustCount(ctx, opts, { sourceTable: 'stockOperations', sourceId: opId }, {
    unitId: cage._id,
    batchId,
    qtyDelta: delta,
    date,
    reason: 'Count edited on the cage form',
  })
}
