/**
 * Writers → engine (doc 05 §9.2 steps 3–4, PROD-004).
 *
 * Every writer of a fish count (stocking, top-up, fish transfer, harvest,
 * daily mortality, manual count edits) opens a `StockWrite` on the cages it
 * touches, runs its usual arithmetic, then posts the change through these
 * helpers via `write.post(...)`.
 *
 * - Cutover (step 4): a cage whose ledger is in step with its count
 *   (Σ events = `currentCount`, which holds for every cage that started
 *   empty after dual-write and every backfilled cage) is owned by the
 *   engine. The engine runs `strict` with the `engine` cache and writes
 *   `currentCount`; the legacy arithmetic only serves as a parity check
 *   (a mismatch comes back as a warning and is logged).
 * - Dual-write (step 3): any other cage keeps the legacy count and the
 *   engine posts in `shadow` mode with the `legacy` cache, so a ledger that
 *   has not been backfilled yet never blocks daily work; the nightly
 *   reconciliation (convex/reconciliation.ts) reports drift.
 * - Rollback: `PRODUCTION_ENGINE_CUTOVER=off` puts every cage back on
 *   dual-write.
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
import { efcr, flowsOf, occupancyKpis, type LedgerEvent } from './kpi'
import * as engine from './productionEngine'
import { userError } from './errors'

type Ctx = QueryCtx | MutationCtx

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isWhole = (n: number) => Number.isInteger(n) && n > 0

/** Rollback switch for the cutover (deployment env var). */
export const cutoverEnabled = () => process.env.PRODUCTION_ENGINE_CUTOVER !== 'off'

/**
 * Whether Σ events of the cage equals its cached count (doc 05 I7). A cage
 * with no events but with stocking history predates the ledger (not yet
 * backfilled), so it is not in step even when both read zero.
 */
export async function ledgerInStep(ctx: Ctx, cage: Doc<'cages'>) {
  const events = await engine.eventsForUnit(ctx, cage._id)
  if (events.reduce((s, e) => s + e.qtyDelta, 0) !== (cage.currentCount ?? 0)) return false
  if (events.length > 0) return true
  return (await approvedStockings(ctx, cage._id)).length === 0
}

export type StockWrite = {
  /** True when the engine writes the count (cutover); false on dual-write. */
  readonly engine: boolean
  readonly opts: EngineOptions | null
  /**
   * Post the change through the engine. On cutover the legacy count the
   * writer patched is set aside as the parity oracle, the engine moves the
   * count from where it was, and any difference is returned as a warning.
   */
  post(fn: (opts: EngineOptions | null) => Promise<Result>): Promise<Result>
}

/**
 * Open a stock write on the cages an operation touches, before the writer
 * patches any of them. The engine owns the write only when it owns every
 * cage (same company, ledger in step).
 */
export async function beginStockWrite(
  ctx: MutationCtx,
  cages: Array<Doc<'cages'> | null | undefined>,
  userId?: Id<'users'>,
): Promise<StockWrite> {
  const list = cages.filter((c): c is Doc<'cages'> => !!c)
  const first = list[0]
  let owned = cutoverEnabled() && !!first?.companyId && list.every((c) => c.companyId === first.companyId)
  for (const c of list) {
    if (!owned) break
    owned = await ledgerInStep(ctx, c)
  }
  const snapshot = new Map(list.map((c) => [c._id, c.currentCount] as const))
  const opts: EngineOptions | null = owned
    ? { companyId: first!.companyId!, userId, mode: 'strict', cache: 'engine' }
    : shadowOpts(first, userId)
  return {
    engine: owned,
    opts,
    async post(fn) {
      if (!owned) return await fn(opts)
      const legacy = new Map<Id<'cages'>, number>()
      for (const [id, before] of snapshot) {
        const now = (await ctx.db.get(id))?.currentCount
        legacy.set(id, now ?? 0)
        if (now !== before) await ctx.db.patch(id, { currentCount: before })
      }
      const result = await fn(opts)
      const warnings = [...result.warnings]
      // The engine posted nothing although the legacy count moved: the source
      // record predates the ledger, so its legacy effect stands.
      let untouched = true
      for (const [id, before] of snapshot) {
        if (((await ctx.db.get(id))?.currentCount ?? 0) !== (before ?? 0)) untouched = false
      }
      const legacyMoved = [...legacy].some(([id, n]) => n !== (snapshot.get(id) ?? 0))
      if (untouched && legacyMoved) {
        for (const [id, n] of legacy) await ctx.db.patch(id, { currentCount: n })
        console.warn('PROD-004 legacy fallback', { cageIds: [...legacy.keys()] })
        return result
      }
      for (const [id, expected] of legacy) {
        const cage = await ctx.db.get(id)
        const got = cage?.currentCount ?? 0
        if (got === expected) continue
        const msg = `Stock ledger and legacy count disagree for ${cage?.name ?? 'a cage'}: ledger ${got.toLocaleString()}, legacy ${expected.toLocaleString()}`
        console.warn('PROD-004 parity', { cageId: id, ledger: got, legacy: expected })
        warnings.push(msg)
      }
      return { ...result, warnings }
    },
  }
}

