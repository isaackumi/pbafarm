/**
 * Traceability reads and withdrawal enforcement (Phase 12: TRACE-002,
 * TRACE-003, TRACE-004, PROD-012).
 *
 * Everything here derives from the production ledger (`stockEvents`): a
 * batch's occupancies (which cage, from when to when) are the join key for
 * treatments, daily feed and feed lots. Reads are bounded: at most
 * MAX_TRACE_BATCHES batches (the batch and its ancestors), engine limits per
 * batch, and `take` limits on every other index read.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { logAudit } from './tenancy'
import { userError } from './errors'
import * as engine from './productionEngine'

type Ctx = QueryCtx | MutationCtx

export const MAX_TRACE_BATCHES = 25
const TREATMENT_LIMIT = 1000
const DAILY_LIMIT = 5000
const PURCHASE_LIMIT = 2000

export type Occupancy = {
  batchId: Id<'batches'>
  unitId: Id<'cages'>
  from: string
  /** Last day the batch had fish in the unit (inclusive); null while open. */
  to: string | null
}

/** Each stay of a batch in a unit, from its live (non-reversed) events. */
export function occupanciesOf(events: Doc<'stockEvents'>[]): Occupancy[] {
  const live = engine.activeEvents(events).sort(engine.compareLedger)
  const byUnit = new Map<string, Doc<'stockEvents'>[]>()
  for (const e of live) {
    const k = String(e.unitId)
    if (!byUnit.has(k)) byUnit.set(k, [])
    byUnit.get(k)!.push(e)
  }
  const out: Occupancy[] = []
  for (const list of byUnit.values()) {
    // A batch can leave a cage and come back: split into stays at zero.
    let count = 0
    let from: string | null = null
    for (const e of list) {
      if (from === null && e.qtyDelta > 0) from = e.eventDate
      count += e.qtyDelta
      if (from !== null && count <= 0) {
        out.push({ batchId: e.batchId, unitId: e.unitId, from, to: e.eventDate })
        from = null
        count = 0
      }
    }
    if (from !== null) out.push({ batchId: list[0].batchId, unitId: list[0].unitId, from, to: null })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}

const within = (date: string, o: { from: string; to: string | null }) =>
  date >= o.from && (o.to === null || date <= o.to)

/** The batch and its ancestors (nearest first), at most MAX_TRACE_BATCHES. */
export async function batchWithAncestors(ctx: Ctx, batch: Doc<'batches'>) {
  const lin = await engine.lineage(ctx, batch._id)
  const out: Array<{ batch: Doc<'batches'>; depth: number }> = [{ batch, depth: 0 }]
  for (const a of lin.ancestors) {
    if (out.length >= MAX_TRACE_BATCHES) break
    const doc = await ctx.db.get(a._id)
    if (doc && doc.companyId === batch.companyId) out.push({ batch: doc, depth: a.depth })
  }
  return out
}

/** Occupancies of several batches, read once per batch. */
export async function occupanciesFor(ctx: Ctx, batchIds: Id<'batches'>[]) {
  const all: Occupancy[] = []
  const events: Doc<'stockEvents'>[] = []
  for (const id of batchIds) {
    const ev = await engine.eventsForBatch(ctx, id)
    events.push(...ev)
    all.push(...occupanciesOf(ev))
  }
  return { occupancies: all, events }
}

export type TreatmentRow = Doc<'healthTreatments'> & { batchId: Id<'batches'> }

/** Treatments given in a cage while one of these batches was in it (TRACE-003). */
export async function treatmentsDuring(ctx: Ctx, occupancies: Occupancy[]) {
  const byUnit = new Map<string, Occupancy[]>()
  for (const o of occupancies) {
    const k = String(o.unitId)
    if (!byUnit.has(k)) byUnit.set(k, [])
    byUnit.get(k)!.push(o)
  }
  const out: TreatmentRow[] = []
  const seen = new Set<string>()
  for (const [unit, stays] of byUnit) {
    const rows = await ctx.db
      .query('healthTreatments')
      .withIndex('by_cage', (q) => q.eq('cageId', unit as Id<'cages'>))
      .take(TREATMENT_LIMIT)
    for (const t of rows) {
      const stay = stays.find((o) => within(t.date, o))
      if (!stay || seen.has(String(t._id))) continue
      seen.add(String(t._id))
      out.push({ ...t, batchId: stay.batchId })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Treatments whose withdrawal period still covers `date` for the fish in a
 * cage. With a ledger, the batch in the cage on that date and its ancestors
 * (fish carry a withdrawal with them when moved or graded); without one, the
 * cage's own treatments.
 */
export async function blockingTreatments(
  ctx: Ctx,
  cageId: Id<'cages'>,
  date: string,
  batchId?: Id<'batches'> | null,
): Promise<Doc<'healthTreatments'>[]> {
  const active = (t: Doc<'healthTreatments'>) =>
    !!t.withdrawalUntil && t.withdrawalUntil >= date && t.date <= date
  const batch = batchId ?? (await engine.openBatchInUnit(ctx, cageId, date))
  const doc = batch ? await ctx.db.get(batch) : null
  if (doc) {
    const chain = await batchWithAncestors(ctx, doc)
    const { occupancies } = await occupanciesFor(ctx, chain.map((c) => c.batch._id))
    // The current stay may not have events up to `date` yet: keep it open.
    const rows = await treatmentsDuring(
      ctx,
      occupancies.map((o) => (o.batchId === doc._id && o.unitId === cageId ? { ...o, to: null } : o)),
    )
    return rows.filter(active)
  }
  const rows = await ctx.db
    .query('healthTreatments')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .take(TREATMENT_LIMIT)
  return rows.filter(active)
}

export type WithdrawalOverride = Doc<'harvestRecords'>['withdrawalOverride']

/**
 * PROD-012: refuse a harvest, sale or dispatch while a withdrawal period
 * covers the fish, unless an admin gives a reason. The override is written to
 * the audit log and returned for the record to keep.
 */
export async function enforceWithdrawal(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: {
    cageId: Id<'cages'>
    date: string
    action: 'harvest' | 'sale' | 'dispatch'
    overrideReason?: string
    batchId?: Id<'batches'> | null
  },
): Promise<WithdrawalOverride> {
  const blocking = await blockingTreatments(ctx, args.cageId, args.date, args.batchId)
  if (!blocking.length) return undefined
  const until = blocking.reduce((m, t) => (t.withdrawalUntil! > m ? t.withdrawalUntil! : m), '')
  const products = [...new Set(blocking.map((t) => t.productName || t.treatment))].join(', ')
  const reason = args.overrideReason?.trim()
  if (!reason) {
    throw userError(
      'WITHDRAWAL_ACTIVE',
      `These fish are in a withdrawal period until ${until} (${products}). ` +
        `A ${args.action} on ${args.date} is not allowed; an admin can record it with an override reason.`,
      { until, action: args.action, treatments: blocking.length },
    )
  }
  const role = user.role ?? 'user'
  if (role !== 'admin' && role !== 'super_admin') {
    throw userError('FORBIDDEN', 'Only an admin can override a withdrawal period.')
  }
  const cage = await ctx.db.get(args.cageId)
  const override = {
    reason,
    by: user._id,
    at: Date.now(),
    until,
    treatmentIds: blocking.map((t) => t._id),
  }
  await logAudit(ctx, {
    actionType: 'withdrawal_override',
    tableName: args.action === 'harvest' ? 'harvestRecords' : args.action === 'sale' ? 'sales' : 'dispatches',
    recordId: String(args.cageId),
    newValues: { ...override, cageId: args.cageId, date: args.date, action: args.action },
    locationId: cage?.locationId,
  })
  return override
}

// ---------------------------------------------------------------------------
// Harvest lots (TRACE-004)
// ---------------------------------------------------------------------------

/** A readable, unique lot code: <batch or cage>-<yymmdd>-<n>. */
export async function nextLotCode(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  harvest: Doc<'harvestRecords'>,
) {
  const batch = harvest.batchId ? await ctx.db.get(harvest.batchId) : null
  const cage = await ctx.db.get(harvest.cageId)
  const stem = (batch?.batchNumber || cage?.code || cage?.name || 'LOT')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const day = harvest.harvestDate.replace(/-/g, '').slice(2)
  const existing = (
    await ctx.db
      .query('harvestLots')
      .withIndex('by_harvestId', (q) => q.eq('harvestId', harvest._id))
      .take(200)
  ).length
  for (let n = existing + 1; n < existing + 100; n++) {
    const code = `${stem}-${day}-${n}`
    const clash = await ctx.db
      .query('harvestLots')
      .withIndex('by_companyId_and_lotCode', (q) => q.eq('companyId', companyId).eq('lotCode', code))
      .first()
    if (!clash) return code
  }
  throw userError('CONFLICT', 'Could not find a free lot code; enter one by hand')
}

// ---------------------------------------------------------------------------
// Feed lots (TRACE-002)
// ---------------------------------------------------------------------------

export type FeedLotRow = {
  feedTypeId: Id<'feedTypes'>
  feedTypeName: string
  /** Kg of this feed the batch(es) ate. */
  kgFed: number
  firstFed: string
  lastFed: string
  lots: Array<{
    purchaseId: Id<'feedPurchases'>
    lotNumber: string | null
    receivedOn: string
    quantityKg: number
    expiryDate: string | null
    supplierName: string | null
    poNumber: string | null
  }>
}

/**
 * Feed eaten during the given occupancies, by feed type, with the lots that
 * were at the site at the time. Lots are not tracked per bag, so the lots
 * shown are the candidates under first-in-first-out: the last lot received
 * on or before the first feeding, and every lot received until the last one.
 */
export async function feedLotsFor(ctx: Ctx, occupancies: Occupancy[]): Promise<FeedLotRow[]> {
  type Acc = { kg: number; first: string; last: string; locations: Set<string> }
  const byType = new Map<string, Acc>()
  const add = (feedTypeId: string, kg: number, date: string, locationId?: string) => {
    if (!(kg > 0)) return
    const a = byType.get(feedTypeId) ?? { kg: 0, first: date, last: date, locations: new Set<string>() }
    a.kg += kg
    if (date < a.first) a.first = date
    if (date > a.last) a.last = date
    if (locationId) a.locations.add(locationId)
    byType.set(feedTypeId, a)
  }
  for (const o of occupancies) {
    const cage = await ctx.db.get(o.unitId)
    const rows = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) =>
        o.to ? q.eq('cageId', o.unitId).gte('date', o.from).lte('date', o.to) : q.eq('cageId', o.unitId).gte('date', o.from),
      )
      .take(DAILY_LIMIT)
    for (const r of rows) {
      if (r.batchId && r.batchId !== o.batchId) continue
      if (r.feedTypeId) add(String(r.feedTypeId), r.feedAmount || 0, r.date, cage?.locationId)
    }
    const issues = await ctx.db
      .query('feedUsage')
      .withIndex('by_cage', (q) => q.eq('cageId', o.unitId))
      .take(DAILY_LIMIT)
    for (const u of issues) {
      if (u.deletedAt || u.source === 'daily' || !within(u.usageDate, o)) continue
      add(String(u.feedTypeId), u.quantity || 0, u.usageDate, cage?.locationId ?? u.locationId)
    }
  }

  const supplierNames = new Map<string, string | null>()
  const supplierName = async (id?: Id<'feedSuppliers'>) => {
    if (!id) return null
    if (!supplierNames.has(String(id))) supplierNames.set(String(id), (await ctx.db.get(id))?.name ?? null)
    return supplierNames.get(String(id))!
  }
  const out: FeedLotRow[] = []
  for (const [typeId, acc] of byType) {
    const feedType = await ctx.db.get(typeId as Id<'feedTypes'>)
    const purchases = (
      await ctx.db
        .query('feedPurchases')
        .withIndex('by_feed_type', (q) => q.eq('feedTypeId', typeId as Id<'feedTypes'>))
        .take(PURCHASE_LIMIT)
    )
      .filter(
        (p) =>
          !p.deletedAt &&
          p.companyId === feedType?.companyId &&
          (!p.locationId || acc.locations.size === 0 || acc.locations.has(String(p.locationId))) &&
          p.purchaseDate <= acc.last,
      )
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
    const before = purchases.filter((p) => p.purchaseDate <= acc.first)
    const opening = before[before.length - 1]
    const candidates = purchases.filter(
      (p) => p.purchaseDate > acc.first || (opening && p.purchaseDate === opening.purchaseDate),
    )
    const lots = []
    for (const p of candidates) {
      lots.push({
        purchaseId: p._id,
        lotNumber: p.batchNumber ?? null,
        receivedOn: p.purchaseDate,
        quantityKg: p.quantity,
        expiryDate: p.expiryDate ?? null,
        supplierName: await supplierName(p.supplierId),
        poNumber: p.notes?.match(/^Received on (\S+)/)?.[1] ?? null,
      })
    }
    out.push({
      feedTypeId: typeId as Id<'feedTypes'>,
      feedTypeName: feedType?.name ?? 'Unknown feed',
      kgFed: Math.round(acc.kg * 10) / 10,
      firstFed: acc.first,
      lastFed: acc.last,
      lots,
    })
  }
  return out.sort((a, b) => a.firstFed.localeCompare(b.firstFed))
}

// ---------------------------------------------------------------------------
// Journey: where did these fish come from (TRACE-001 extended)
// ---------------------------------------------------------------------------

export type JourneyStep = {
  date: string
  kind: 'stocked' | 'topped_up' | 'transfer_in' | 'transfer_out' | 'graded' | 'merged' | 'harvested'
  batchNumber: string
  cageName: string
  counterpartCage: string | null
  counterpartBatch: string | null
  qty: number
  kg: number
  /** Hatchery or supplier for a stocking; supervisor for a transfer. */
  source: string | null
}

const KIND: Partial<Record<Doc<'stockEvents'>['type'], JourneyStep['kind']>> = {
  stock_in: 'stocked',
  transfer_in: 'transfer_in',
  transfer_out: 'transfer_out',
  grading_split: 'graded',
  merge: 'merged',
  harvest: 'harvested',
}

/** Movements of the batch and its ancestors, oldest first, with their sources. */
export async function journeyOf(ctx: Ctx, events: Doc<'stockEvents'>[]): Promise<JourneyStep[]> {
  const live = engine.activeEvents(events).sort(engine.compareLedger)
  const cages = new Map<string, string>()
  const batches = new Map<string, string>()
  const cageName = async (id?: Id<'cages'>) => {
    if (!id) return null
    if (!cages.has(String(id))) cages.set(String(id), (await ctx.db.get(id))?.name ?? '—')
    return cages.get(String(id))!
  }
  const batchNo = async (id?: Id<'batches'>) => {
    if (!id) return null
    if (!batches.has(String(id))) batches.set(String(id), (await ctx.db.get(id))?.batchNumber ?? '—')
    return batches.get(String(id))!
  }
  const out: JourneyStep[] = []
  for (const e of live) {
    let kind = KIND[e.type]
    if (!kind || e.component === engine.CLOSEOUT) continue
    // Only one side of a grading or merge is shown: the inflow to a child.
    if ((e.type === 'grading_split' || e.type === 'merge') && e.qtyDelta < 0) continue
    let source: string | null = null
    if (e.sourceTable === 'stockingHistory') {
      const id = ctx.db.normalizeId('stockingHistory', e.sourceId)
      const s = id ? await ctx.db.get(id) : null
      source = [s?.sourceLocation, s?.sourceCage].filter(Boolean).join(' · ') || null
    } else if (e.sourceTable === 'topupHistory') {
      kind = 'topped_up'
      const id = ctx.db.normalizeId('topupHistory', e.sourceId)
      const s = id ? await ctx.db.get(id) : null
      source = s?.sourceLocation ?? null
    } else if (e.sourceTable === 'fishTransfers') {
      const id = ctx.db.normalizeId('fishTransfers', e.sourceId)
      const s = id ? await ctx.db.get(id) : null
      source = s?.transferSupervisor ?? null
    }
    out.push({
      date: e.eventDate,
      kind,
      batchNumber: (await batchNo(e.batchId))!,
      cageName: (await cageName(e.unitId))!,
      counterpartCage: await cageName(e.counterpartUnitId),
      counterpartBatch: await batchNo(e.counterpartBatchId),
      qty: Math.abs(e.qtyDelta),
      kg: Math.round(Math.abs(e.biomassKgDelta) * 10) / 10,
      source,
    })
  }
  return out
}
