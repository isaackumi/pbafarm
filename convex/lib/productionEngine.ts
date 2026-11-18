/**
 * Production engine (D-004, docs/architecture/05-production-engine-design.md).
 *
 * The only writer of `stockEvents` (I1): an append-only, signed ledger of fish
 * per (cage, batch). Every change of a fish count is an event; a correction is
 * a `reversal` event, never an edit. Operations run inside the caller's
 * mutation, so the business document, its events and the cage cache commit
 * together.
 *
 *   const op = beginOperation(ctx, { companyId, userId })
 *   await op.reverseSource(src, 'edited')        // optional: replace
 *   await op.harvest(src, { unitId, qty, kg, date, complete: true })
 *   const { eventIds, warnings } = await op.commit()
 *
 * or the one-call wrappers below (`stockIn`, `recordMortality`, `transfer`,
 * `harvest`, `gradingSplit`, `merge`, `adjustCount`, `reverse`,
 * `reverseOperation`).
 *
 * Modes
 * - `strict` (default): invariant violations (negative stock I3, two batches
 *   open in one cage I4, bad dates I9) throw and roll back the mutation.
 * - `shadow`: dual-write from legacy writers while their own cage patches
 *   stay authoritative. Violations become warnings, so a ledger that has not
 *   been backfilled yet never blocks daily work.
 *
 * Cache
 * - `engine` (default): the engine moves `cages.currentCount` by the
 *   operation's net change and keeps status, `currentBatchId` and the
 *   occupancy fields in step.
 * - `legacy`: the caller already patched the count; the engine only keeps
 *   `currentBatchId`.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { userError } from './errors'
import { abwAsOf, biomassKg, compareEvents, type Sample } from './kpi'

type Ctx = QueryCtx | MutationCtx

export type StockEventType = Doc<'stockEvents'>['type']
export type PostableType = Exclude<StockEventType, 'reversal'>
export type StockSourceTable = Doc<'stockEvents'>['sourceTable']
export type SourceRef = { sourceTable: StockSourceTable; sourceId: string }
export type BatchOrigin = Doc<'batches'>['origin']

export type EngineOptions = {
  companyId: Id<'companies'>
  userId?: Id<'users'>
  mode?: 'strict' | 'shadow'
  cache?: 'engine' | 'legacy'
}

export type StockEventInput = {
  type: PostableType
  unitId: Id<'cages'>
  batchId: Id<'batches'>
  qtyDelta: number
  biomassKgDelta?: number
  abwG?: number
  abwSource?: 'measured' | 'estimated'
  eventDate: string
  component?: string
  counterpartUnitId?: Id<'cages'>
  counterpartBatchId?: Id<'batches'>
  reason?: string
}

/** Reads per unit/batch are bounded (one occupancy is ~1 event a day). */
export const MAX_EVENTS = 10_000
export const MAX_PARENTS = 20
export const MAX_LINES = 20
export const CLOSEOUT = 'closeout'