/** Shadow options for a cage's company; null for cages with no company. */
export function shadowOpts(
  cage: { companyId?: Id<'companies'> } | null | undefined,
  userId?: Id<'users'>,
): EngineOptions | null {
  if (!cage?.companyId) return null
  return { companyId: cage.companyId, userId, mode: 'shadow', cache: 'legacy' }
}

const optsFor = (
  override: EngineOptions | null | undefined,
  cage: Doc<'cages'> | null | undefined,
  userId?: Id<'users'>,
) => (override !== undefined ? override : shadowOpts(cage, userId))

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
  override?: EngineOptions | null,
): Promise<Result> {
  const cage = await ctx.db.get(stocking.cageId)
  const opts = optsFor(override, cage, userId)
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

/**
 * An approved stocking's weight was edited: restate its stock_in (reverse and
 * post again with the new ABW/biomass, same count and date) so the gain and
 * the harvest FCR follow the edit (PROD-009). Count or date edits are not
 * restated; they need a count correction on the cage.
 */
export async function restateStocking(
  ctx: MutationCtx,
  before: Doc<'stockingHistory'>,
  after: Doc<'stockingHistory'>,
  userId?: Id<'users'>,
): Promise<Result> {
  if (after.status !== 'approved' || after.deletedAt || !after.batchId) return none
  if (before.fishCount !== after.fishCount || before.stockingDate !== after.stockingDate) return none
  if (before.initialAbw === after.initialAbw && before.initialBiomass === after.initialBiomass) return none
  if (await transferForStocking(ctx, after._id)) return none
  const src: SourceRef = { sourceTable: 'stockingHistory', sourceId: after._id }
  if (!(await sourceHasEvents(ctx, src))) return none
  const cage = await ctx.db.get(after.cageId)
  const write = await beginStockWrite(ctx, [cage], userId)
  const result = await write.post(async (opts) => {
    if (!opts) return none
    const op = beginOperation(ctx, opts)
    await op.reverseSource(src, 'Stocking weight edited')
    await op.stockIn(src, {
      unitId: after.cageId,
      batchId: after.batchId!,
      qty: after.fishCount,
      abwG: after.initialAbw,
      biomassKg: after.initialBiomass,
      date: after.stockingDate,
    })
    return await op.commit()
  })
  await refreshHarvestFcrs(ctx, after.cageId, after.stockingDate)
  return result
}

/** stock_in on the stocking's batch for an approved top-up (not transfer-made). */
export async function shadowTopup(
  ctx: MutationCtx,
  topup: Doc<'topupHistory'>,
  userId?: Id<'users'>,
  override?: EngineOptions | null,
): Promise<Result> {
  if (topup.status !== 'approved') return none
  if (await transferForTopup(ctx, topup._id)) return none
  const stocking = await ctx.db.get(topup.stockingId)
  if (!stocking) return none
  const cage = await ctx.db.get(stocking.cageId)
  const opts = optsFor(override, cage, userId)
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
  override?: EngineOptions | null,
): Promise<Result> {
  if (transfer.status !== 'approved' || transfer.reversedAt) return none
  const cage = await ctx.db.get(transfer.sourceCageId)
  const opts = optsFor(override, cage, userId)
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
  override?: EngineOptions | null,
): Promise<Result> {
  const opts = optsFor(override, cage, userId)
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
  override?: EngineOptions | null,
): Promise<Result> {
  const cage = await ctx.db.get(record.cageId)
  const opts = optsFor(override, cage, userId)
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
  override?: EngineOptions | null,
): Promise<Result> {
  const cage = await ctx.db.get(record.cageId)
  const opts = optsFor(override, cage, userId)
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
  await ctx.db.patch(record._id, { batchId })
  await storeHarvestFcr(ctx, record._id)
  return result
}

/**
 * Harvest FCR from the ledger as of the harvest date, with its inputs
 * (doc 05 §6, PROD-009): occupancy eFCR for a complete harvest, interim eFCR
 * for a partial one. Null for rows that are not harvests or have no batch.
 */
export async function harvestFcrInputs(ctx: Ctx, record: Doc<'harvestRecords'>) {
  if (!record.batchId || record.source === 'sampling_page') return null
  const batch = await ctx.db.get(record.batchId)
  const events = await engine.eventsForPair(ctx, record.cageId, record.batchId)
  const feed = await feedFor(ctx, record.cageId, record.batchId, batch?.openedOn ?? '0000-00-00', record.harvestDate)
  const k = occupancyKpis({
    events,
    samples: await engine.samplesFor(ctx, record.cageId, record.batchId),
    feedKg: feed.kg,
    feedCost: feed.cost,
    asOf: record.harvestDate,
  })
  const value = efcr(feed.kg, k.gain_kg)
  return {
    feedKg: Math.round(feed.kg * 10) / 10,
    gainKg: k.gain_kg,
    method: record.harvestType === 'partial' ? ('interim' as const) : ('complete' as const),
    efcr: value == null ? null : Math.round(value * 100) / 100,
  }
}

/**
 * FCR a harvest about to be saved would get (PROD-009 form preview): the
 * cage's ledger plus the planned harvest (and, for a complete harvest, the
 * closeout of whatever is left). Null when the cage has no open batch.
 */
export async function previewHarvestFcr(
  ctx: Ctx,
  a: {
    cageId: Id<'cages'>
    harvestDate: string
    totalWeight: number
    estimatedCount: number
    harvestType: 'complete' | 'partial'
  },
) {
  const batchId = await engine.openBatchInUnit(ctx, a.cageId, a.harvestDate)
  if (!batchId) return null
  const batch = await ctx.db.get(batchId)
  const events: LedgerEvent[] = (await engine.eventsForPair(ctx, a.cageId, batchId)).filter(
    (e) => e.eventDate <= a.harvestDate,
  )
  const qty = Math.max(0, Math.round(a.estimatedCount || 0))
  const last = { eventDate: a.harvestDate, recordedAt: Number.MAX_SAFE_INTEGER }
  events.push({
    ...last,
    type: 'harvest',
    qtyDelta: -qty,
    biomassKgDelta: -Math.max(0, a.totalWeight || 0),
    intraDayOrder: engine.intraDayOrder('harvest', -qty),
  })
  if (a.harvestType !== 'partial') {
    const left = flowsOf(events).count
    if (left !== 0) {
      events.push({
        ...last,
        type: 'count_adjustment',
        component: engine.CLOSEOUT,
        qtyDelta: -left,
        biomassKgDelta: 0,
        intraDayOrder: Number.MAX_SAFE_INTEGER,
      })
    }
  }
  const feed = await feedFor(ctx, a.cageId, batchId, batch?.openedOn ?? '0000-00-00', a.harvestDate)
  const k = occupancyKpis({
    events,
    samples: await engine.samplesFor(ctx, a.cageId, batchId),
    feedKg: feed.kg,
    asOf: a.harvestDate,
  })
  const value = efcr(feed.kg, k.gain_kg)
  return {
    fcr: value == null ? null : Math.round(value * 100) / 100,
    feedKg: Math.round(feed.kg * 10) / 10,
    gainKg: k.gain_kg,
    stockedBiomassKg: k.stocked_biomass_kg,
    openedOn: k.opened_on,
    method: a.harvestType === 'partial' ? ('interim' as const) : ('complete' as const),
  }
}

/** (Re)compute and store a harvest's FCR; the stored `fcr` is never typed. */
export async function storeHarvestFcr(ctx: MutationCtx, harvestId: Id<'harvestRecords'>) {
  const record = await ctx.db.get(harvestId)
  if (!record) return null
  const fcrInputs = await harvestFcrInputs(ctx, record)
  if (!fcrInputs) return null
  const fcr = fcrInputs.efcr ?? 0
  const same =
    record.fcr === fcr &&
    record.fcrInputs?.feedKg === fcrInputs.feedKg &&
    record.fcrInputs?.gainKg === fcrInputs.gainKg &&
    record.fcrInputs?.method === fcrInputs.method &&
    record.fcrInputs?.efcr === fcrInputs.efcr
  if (!same) await ctx.db.patch(harvestId, { fcrInputs, fcr })
  return fcrInputs
}

/**
 * Upstream records changed (daily feed, a sample's ABW, a stocking's
 * weight): recompute the stored FCR of the cage's harvests on or after
 * `fromDate` (PROD-009).
 */
export async function refreshHarvestFcrs(ctx: MutationCtx, cageId: Id<'cages'>, fromDate: string) {
  const rows = await ctx.db
    .query('harvestRecords')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .take(500)
  for (const h of rows) {
    if (h.harvestDate >= fromDate && h.batchId) await storeHarvestFcr(ctx, h._id)
  }
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
  override?: EngineOptions | null,
): Promise<Result> {
  const opts = optsFor(override, cage, userId)
  const delta = to - from
  if (!opts || !Number.isInteger(delta) || delta === 0) return none
  const batchId =
    (await engine.openBatchInUnit(ctx, cage._id, date)) ?? (await legacyBatchAt(ctx, opts, cage._id, date))
  if (!batchId) {
    if (opts.mode === 'strict') {
      throw userError('VALIDATION', `${cage.name} has no stocked batch to correct. Record a stocking instead of typing a fish count.`)
    }
    return none
  }
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