const EMPTY_STATUSES = new Set(['empty', 'harvested', 'fallow'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Same-day order (doc 05 §5): inflows, + adjustments, deaths/− adjustments, outflows. */
export function intraDayOrder(type: StockEventType, qtyDelta: number): number {
  switch (type) {
    case 'stock_in':
    case 'transfer_in':
      return 0
    case 'grading_split':
    case 'merge':
      return qtyDelta > 0 ? 0 : 3
    case 'count_adjustment':
      return qtyDelta > 0 ? 1 : 2
    case 'mortality':
      return 2
    default:
      return 3
  }
}

/** Sign each event type must carry (I10); 0 = either. */
const SIGN: Record<PostableType, 1 | -1 | 0> = {
  stock_in: 1,
  transfer_in: 1,
  mortality: -1,
  harvest: -1,
  transfer_out: -1,
  grading_split: 0,
  merge: 0,
  count_adjustment: 0,
}

const validDate = (d: string) => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Ledger order with creation time as the final tie-break. */
export function compareLedger(a: Doc<'stockEvents'>, b: Doc<'stockEvents'>) {
  return compareEvents(a, b) || a._creationTime - b._creationTime
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function eventsForUnit(ctx: Ctx, unitId: Id<'cages'>, upTo?: string) {
  return await ctx.db
    .query('stockEvents')
    .withIndex('by_unitId_and_eventDate', (q) =>
      upTo ? q.eq('unitId', unitId).lte('eventDate', upTo) : q.eq('unitId', unitId),
    )
    .take(MAX_EVENTS)
}

export async function eventsForPair(ctx: Ctx, unitId: Id<'cages'>, batchId: Id<'batches'>) {
  return await ctx.db
    .query('stockEvents')
    .withIndex('by_unitId_and_batchId_and_eventDate', (q) =>
      q.eq('unitId', unitId).eq('batchId', batchId),
    )
    .take(MAX_EVENTS)
}

export async function eventsForBatch(ctx: Ctx, batchId: Id<'batches'>) {
  return await ctx.db
    .query('stockEvents')
    .withIndex('by_batchId_and_eventDate', (q) => q.eq('batchId', batchId))
    .take(MAX_EVENTS)
}

export async function eventsForSource(ctx: Ctx, src: SourceRef) {
  return await ctx.db
    .query('stockEvents')
    .withIndex('by_sourceTable_and_sourceId', (q) =>
      q.eq('sourceTable', src.sourceTable).eq('sourceId', src.sourceId),
    )
    .take(1000)
}

/** Events that are neither reversals nor reversed. */
export function activeEvents(events: Doc<'stockEvents'>[]) {
  const reversed = new Set(events.map((e) => e.reversesEventId).filter(Boolean).map(String))
  return events.filter((e) => e.type !== 'reversal' && !reversed.has(String(e._id)))
}

/** Whether a source document already has live events (dual-write / backfill idempotency). */
export async function sourceHasEvents(ctx: Ctx, src: SourceRef) {
  return activeEvents(await eventsForSource(ctx, src)).length > 0
}

const sum = (events: Array<{ qtyDelta: number }>) => events.reduce((s, e) => s + e.qtyDelta, 0)

/** Count per batch in a unit, from the given events. */
function balancesByBatch(events: Doc<'stockEvents'>[]) {
  const m = new Map<string, number>()
  for (const e of events) m.set(String(e.batchId), (m.get(String(e.batchId)) ?? 0) + e.qtyDelta)
  return m
}

/**
 * The batch that has fish in the unit on a date (I4: at most one). When
 * several do (legacy data), the one whose first inflow is latest. Falls back
 * to the cage's cached `currentBatchId` when the ledger is empty.
 */
export async function openBatchInUnit(
  ctx: Ctx,
  unitId: Id<'cages'>,
  date?: string,
): Promise<Id<'batches'> | null> {
  const events = (await eventsForUnit(ctx, unitId, date)).sort(compareLedger)
  const bal = balancesByBatch(events)
  const firstIn = new Map<string, string>()
  for (const e of events) {
    const k = String(e.batchId)
    if (e.qtyDelta > 0 && !firstIn.has(k)) firstIn.set(k, e.eventDate)
  }
  let best: { id: Id<'batches'>; since: string } | null = null
  for (const e of events) {
    const k = String(e.batchId)
    if ((bal.get(k) ?? 0) <= 0) continue
    const since = firstIn.get(k) ?? e.eventDate
    if (!best || since >= best.since) best = { id: e.batchId, since }
  }
  if (best) return best.id
  if (events.length) return null
  const cage = await ctx.db.get(unitId)
  return cage?.currentBatchId ?? null
}

/** Bi-weekly samples of one batch in one cage, as ABW samples. */
export async function samplesFor(
  ctx: Ctx,
  unitId: Id<'cages'>,
  batchId: Id<'batches'>,
): Promise<Sample[]> {
  const rows = await ctx.db
    .query('biweeklyRecords')
    .withIndex('by_cage', (q) => q.eq('cageId', unitId))
    .take(2000)
  return rows
    .filter((r) => r.batchId === batchId && r.averageBodyWeight > 0)
    .map((r) => ({ date: r.date, abwG: r.averageBodyWeight }))
}

/** ABW of a batch in a unit on a date (latest sample, else inflow ABW). */
export async function estimateAbw(
  ctx: Ctx,
  unitId: Id<'cages'>,
  batchId: Id<'batches'>,
  date: string,
): Promise<number | null> {
  const [events, samples] = await Promise.all([
    eventsForPair(ctx, unitId, batchId),
    samplesFor(ctx, unitId, batchId),
  ])
  return abwAsOf(events, samples, date).abwG
}

/**
 * Fish (and biomass) as of the end of `date` for a unit, a batch, or one
 * batch in one unit. With `knownAt`, only what had been recorded by then:
 * the same report as it read at that time (doc 05 §7.8).
 */
export async function stockAsOf(
  ctx: Ctx,
  q: { unitId?: Id<'cages'>; batchId?: Id<'batches'>; date: string; knownAt?: number },
): Promise<{ count: number; biomassKg: number; abwG: number | null }> {
  let events: Doc<'stockEvents'>[]
  if (q.unitId && q.batchId) events = await eventsForPair(ctx, q.unitId, q.batchId)
  else if (q.unitId) events = await eventsForUnit(ctx, q.unitId, q.date)
  else if (q.batchId) events = await eventsForBatch(ctx, q.batchId)
  else throw userError('VALIDATION', 'Give a unit or a batch')
  events = events.filter(
    (e) => e.eventDate <= q.date && (q.knownAt == null || e.recordedAt <= q.knownAt),
  )
  // Biomass per occupancy: count × ABW as of the date.
  const pairs = new Map<string, Doc<'stockEvents'>[]>()
  for (const e of events) {
    const k = `${e.unitId}|${e.batchId}`
    if (!pairs.has(k)) pairs.set(k, [])
    pairs.get(k)!.push(e)
  }
  let count = 0
  let kg = 0
  for (const list of pairs.values()) {
    const c = sum(list)
    if (c <= 0) {
      count += c
      continue
    }
    const samples = await samplesFor(ctx, list[0].unitId, list[0].batchId)
    const abw = abwAsOf(list, samples, q.date).abwG ?? 0
    count += c
    kg += biomassKg(c, abw)
  }
  return { count, biomassKg: kg, abwG: count > 0 && kg > 0 ? (kg * 1000) / count : null }
}

export type BatchRef = { _id: Id<'batches'>; batchNumber: string; status: string; depth: number }

/** Ancestors and descendants of a batch (bounded depth 10). */
export async function lineage(ctx: Ctx, batchId: Id<'batches'>) {
  const root = await ctx.db.get(batchId)
  if (!root) return { ancestors: [] as BatchRef[], descendants: [] as BatchRef[] }

  const ancestors: BatchRef[] = []
  const seen = new Set<string>([String(batchId)])
  let frontier: Array<Doc<'batches'>> = [root]
  for (let depth = 1; depth <= 10 && frontier.length; depth++) {
    const next: Array<Doc<'batches'>> = []
    for (const b of frontier) {
      for (const pid of b.parentBatchIds ?? []) {
        if (seen.has(String(pid))) continue
        seen.add(String(pid))
        const p = await ctx.db.get(pid)
        if (!p) continue
        ancestors.push({ _id: p._id, batchNumber: p.batchNumber, status: p.status, depth })
        next.push(p)
      }
    }
    frontier = next
  }

  // Children are found from the company's batches (parent ids are not indexed).
  const all = await ctx.db
    .query('batches')
    .withIndex('by_companyId_and_batchNumber', (q) => q.eq('companyId', root.companyId))
    .take(5000)
  const children = new Map<string, Doc<'batches'>[]>()
  for (const b of all) {
    for (const pid of b.parentBatchIds ?? []) {
      const k = String(pid)
      if (!children.has(k)) children.set(k, [])
      children.get(k)!.push(b)
    }
  }
  const descendants: BatchRef[] = []
  const seenDown = new Set<string>([String(batchId)])
  let down: Array<Doc<'batches'>> = [root]
  for (let depth = 1; depth <= 10 && down.length; depth++) {
    const next: Array<Doc<'batches'>> = []
    for (const b of down) {
      for (const c of children.get(String(b._id)) ?? []) {
        if (seenDown.has(String(c._id))) continue
        seenDown.add(String(c._id))
        descendants.push({ _id: c._id, batchNumber: c.batchNumber, status: c.status, depth })
        next.push(c)
      }
    }
    down = next
  }
  return { ancestors, descendants }
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/** `base`, or `base-2`, `base-3` … whichever is free in the company. */
export async function uniqueBatchNumber(ctx: Ctx, companyId: Id<'companies'>, base: string) {
  const clean = base.trim() || 'BATCH'
  const rows = await ctx.db
    .query('batches')
    .withIndex('by_companyId_and_batchNumber', (q) =>
      q.eq('companyId', companyId).gte('batchNumber', clean).lte('batchNumber', `${clean}￿`),
    )
    .take(1000)
  const taken = new Set(rows.map((r) => r.batchNumber))
  if (!taken.has(clean)) return clean
  let n = 2
  while (taken.has(`${clean}-${n}`)) n++
  return `${clean}-${n}`
}

export async function openBatch(
  ctx: MutationCtx,
  opts: EngineOptions,
  args: {
    batchNumber: string
    origin: BatchOrigin
    openedOn: string
    speciesCode?: string
    parentBatchIds?: Id<'batches'>[]
    homeLocationId?: Id<'farmLocations'>
    legacyStockingId?: Id<'stockingHistory'>
  },
): Promise<Id<'batches'>> {
  const parents = [...new Set(args.parentBatchIds ?? [])]
  if (parents.length > MAX_PARENTS) {
    throw userError('VALIDATION', `A batch can have at most ${MAX_PARENTS} parents`)
  }
  return await ctx.db.insert('batches', {
    companyId: opts.companyId,
    batchNumber: await uniqueBatchNumber(ctx, opts.companyId, args.batchNumber),
    speciesCode: args.speciesCode,
    origin: args.origin,
    parentBatchIds: parents.length ? parents : undefined,
    status: 'active',
    openedOn: args.openedOn,
    homeLocationId: args.homeLocationId,
    legacyStockingId: args.legacyStockingId,
    createdBy: opts.userId,
    updatedAt: Date.now(),
  })
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

type PairKey = string
const pairKey = (unitId: Id<'cages'>, batchId: Id<'batches'>): PairKey => `${unitId}|${batchId}`

export class StockOperation {
  readonly mode: 'strict' | 'shadow'
  readonly cache: 'engine' | 'legacy'
  readonly warnings: string[] = []
  private inserted: Doc<'stockEvents'>[] = []
  private pairs = new Map<PairKey, { unitId: Id<'cages'>; batchId: Id<'batches'> }>()
  private harvestedUnits = new Set<string>()
  private units = new Map<string, Doc<'cages'>>()
  private batchDocs = new Map<string, Doc<'batches'>>()

  constructor(
    private ctx: MutationCtx,
    private opts: EngineOptions,
  ) {
    this.mode = opts.mode ?? 'strict'
    this.cache = opts.cache ?? 'engine'
  }

  get eventIds() {
    return this.inserted.map((e) => e._id)
  }

  /** Strict: throw. Shadow: keep as a warning. */
  private violate(err: ReturnType<typeof userError>) {
    if (this.mode === 'strict') throw err
    this.warnings.push(err.data.message)
  }

  async unit(id: Id<'cages'>): Promise<Doc<'cages'>> {
    const cached = this.units.get(String(id))
    if (cached) return cached
    const cage = await this.ctx.db.get(id)
    if (!cage || cage.companyId !== this.opts.companyId) {
      throw userError('NOT_FOUND', 'Cage not found')
    }
    this.units.set(String(id), cage)
    return cage
  }

  async batch(id: Id<'batches'>): Promise<Doc<'batches'>> {
    const cached = this.batchDocs.get(String(id))
    if (cached) return cached
    const b = await this.ctx.db.get(id)
    if (!b || b.companyId !== this.opts.companyId) {
      throw userError('NOT_FOUND', 'Batch not found')
    }
    this.batchDocs.set(String(id), b)
    return b
  }

  /** The batch in the unit on the date, or a refusal (strict) / null (shadow). */
  async resolveBatch(unitId: Id<'cages'>, date: string, batchId?: Id<'batches'>) {
    if (batchId) return batchId
    const found = await openBatchInUnit(this.ctx, unitId, date)
    if (found) return found
    const cage = await this.unit(unitId)
    this.violate(
      userError('CONFLICT', `${cage.name} has no batch on record on ${date}`, {
        reason: 'NO_BATCH',
      }),
    )
    return null
  }

  private async insert(src: SourceRef, e: StockEventInput, extra?: Partial<Doc<'stockEvents'>>) {
    if (!validDate(e.eventDate)) {
      throw userError('VALIDATION', `Invalid date "${e.eventDate}"`)
    }
    const type = e.type as StockEventType
    if (type !== 'reversal') {
      // I10: non-zero whole number with the sign the type implies.
      if (!Number.isInteger(e.qtyDelta) || e.qtyDelta === 0) {
        throw userError('VALIDATION', 'Fish quantities must be whole numbers above zero')
      }
      const sign = SIGN[e.type]
      if (sign !== 0 && Math.sign(e.qtyDelta) !== sign) {
        throw userError('VALIDATION', `Wrong sign for a ${e.type} event`)
      }
    }
    const kg = e.biomassKgDelta ?? 0
    if (!Number.isFinite(kg) || (e.abwG != null && !(Number.isFinite(e.abwG) && e.abwG >= 0))) {
      throw userError('VALIDATION', 'Weights must be finite, non-negative numbers')
    }
    const cage = await this.unit(e.unitId)
    const batch = await this.batch(e.batchId)
    // I9: no future dates; nothing before the batch opened except its opening inflow.
    const today = new Date().toISOString().slice(0, 10)
    if (e.eventDate > addDays(today, 1)) {
      this.violate(userError('VALIDATION', `${e.eventDate} is in the future`, { reason: 'FUTURE_DATE' }))
    }
    if (type !== 'reversal' && e.qtyDelta < 0 && e.eventDate < batch.openedOn) {
      this.violate(
        userError('VALIDATION', `${e.eventDate} is before batch ${batch.batchNumber} opened (${batch.openedOn})`, {
          reason: 'BEFORE_BATCH',
        }),
      )
    }
    if (type !== 'reversal' && e.qtyDelta > 0 && e.eventDate < batch.openedOn) {
      await this.ctx.db.patch(batch._id, { openedOn: e.eventDate, updatedAt: Date.now() })
      this.batchDocs.set(String(batch._id), { ...batch, openedOn: e.eventDate })
    }
    const doc = {
      companyId: this.opts.companyId,
      locationId: cage.locationId,
      unitId: e.unitId,
      batchId: e.batchId,
      type,
      qtyDelta: e.qtyDelta,
      biomassKgDelta: kg,
      abwG: e.abwG,
      abwSource: e.abwSource,
      eventDate: e.eventDate,
      intraDayOrder: intraDayOrder(type, e.qtyDelta),
      sourceTable: src.sourceTable,
      sourceId: src.sourceId,
      component: e.component,
      counterpartUnitId: e.counterpartUnitId,
      counterpartBatchId: e.counterpartBatchId,
      reason: e.reason,
      recordedAt: Date.now(),
      recordedBy: this.opts.userId,
      ...extra,
    }
    const id = await this.ctx.db.insert('stockEvents', doc)
    const saved = (await this.ctx.db.get(id))!
    this.inserted.push(saved)
    this.pairs.set(pairKey(e.unitId, e.batchId), { unitId: e.unitId, batchId: e.batchId })
    return id
  }

  /** Post raw events for one source document. */
  async post(src: SourceRef, events: StockEventInput[]) {
    const ids: Id<'stockEvents'>[] = []
    for (const e of events) ids.push(await this.insert(src, e))
    return ids
  }

  /**
   * Reverse one event (I6). Idempotent: an event that is already reversed
   * returns its existing reversal and nothing is written.
   */
  async reverseEvent(eventId: Id<'stockEvents'>, reason: string) {
    const e = await this.ctx.db.get(eventId)
    if (!e || e.companyId !== this.opts.companyId) throw userError('NOT_FOUND', 'Stock event not found')
    if (e.type === 'reversal') throw userError('VALIDATION', 'A reversal cannot be reversed; post the event again')
    const existing = await this.ctx.db
      .query('stockEvents')
      .withIndex('by_reversesEventId', (q) => q.eq('reversesEventId', eventId))
      .first()
    if (existing) return { reversalId: existing._id, alreadyReversed: true }
    const reversalId = await this.insert(
      { sourceTable: e.sourceTable, sourceId: e.sourceId },
      {
        type: 'reversal' as PostableType,
        unitId: e.unitId,
        batchId: e.batchId,
        qtyDelta: -e.qtyDelta,
        biomassKgDelta: -e.biomassKgDelta,
        abwG: e.abwG,
        eventDate: e.eventDate,
        component: e.component,
        counterpartUnitId: e.counterpartUnitId,
        counterpartBatchId: e.counterpartBatchId,
        reason,
      },
      {
        type: 'reversal',
        reversedType: e.type,
        reversesEventId: e._id,
        // A reversal takes the order of the event it reverses.
        intraDayOrder: e.intraDayOrder,
      },
    )
    return { reversalId, alreadyReversed: false }
  }

  /** Reverse every live event of a source document. */
  async reverseSource(src: SourceRef, reason: string) {
    const live = activeEvents(await eventsForSource(this.ctx, src))
    for (const e of live) await this.reverseEvent(e._id, reason)
    return live.length
  }

  // -- Domain operations ----------------------------------------------------

  async stockIn(
    src: SourceRef,
    a: {
      unitId: Id<'cages'>
      batchId: Id<'batches'>
      qty: number
      abwG: number
      biomassKg?: number
      date: string
      reason?: string
    },
  ) {
    return await this.post(src, [
      {
        type: 'stock_in',
        unitId: a.unitId,
        batchId: a.batchId,
        qtyDelta: a.qty,
        biomassKgDelta: a.biomassKg && a.biomassKg > 0 ? a.biomassKg : biomassKg(a.qty, a.abwG),
        abwG: a.abwG,
        abwSource: 'measured',
        eventDate: a.date,
        reason: a.reason,
      },
    ])
  }

  async mortality(
    src: SourceRef,
    a: { unitId: Id<'cages'>; batchId?: Id<'batches'>; qty: number; date: string; reason?: string },
  ) {
    const batchId = await this.resolveBatch(a.unitId, a.date, a.batchId)
    if (!batchId) return { batchId: null, eventIds: [] as Id<'stockEvents'>[] }
    const abw = (await estimateAbw(this.ctx, a.unitId, batchId, a.date)) ?? 0
    const eventIds = await this.post(src, [
      {
        type: 'mortality',
        unitId: a.unitId,
        batchId,
        qtyDelta: -a.qty,
        biomassKgDelta: -biomassKg(a.qty, abw),
        abwG: abw || undefined,
        abwSource: 'estimated',
        eventDate: a.date,
        reason: a.reason,
      },
    ])
    return { batchId, eventIds }
  }

  async adjust(
    src: SourceRef,
    a: {
      unitId: Id<'cages'>
      batchId?: Id<'batches'>
      qtyDelta: number
      date: string
      reason: string
      component?: string
    },
  ) {
    if (!a.reason?.trim()) throw userError('VALIDATION', 'Give a reason for the count adjustment')
    const batchId = await this.resolveBatch(a.unitId, a.date, a.batchId)
    if (!batchId) return { batchId: null, eventIds: [] as Id<'stockEvents'>[] }
    const abw = (await estimateAbw(this.ctx, a.unitId, batchId, a.date)) ?? 0
    const eventIds = await this.post(src, [
      {
        type: 'count_adjustment',
        unitId: a.unitId,
        batchId,
        qtyDelta: a.qtyDelta,
        biomassKgDelta: Math.sign(a.qtyDelta) * biomassKg(Math.abs(a.qtyDelta), abw),
        abwG: abw || undefined,
        abwSource: 'estimated',
        eventDate: a.date,
        reason: a.reason.trim(),
        component: a.component,
      },
    ])
    return { batchId, eventIds }
  }

  /** Count of one batch in one unit at the end of a date. */
  private async balanceAt(unitId: Id<'cages'>, batchId: Id<'batches'>, date: string) {
    return sum((await eventsForPair(this.ctx, unitId, batchId)).filter((e) => e.eventDate <= date))
  }

  /**
   * Harvest. A complete harvest is a full physical count: the difference
   * between the ledger and the fish counted is posted as a close-out
   * adjustment (I11), so the occupancy ends at zero.
   */
  async harvest(
    src: SourceRef,
    a: {
      unitId: Id<'cages'>
      batchId?: Id<'batches'>
      qty: number
      kg: number
      abwG?: number
      date: string
      complete: boolean
    },
  ) {
    if (!(a.qty >= 0) || !Number.isInteger(a.qty)) {
      throw userError('VALIDATION', 'Harvest count must be a whole number, 0 or more')
    }
    const batchId = await this.resolveBatch(a.unitId, a.date, a.batchId)
    if (!batchId) return { batchId: null, eventIds: [] as Id<'stockEvents'>[], unaccounted: 0 }
    this.harvestedUnits.add(String(a.unitId))
    const ids: Id<'stockEvents'>[] = []
    if (a.qty > 0) {
      ids.push(
        ...(await this.post(src, [
          {
            type: 'harvest',
            unitId: a.unitId,
            batchId,
            qtyDelta: -a.qty,
            biomassKgDelta: -Math.max(0, a.kg || 0),
            abwG: a.abwG ?? (a.qty > 0 && a.kg > 0 ? (a.kg * 1000) / a.qty : undefined),
            abwSource: 'measured',
            eventDate: a.date,
          },
        ])),
      )
    }
    let unaccounted = 0
    if (a.complete) {
      const left = await this.balanceAt(a.unitId, batchId, a.date)
      if (left !== 0) {
        unaccounted = left
        const abw = (await estimateAbw(this.ctx, a.unitId, batchId, a.date)) ?? 0
        ids.push(
          ...(await this.post(src, [
            {
              type: 'count_adjustment',
              unitId: a.unitId,
              batchId,
              qtyDelta: -left,
              biomassKgDelta: -Math.sign(left) * biomassKg(Math.abs(left), abw),
              abwSource: 'estimated',
              eventDate: a.date,
              component: CLOSEOUT,
              reason: left > 0 ? 'Unaccounted at harvest' : 'More fish harvested than on record',
            },
          ])),
        )
      }
    }
    return { batchId, eventIds: ids, unaccounted }
  }

  /**
   * Move fish from one unit to one or more units, atomically (doc 05 §7.1,
   * §7.2). Into an empty unit (or one holding the same batch) the batch moves
   * with them; into a unit holding another batch they merge into it (§7.4).
   * `destinationBatchId` names a child batch to receive them instead
   * (legacy transfers that opened a new batch number in the destination).
   */
  async transfer(
    lines: Array<{
      src: SourceRef
      sourceUnitId: Id<'cages'>
      batchId?: Id<'batches'>
      destinationUnitId: Id<'cages'>
      destinationBatchId?: Id<'batches'>
      qty: number
      abwG: number
      date: string
    }>,
  ) {
    if (!lines.length) throw userError('VALIDATION', 'Add at least one destination')
    if (lines.length > MAX_LINES) throw userError('VALIDATION', `At most ${MAX_LINES} destinations`)
    const out: Array<{ batchId: Id<'batches'> | null; targetBatchId: Id<'batches'> | null; kind: 'move' | 'merge' }> = []
    for (const l of lines) {
      if (l.sourceUnitId === l.destinationUnitId) {
        throw userError('VALIDATION', 'Source and destination must be different cages')
      }
      if (!(l.qty > 0) || !Number.isInteger(l.qty)) {
        throw userError('VALIDATION', 'Transfer quantities must be whole numbers above zero')
      }
      const batchId = await this.resolveBatch(l.sourceUnitId, l.date, l.batchId)
      await this.unit(l.destinationUnitId)
      if (!batchId) {
        out.push({ batchId: null, targetBatchId: null, kind: 'move' })
        continue
      }
      const destOpen = await openBatchInUnit(this.ctx, l.destinationUnitId, l.date)
      const target = l.destinationBatchId ?? destOpen ?? batchId
      const targetHere = target === batchId ? 0 : await this.balanceAt(l.destinationUnitId, target, l.date)
      const kg = biomassKg(l.qty, l.abwG)
      const kind: 'move' | 'merge' = target !== batchId && targetHere > 0 ? 'merge' : 'move'
      await this.post(l.src, [
        {
          type: kind === 'merge' ? 'merge' : 'transfer_out',
          unitId: l.sourceUnitId,
          batchId,
          qtyDelta: -l.qty,
          biomassKgDelta: -kg,
          abwG: l.abwG,
          abwSource: 'measured',
          eventDate: l.date,
          counterpartUnitId: l.destinationUnitId,
          counterpartBatchId: target,
        },
        {
          type: kind === 'merge' ? 'merge' : 'transfer_in',
          unitId: l.destinationUnitId,
          batchId: target,
          qtyDelta: l.qty,
          biomassKgDelta: kg,
          abwG: l.abwG,
          abwSource: 'measured',
          eventDate: l.date,
          counterpartUnitId: l.sourceUnitId,
          counterpartBatchId: batchId,
        },
      ])
      if (target !== batchId) await this.addParent(target, batchId)
      out.push({ batchId, targetBatchId: target, kind })
    }
    return out
  }

  private async addParent(childId: Id<'batches'>, parentId: Id<'batches'>) {
    const child = await this.batch(childId)
    const parents = child.parentBatchIds ?? []
    if (parents.some((p) => p === parentId) || childId === parentId) return
    if (parents.length >= MAX_PARENTS) {
      throw userError('VALIDATION', `Batch ${child.batchNumber} already has ${MAX_PARENTS} parent batches`)
    }
    const next = [...parents, parentId]
    await this.ctx.db.patch(childId, { parentBatchIds: next, updatedAt: Date.now() })
    this.batchDocs.set(String(childId), { ...child, parentBatchIds: next })
  }

  /**
   * Grade the whole occupancy of a unit into child batches (doc 05 §7.3).
   * Outputs plus culls should account for every fish; any difference is a
   * close-out adjustment on the parent.
   */
  async gradingSplit(
    src: SourceRef,
    a: {
      unitId: Id<'cages'>
      batchId?: Id<'batches'>
      date: string
      outputs: Array<{ unitId: Id<'cages'>; qty: number; abwG: number; newBatchNumber?: string }>
      culls?: number
    },
  ) {
    if (!a.outputs.length) throw userError('VALIDATION', 'Add at least one grade')
    if (a.outputs.length > MAX_LINES) throw userError('VALIDATION', `At most ${MAX_LINES} grades`)
    const culls = a.culls ?? 0
    if (!(culls >= 0) || !Number.isInteger(culls)) throw userError('VALIDATION', 'Culls must be a whole number')
    const parentId = await this.resolveBatch(a.unitId, a.date, a.batchId)
    if (!parentId) return { childBatchIds: [] as Id<'batches'>[], unaccounted: 0 }
    const parent = await this.batch(parentId)
    const available = await this.balanceAt(a.unitId, parentId, a.date)
    const children: Id<'batches'>[] = []
    let outQty = 0
    let outKg = 0
    for (const [i, o] of a.outputs.entries()) {
      if (!(o.qty > 0) || !Number.isInteger(o.qty) || !(o.abwG > 0)) {
        throw userError('VALIDATION', 'Each grade needs a fish count and an ABW')
      }
      const destCage = await this.unit(o.unitId)
      const childId = await openBatch(this.ctx, this.opts, {
        batchNumber: o.newBatchNumber?.trim() || `${parent.batchNumber}-${String.fromCharCode(65 + i)}`,
        origin: 'grading_split',
        openedOn: a.date,
        speciesCode: parent.speciesCode,
        parentBatchIds: [parentId],
        homeLocationId: destCage.locationId,
      })
      children.push(childId)
      const kg = biomassKg(o.qty, o.abwG)
      outQty += o.qty
      outKg += kg
      await this.post(src, [
        {
          type: 'grading_split',
          unitId: o.unitId,
          batchId: childId,
          qtyDelta: o.qty,
          biomassKgDelta: kg,
          abwG: o.abwG,
          abwSource: 'measured',
          eventDate: a.date,
          counterpartUnitId: a.unitId,
          counterpartBatchId: parentId,
        },
      ])
    }
    if (culls > 0) {
      await this.mortality(src, { unitId: a.unitId, batchId: parentId, qty: culls, date: a.date, reason: 'Cull at grading' })
    }
    await this.post(src, [
      {
        type: 'grading_split',
        unitId: a.unitId,
        batchId: parentId,
        qtyDelta: -outQty,
        biomassKgDelta: -outKg,
        abwG: outQty > 0 ? (outKg * 1000) / outQty : undefined,
        abwSource: 'measured',
        eventDate: a.date,
      },
    ])
    const unaccounted = available - outQty - culls
    if (unaccounted !== 0) {
      await this.adjust(src, {
        unitId: a.unitId,
        batchId: parentId,
        qtyDelta: -unaccounted,
        date: a.date,
        reason: unaccounted > 0 ? 'Unaccounted at grading' : 'More fish graded than on record',
        component: CLOSEOUT,
      })
    }
    return { childBatchIds: children, unaccounted }
  }

  /** Merge fish of one or more batches into a target batch in a unit (doc 05 §7.4). */
  async merge(
    src: SourceRef,
    a: {
      date: string
      sources: Array<{ unitId: Id<'cages'>; batchId: Id<'batches'>; qty: number; abwG: number }>
      target: { unitId: Id<'cages'>; batchId: Id<'batches'> }
    },
  ) {
    if (!a.sources.length) throw userError('VALIDATION', 'Add at least one source')
    if (a.sources.length > MAX_LINES) throw userError('VALIDATION', `At most ${MAX_LINES} sources`)
    for (const s of a.sources) {
      if (s.batchId === a.target.batchId) {
        throw userError('VALIDATION', 'A batch cannot be merged into itself; use a transfer')
      }
      if (!(s.qty > 0) || !Number.isInteger(s.qty)) {
        throw userError('VALIDATION', 'Merge quantities must be whole numbers above zero')
      }
      const kg = biomassKg(s.qty, s.abwG)
      await this.post(src, [
        {
          type: 'merge',
          unitId: s.unitId,
          batchId: s.batchId,
          qtyDelta: -s.qty,
          biomassKgDelta: -kg,
          abwG: s.abwG,
          abwSource: 'measured',
          eventDate: a.date,
          counterpartUnitId: a.target.unitId,
          counterpartBatchId: a.target.batchId,
        },
        {
          type: 'merge',
          unitId: a.target.unitId,
          batchId: a.target.batchId,
          qtyDelta: s.qty,
          biomassKgDelta: kg,
          abwG: s.abwG,
          abwSource: 'measured',
          eventDate: a.date,
          counterpartUnitId: s.unitId,
          counterpartBatchId: s.batchId,
        },
      ])
      await this.addParent(a.target.batchId, s.batchId)
    }
  }

  // -- Commit ---------------------------------------------------------------

  /**
   * I11: re-derive close-outs of emptied occupancies after an earlier event
   * changed, so the physical count stays the closing truth (doc 05 §7.5).
   */
  private async recomputeCloseouts() {
    for (const { unitId, batchId } of [...this.pairs.values()]) {
      let events = await eventsForPair(this.ctx, unitId, batchId)
      const reversed = new Set(events.map((e) => e.reversesEventId).filter(Boolean).map(String))
      const closeouts = events
        .filter(
          (e) =>
            e.component === CLOSEOUT &&
            e.type === 'count_adjustment' &&
            !reversed.has(String(e._id)),
        )
        .sort(compareLedger)
      for (const c of closeouts) {
        const bal = sum(events.filter((e) => e.eventDate <= c.eventDate))
        if (bal === 0) continue
        const nextQty = c.qtyDelta - bal
        await this.reverseEvent(c._id, 'Close-out recomputed after an earlier change')
        if (nextQty !== 0) {
          const abw = (await estimateAbw(this.ctx, unitId, batchId, c.eventDate)) ?? 0
          await this.insert(
            { sourceTable: c.sourceTable, sourceId: c.sourceId },
            {
              type: 'count_adjustment',
              unitId,
              batchId,
              qtyDelta: nextQty,
              biomassKgDelta: Math.sign(nextQty) * biomassKg(Math.abs(nextQty), abw),
              abwSource: 'estimated',
              eventDate: c.eventDate,
              component: CLOSEOUT,
              reason: c.reason,
            },
          )
        }
        const batch = await this.batch(batchId)
        const cage = await this.unit(unitId)
        this.warnings.push(
          `Unaccounted loss for ${batch.batchNumber} in ${cage.name} changed from ${-c.qtyDelta} to ${-nextQty}`,
        )
        events = await eventsForPair(this.ctx, unitId, batchId)
      }
    }
  }

  /** I3: running count of each touched (unit, batch) never goes below zero. */
  private async checkNonNegative() {
    const insertedIds = new Set(this.inserted.map((e) => String(e._id)))
    for (const { unitId, batchId } of this.pairs.values()) {
      // A reversed event and its reversal cancel where the original stood, so
      // both are left out of the running count.
      const all = activeEvents(await eventsForPair(this.ctx, unitId, batchId)).sort(compareLedger)
      const low = (events: Doc<'stockEvents'>[]) => {
        let run = 0
        let min = 0
        let at = ''
        for (const e of events) {
          run += e.qtyDelta
          if (run < min) {
            min = run
            at = e.eventDate
          }
        }
        return { min, at }
      }
      const after = low(all)
      const before = low(all.filter((e) => !insertedIds.has(String(e._id))))
      if (after.min < 0 && after.min < before.min) {
        const cage = await this.unit(unitId)
        const batch = await this.batch(batchId)
        this.violate(
          userError(
            'CONFLICT',
            `Not enough fish: ${cage.name} would be ${-after.min} short of batch ${batch.batchNumber} on ${after.at}`,
            { reason: 'STOCK_NEGATIVE', unitId, date: after.at, shortBy: -after.min },
          ),
        )
      }
    }
  }

  private touchedUnits() {
    const m = new Map<string, Id<'cages'>>()
    for (const { unitId } of this.pairs.values()) m.set(String(unitId), unitId)
    return [...m.values()]
  }

  /** I4: at most one batch with fish per unit. */
  private async checkOneOccupancy() {
    const insertedIds = new Set(this.inserted.map((e) => String(e._id)))
    for (const unitId of this.touchedUnits()) {
      const events = await eventsForUnit(this.ctx, unitId)
      const open = (list: Doc<'stockEvents'>[]) =>
        [...balancesByBatch(list).values()].filter((n) => n > 0).length
      const after = open(events)
      const before = open(events.filter((e) => !insertedIds.has(String(e._id))))
      if (after > 1 && after > before) {
        const cage = await this.unit(unitId)
        this.violate(
          userError(
            'CONFLICT',
            `${cage.name} would hold two batches at once. Record where the earlier fish went, or merge the batches.`,
            { reason: 'OCCUPANCY_CONFLICT', unitId },
          ),
        )
      }
    }
  }

  /** I7: keep the cage caches in step with the ledger. */
  private async writeCaches() {
    const now = Date.now()
    for (const unitId of this.touchedUnits()) {
      const cage = await this.ctx.db.get(unitId)
      if (!cage) continue
      const mine = this.inserted.filter((e) => e.unitId === unitId)
      const delta = sum(mine)
      const openId = await openBatchInUnit(this.ctx, unitId)
      const patch: Partial<Doc<'cages'>> = {}
      if ((cage.currentBatchId ?? null) !== (openId ?? null)) patch.currentBatchId = openId ?? undefined

      if (this.cache === 'engine' && delta !== 0) {
        const before = cage.currentCount ?? 0
        const next = before + delta
        patch.currentCount = next
        if (next <= 0 && before > 0) {
          patch.status = this.harvestedUnits.has(String(unitId)) ? 'harvested' : 'empty'
        } else if (next > 0 && before <= 0) {
          // A new occupancy opens: the occupancy fields describe it.
          const inflow = mine
            .filter((e) => e.qtyDelta > 0 && e.type !== 'reversal')
            .sort(compareLedger)[0]
          const batch = openId ? await this.ctx.db.get(openId) : null
          patch.status = 'active'
          patch.stockingDate = inflow?.eventDate ?? cage.stockingDate
          patch.initialCount = next
          if (inflow?.abwG) {
            patch.initialAbw = inflow.abwG
            patch.currentWeight = inflow.abwG
          }
          if (batch?.speciesCode) patch.species = batch.speciesCode
        } else if (next > 0 && EMPTY_STATUSES.has(cage.status)) {
          patch.status = 'active'
        }
      }
      if (Object.keys(patch).length) await this.ctx.db.patch(unitId, { ...patch, updatedAt: now })
    }
  }

  /** Batch status follows its fish: closed when no unit holds any. */
  private async writeBatchStatus() {
    const ids = new Map<string, Id<'batches'>>()
    for (const { batchId } of this.pairs.values()) ids.set(String(batchId), batchId)
    for (const batchId of ids.values()) {
      const b = await this.ctx.db.get(batchId)
      if (!b) continue
      const events = await eventsForBatch(this.ctx, batchId)
      if (!events.length) continue
      const total = sum(events)
      const last = events.reduce((m, e) => (e.eventDate > m ? e.eventDate : m), events[0].eventDate)
      if (total <= 0 && (b.status !== 'closed' || b.closedOn !== last)) {
        await this.ctx.db.patch(batchId, { status: 'closed', closedOn: last, updatedAt: Date.now() })
      } else if (total > 0 && b.status !== 'active') {
        await this.ctx.db.patch(batchId, { status: 'active', closedOn: undefined, updatedAt: Date.now() })
      }
    }
  }

  async commit() {
    await this.recomputeCloseouts()
    await this.checkNonNegative()
    await this.checkOneOccupancy()
    await this.writeCaches()
    await this.writeBatchStatus()
    return { eventIds: this.eventIds, warnings: [...this.warnings] }
  }
}

export function beginOperation(ctx: MutationCtx, opts: EngineOptions) {
  return new StockOperation(ctx, opts)
}

// ---------------------------------------------------------------------------
// One-call wrappers
// ---------------------------------------------------------------------------

type OpArgs<K extends keyof StockOperation> = StockOperation[K] extends (...a: infer A) => unknown
  ? A
  : never

export async function stockIn(ctx: MutationCtx, opts: EngineOptions, ...a: OpArgs<'stockIn'>) {
  const op = beginOperation(ctx, opts)
  await op.stockIn(...a)
  return await op.commit()
}

export async function recordMortality(ctx: MutationCtx, opts: EngineOptions, ...a: OpArgs<'mortality'>) {
  const op = beginOperation(ctx, opts)
  const r = await op.mortality(...a)
  return { ...(await op.commit()), batchId: r.batchId }
}

export async function transfer(ctx: MutationCtx, opts: EngineOptions, ...a: OpArgs<'transfer'>) {
  const op = beginOperation(ctx, opts)
  const lines = await op.transfer(...a)
  return { ...(await op.commit()), lines }
}

export async function harvest(ctx: MutationCtx, opts: EngineOptions, ...a: OpArgs<'harvest'>) {
  const op = beginOperation(ctx, opts)
  const r = await op.harvest(...a)
  return { ...(await op.commit()), batchId: r.batchId, unaccounted: r.unaccounted }
}

export async function gradingSplit(ctx: MutationCtx, opts: EngineOptions, ...a: OpArgs<'gradingSplit'>) {
  const op = beginOperation(ctx, opts)
  const r = await op.gradingSplit(...a)
  return { ...(await op.commit()), ...r }
}

export async function merge(ctx: MutationCtx, opts: EngineOptions, ...a: OpArgs<'merge'>) {
  const op = beginOperation(ctx, opts)
  await op.merge(...a)
  return await op.commit()
}

export async function adjustCount(ctx: MutationCtx, opts: EngineOptions, ...a: OpArgs<'adjust'>) {
  const op = beginOperation(ctx, opts)
  const r = await op.adjust(...a)
  return { ...(await op.commit()), batchId: r.batchId }
}

/** Reverse one event. Idempotent: reversing it again writes nothing. */
export async function reverse(
  ctx: MutationCtx,
  opts: EngineOptions,
  eventId: Id<'stockEvents'>,
  reason: string,
) {
  const op = beginOperation(ctx, opts)
  const r = await op.reverseEvent(eventId, reason)
  return { ...(await op.commit()), ...r }
}

/** Reverse every live event of a source document (a transfer, harvest, daily record …). */
export async function reverseOperation(
  ctx: MutationCtx,
  opts: EngineOptions,
  src: SourceRef,
  reason: string,
) {
  const op = beginOperation(ctx, opts)
  const reversed = await op.reverseSource(src, reason)
  return { ...(await op.commit()), reversed }
}
