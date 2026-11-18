/**
 * Larval rearing and nursery (Phase 5, HAT-003, HAT-004, NUR-001, NUR-002).
 *
 * - Daily larval logs: deaths and survival counts post to the production
 *   engine; live feed used is written to the live feed log.
 * - Live feed culture log (artemia, rotifers, algae) with balances.
 * - Grading larvae into fingerling batches (engine `gradingSplit`).
 * - Fingerlings out: transfers to grow-out units (engine `transfer`, the
 *   batch and its hatchery lineage move with them), sales by count (a
 *   `sales` row linked to the batch) and dispatches to other farms.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { liveFeedEntry, liveFeedKind, liveFeedUnit } from './schema'
import { userError } from './lib/errors'
import { idempotentMutation } from './lib/idempotency'
import { logAudit } from './lib/tenancy'
import { enforceWithdrawal } from './lib/traceability'
import { stockingAt } from './lib/productionDualWrite'
import * as engine from './lib/productionEngine'
import { requireHatchery, ownDoc, type HatcheryMember } from './lib/hatcheryAccess'
import { biomassKg, daysBetween, flowsOf, nurserySurvivalPct, round } from './lib/kpi'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_LIVE_FEED = 10
const LOG_LIMIT = 120
/** Unit types that hold larvae and fingerlings. */
const NURSERY_UNITS = new Set(['hatchery_tank', 'incubator', 'tank', 'hapa'])

type Ctx = QueryCtx | MutationCtx

function assertDate(d: string | undefined, label: string) {
  if (!d || !DATE_RE.test(d)) throw userError('VALIDATION', `Choose ${label}`)
}

const cleanText = (s: string | undefined) => s?.trim() || undefined

function wholeOrZero(n: number | undefined, label: string) {
  if (n === undefined) return
  if (!(Number.isInteger(n) && n >= 0)) throw userError('VALIDATION', `${label} must be a whole number, 0 or more`)
}

function nonNegative(n: number | undefined, label: string) {
  if (n !== undefined && !(Number.isFinite(n) && n >= 0)) throw userError('VALIDATION', `${label} must be 0 or more`)
}

async function ownUnit(ctx: Ctx, m: HatcheryMember, id: Id<'cages'>) {
  return ownDoc(m, await ctx.db.get(id), 'Unit')
}

/** The batch in the unit on the date (explicit or found), or a refusal. */
async function batchIn(ctx: Ctx, m: HatcheryMember, unit: Doc<'cages'>, date: string, batchId?: Id<'batches'>) {
  const id = batchId ?? (await engine.openBatchInUnit(ctx, unit._id, date))
  if (!id) throw userError('CONFLICT', `${unit.name} holds no batch on ${date}`, { reason: 'NO_BATCH' })
  return ownDoc(m, await ctx.db.get(id), 'Batch')
}

async function balanceAt(ctx: Ctx, unitId: Id<'cages'>, batchId: Id<'batches'>, date: string) {
  return (await engine.eventsForPair(ctx, unitId, batchId))
    .filter((e) => e.eventDate <= date)
    .reduce((t, e) => t + e.qtyDelta, 0)
}

// ---------------------------------------------------------------------------
// Daily larval logs (HAT-003)
// ---------------------------------------------------------------------------

const larvalLogArgs = {
  unitId: v.id('cages'),
  logDate: v.string(),
  batchId: v.optional(v.id('batches')),
  mortality: v.optional(v.number()),
  countedAlive: v.optional(v.number()),
  liveFeed: v.optional(v.array(liveFeedEntry)),
  dryFeedG: v.optional(v.number()),
  feedingsPerDay: v.optional(v.number()),
  temperatureC: v.optional(v.number()),
  dissolvedOxygen: v.optional(v.number()),
  ph: v.optional(v.number()),
  salinityPpt: v.optional(v.number()),
  notes: v.optional(v.string()),
}

/**
 * Save the day's larval log for the unit's batch. Saving the same day again
 * replaces it: its engine events are reversed and re-posted, its live feed
 * uses rewritten. Offline outboxes send `clientMutationId`.
 */
export const saveLarvalLog = idempotentMutation('nursery.saveLarvalLog', {
  args: larvalLogArgs,
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.larval.record')
    assertDate(args.logDate, 'a log date')
    wholeOrZero(args.mortality, 'Deaths')
    wholeOrZero(args.countedAlive, 'Larvae counted')
    wholeOrZero(args.feedingsPerDay, 'Feedings per day')
    for (const [k, label] of [
      ['dryFeedG', 'Dry feed'],
      ['dissolvedOxygen', 'Dissolved oxygen'],
      ['ph', 'pH'],
      ['salinityPpt', 'Salinity'],
    ] as const) {
      nonNegative(args[k], label)
    }
    const liveFeed = args.liveFeed ?? []
    if (liveFeed.length > MAX_LIVE_FEED) throw userError('VALIDATION', `At most ${MAX_LIVE_FEED} live feed entries`)
    for (const f of liveFeed) {
      if (!(Number.isFinite(f.quantity) && f.quantity > 0)) throw userError('VALIDATION', 'Live feed amounts must be above zero')
    }
    const unit = await ownUnit(ctx, m, args.unitId)
    const batch = await batchIn(ctx, m, unit, args.logDate, args.batchId)
    if (args.logDate < batch.openedOn) {
      throw userError('VALIDATION', `${args.logDate} is before batch ${batch.batchNumber} opened (${batch.openedOn})`)
    }

    const existing = await ctx.db
      .query('larvalLogs')
      .withIndex('by_unitId_and_batchId_and_logDate', (q) =>
        q.eq('unitId', unit._id).eq('batchId', batch._id).eq('logDate', args.logDate),
      )
      .unique()
    const fields = {
      mortality: args.mortality,
      countedAlive: args.countedAlive,
      liveFeed: liveFeed.length ? liveFeed : undefined,
      dryFeedG: args.dryFeedG,
      feedingsPerDay: args.feedingsPerDay,
      temperatureC: args.temperatureC,
      dissolvedOxygen: args.dissolvedOxygen,
      ph: args.ph,
      salinityPpt: args.salinityPpt,
      notes: cleanText(args.notes),
      updatedAt: Date.now(),
    }
    let logId: Id<'larvalLogs'>
    if (existing) {
      logId = existing._id
      await ctx.db.replace(existing._id, {
        companyId: existing.companyId,
        locationId: existing.locationId,
        unitId: existing.unitId,
        batchId: existing.batchId,
        logDate: existing.logDate,
        createdBy: existing.createdBy,
        ...fields,
      })
      const uses = await ctx.db
        .query('liveFeedLogs')
        .withIndex('by_larvalLogId', (q) => q.eq('larvalLogId', existing._id))
        .take(MAX_LIVE_FEED + 1)
      for (const u of uses) await ctx.db.delete(u._id)
    } else {
      logId = await ctx.db.insert('larvalLogs', {
        companyId: m.companyId,
        locationId: unit.locationId,
        unitId: unit._id,
        batchId: batch._id,
        logDate: args.logDate,
        createdBy: m.user._id,
        ...fields,
      })
    }

    const src = { sourceTable: 'larvalLogs' as const, sourceId: logId }
    const op = engine.beginOperation(ctx, { companyId: m.companyId, userId: m.user._id })
    if (existing) await op.reverseSource(src, 'Larval log saved again')
    if (args.mortality) {
      await op.mortality(src, { unitId: unit._id, batchId: batch._id, qty: args.mortality, date: args.logDate })
    }
    let adjusted = 0
    if (args.countedAlive !== undefined) {
      const onRecord = await balanceAt(ctx, unit._id, batch._id, args.logDate)
      adjusted = args.countedAlive - onRecord
      if (adjusted !== 0) {
        await op.adjust(src, {
          unitId: unit._id,
          batchId: batch._id,
          qtyDelta: adjusted,
          date: args.logDate,
          reason: 'Larval survival count',
        })
      }
    }
    const result = await op.commit()

    for (const f of liveFeed) {
      await ctx.db.insert('liveFeedLogs', {
        companyId: m.companyId,
        locationId: unit.locationId,
        date: args.logDate,
        kind: f.kind,
        movement: 'used',
        quantity: f.quantity,
        unit: f.unit,
        culture: `${unit.name} · ${batch.batchNumber}`,
        larvalLogId: logId,
        createdBy: m.user._id,
        updatedAt: Date.now(),
      })
    }
    await logAudit(ctx, {
      actionType: existing ? 'update' : 'create',
      tableName: 'larvalLogs',
      recordId: logId,
      previousValues: existing ?? undefined,
      newValues: { ...args, batchId: batch._id, adjusted },
      locationId: unit.locationId,
    })
    return {
      logId,
      batchId: batch._id,
      alive: await balanceAt(ctx, unit._id, batch._id, args.logDate),
      adjusted,
      warnings: result.warnings,
    }
  },
})

function logRow(l: Doc<'larvalLogs'>) {
  return {
    id: l._id,
    log_date: l.logDate,
    unit_id: l.unitId,
    batch_id: l.batchId,
    mortality: l.mortality ?? null,
    counted_alive: l.countedAlive ?? null,
    live_feed: l.liveFeed ?? [],
    dry_feed_g: l.dryFeedG ?? null,
    feedings_per_day: l.feedingsPerDay ?? null,
    temperature_c: l.temperatureC ?? null,
    dissolved_oxygen: l.dissolvedOxygen ?? null,
    ph: l.ph ?? null,
    salinity_ppt: l.salinityPpt ?? null,
    notes: l.notes ?? null,
  }
}

export const listLarvalLogs = query({
  args: { batchId: v.id('batches') },
  handler: async (ctx, { batchId }) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    ownDoc(m, await ctx.db.get(batchId), 'Batch')
    const logs = await ctx.db
      .query('larvalLogs')
      .withIndex('by_batchId_and_logDate', (q) => q.eq('batchId', batchId))
      .order('desc')
      .take(LOG_LIMIT)
    return logs.map(logRow)
  },
})

/** Hatchery batches and their fingerling descendants within `depth` generations. */
async function nurseryBatches(ctx: Ctx, m: HatcheryMember, status: 'active' | 'closed') {
  const rows = await ctx.db
    .query('batches')
    .withIndex('by_companyId_and_status', (q) => q.eq('companyId', m.companyId).eq('status', status))
    .order('desc')
    .take(500)
  const cache = new Map<string, Doc<'batches'> | null>()
  const get = async (id: Id<'batches'>) => {
    if (!cache.has(String(id))) cache.set(String(id), await ctx.db.get(id))
    return cache.get(String(id)) ?? null
  }
  const fromHatchery = async (b: Doc<'batches'>, depth: number): Promise<Doc<'batches'> | null> => {
    if (b.origin === 'hatchery') return b
    if (depth >= 3) return null
    for (const p of b.parentBatchIds ?? []) {
      const parent = await get(p)
      const found = parent ? await fromHatchery(parent, depth + 1) : null
      if (found) return found
    }
    return null
  }
  const out: Array<{ batch: Doc<'batches'>; hatched: Doc<'batches'> }> = []
  for (const b of rows) {
    const hatched = await fromHatchery(b, 0)
    if (hatched) out.push({ batch: b, hatched })
  }
  return out
}

/**
 * Larval and fingerling batches: where they are, how many, survival since
 * they were stocked, days since hatch and the last daily log.
 */
export const larvalBatches = query({
  args: { status: v.optional(v.union(v.literal('active'), v.literal('closed'))) },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const today = new Date().toISOString().slice(0, 10)
    const out = []
    for (const { batch, hatched } of (await nurseryBatches(ctx, m, args.status ?? 'active')).slice(0, 100)) {
      const events = await engine.eventsForBatch(ctx, batch._id)
      const f = flowsOf(events)
      const perUnit = new Map<string, number>()
      for (const e of events) perUnit.set(String(e.unitId), (perUnit.get(String(e.unitId)) ?? 0) + e.qtyDelta)
      const units = []
      for (const [id, count] of perUnit) {
        if (count <= 0) continue
        const u = await ctx.db.get(id as Id<'cages'>)
        units.push({ id: id as Id<'cages'>, name: u?.name ?? '—', unit_type: u?.unitType ?? 'cage', count })
      }
      const lastLog = await ctx.db
        .query('larvalLogs')
        .withIndex('by_batchId_and_logDate', (q) => q.eq('batchId', batch._id))
        .order('desc')
        .first()
      const lastAbw = [...events].reverse().find((e) => e.abwG && e.abwSource === 'measured')?.abwG ?? null
      out.push({
        id: batch._id,
        batch_number: batch.batchNumber,
        origin: batch.origin,
        stage: batch.origin === 'hatchery' ? 'larvae' : 'fingerlings',
        species: batch.speciesCode ?? null,
        opened_on: batch.openedOn,
        closed_on: batch.closedOn ?? null,
        hatched_on: hatched.openedOn,
        days_since_hatch: daysBetween(hatched.openedOn, batch.closedOn ?? today),
        hatched_batch_number: hatched.batchNumber,
        count: f.count,
        stocked: f.stockedCount + f.inCount,
        deaths: f.mortalityCount,
        moved_out: f.outCount + f.harvestedCount,
        survival_pct: round(nurserySurvivalPct(f), 1),
        abw_g: lastAbw,
        units,
        last_log_date: lastLog?.logDate ?? null,
        logged_today: lastLog?.logDate === today,
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Live feed culture log (HAT-003)
// ---------------------------------------------------------------------------

export const recordLiveFeed = idempotentMutation('nursery.recordLiveFeed', {
  args: {
    date: v.string(),
    kind: liveFeedKind,
    movement: v.union(v.literal('produced'), v.literal('used'), v.literal('discarded')),
    quantity: v.number(),
    unit: liveFeedUnit,
    culture: v.optional(v.string()),
    inputNote: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.larval.record')
    assertDate(args.date, 'a date')
    if (!(Number.isFinite(args.quantity) && args.quantity > 0)) throw userError('VALIDATION', 'Quantity must be above zero')
    if (args.locationId) ownDoc(m, await ctx.db.get(args.locationId), 'Site')
    const id = await ctx.db.insert('liveFeedLogs', {
      companyId: m.companyId,
      locationId: args.locationId ?? m.user.activeLocationId,
      date: args.date,
      kind: args.kind,
      movement: args.movement,
      quantity: args.quantity,
      unit: args.unit,
      culture: cleanText(args.culture),
      inputNote: cleanText(args.inputNote),
      notes: cleanText(args.notes),
      createdBy: m.user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'liveFeedLogs', recordId: id, newValues: args })
    return id
  },
})

export const removeLiveFeed = mutation({
  args: { id: v.id('liveFeedLogs') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const m = await requireHatchery(ctx, 'hatchery.larval.record')
    const row = ownDoc(m, await ctx.db.get(id), 'Live feed entry')
    if (row.larvalLogId) throw userError('CONFLICT', 'This use belongs to a larval log; edit the log instead')
    await ctx.db.delete(id)
    await logAudit(ctx, { actionType: 'delete', tableName: 'liveFeedLogs', recordId: id, previousValues: row })
    return null
  },
})

/** Live feed entries in a date range and the running balance per kind and unit. */
export const liveFeed = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const rows = await ctx.db
      .query('liveFeedLogs')
      .withIndex('by_companyId_and_date', (q) => {
        const base = q.eq('companyId', m.companyId)
        if (args.from && args.to) return base.gte('date', args.from).lte('date', args.to)
        if (args.from) return base.gte('date', args.from)
        if (args.to) return base.lte('date', args.to)
        return base
      })
      .order('desc')
      .take(1000)
    const balances = new Map<string, { kind: string; unit: string; produced: number; used: number; discarded: number }>()
    for (const r of rows) {
      const k = `${r.kind}|${r.unit}`
      const b = balances.get(k) ?? { kind: r.kind, unit: r.unit, produced: 0, used: 0, discarded: 0 }
      b[r.movement] += r.quantity
      balances.set(k, b)
    }
    return {
      entries: rows.slice(0, 200).map((r) => ({
        id: r._id,
        date: r.date,
        kind: r.kind,
        movement: r.movement,
        quantity: r.quantity,
        unit: r.unit,
        culture: r.culture ?? null,
        input_note: r.inputNote ?? null,
        from_larval_log: !!r.larvalLogId,
        notes: r.notes ?? null,
      })),
      balances: [...balances.values()].map((b) => ({
        ...b,
        on_hand: round(b.produced - b.used - b.discarded, 2),
      })),
    }
  },
})

// ---------------------------------------------------------------------------
// Grading into fingerling batches (NUR-001)
// ---------------------------------------------------------------------------

/**
 * Grade the whole batch in a unit into fingerling batches (engine
 * `gradingSplit`): each grade opens a child batch in its unit, culls are
 * deaths, and fish not accounted for are a close-out. Fish are conserved.
 */
export const gradeFingerlings = idempotentMutation('nursery.gradeFingerlings', {
  args: {
    unitId: v.id('cages'),
    date: v.string(),
    outputs: v.array(
      v.object({
        unitId: v.id('cages'),
        quantity: v.number(),
        abwG: v.number(),
        batchNumber: v.optional(v.string()),
      }),
    ),
    culls: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.grade')
    assertDate(args.date, 'a grading date')
    const unit = await ownUnit(ctx, m, args.unitId)
    const batch = await batchIn(ctx, m, unit, args.date)
    const seen = new Set<string>()
    for (const o of args.outputs) {
      if (seen.has(String(o.unitId))) throw userError('VALIDATION', 'Each unit can receive one grade')
      seen.add(String(o.unitId))
      await ownUnit(ctx, m, o.unitId)
    }
    const opId = await ctx.db.insert('stockOperations', {
      companyId: m.companyId,
      locationId: unit.locationId,
      kind: 'grading_split',
      operationDate: args.date,
      status: 'approved',
      unitId: unit._id,
      reason: cleanText(args.reason) ?? 'Nursery grading',
      createdBy: m.user._id,
      updatedAt: Date.now(),
    })
    const result = await engine.gradingSplit(
      ctx,
      { companyId: m.companyId, userId: m.user._id },
      { sourceTable: 'stockOperations', sourceId: opId },
      {
        unitId: unit._id,
        batchId: batch._id,
        date: args.date,
        outputs: args.outputs.map((o) => ({
          unitId: o.unitId,
          qty: o.quantity,
          abwG: o.abwG,
          newBatchNumber: cleanText(o.batchNumber),
        })),
        culls: args.culls ?? 0,
      },
    )
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'stockOperations',
      recordId: opId,
      newValues: { ...args, parentBatchId: batch._id, childBatchIds: result.childBatchIds, unaccounted: result.unaccounted },
      locationId: unit.locationId,
    })
    return { operationId: opId, childBatchIds: result.childBatchIds, unaccounted: result.unaccounted, warnings: result.warnings }
  },
})

// ---------------------------------------------------------------------------
// Fingerlings out: transfers, sales by count, dispatches (HAT-004, NUR-002)
// ---------------------------------------------------------------------------

async function insertMovement(
  ctx: MutationCtx,
  m: HatcheryMember,
  unit: Doc<'cages'>,
  batch: Doc<'batches'>,
  a: Pick<Doc<'nurseryMovements'>, 'kind' | 'moveDate' | 'quantity' | 'abwG'> &
    Partial<Pick<Doc<'nurseryMovements'>, 'destinationUnitId' | 'destinationName' | 'saleId' | 'notes'>>,
) {
  return await ctx.db.insert('nurseryMovements', {
    companyId: m.companyId,
    locationId: unit.locationId,
    sourceUnitId: unit._id,
    batchId: batch._id,
    status: 'approved',
    createdBy: m.user._id,
    updatedAt: Date.now(),
    ...a,
  })
}

function validateOut(qty: number, abwG: number) {
  if (!(Number.isInteger(qty) && qty > 0)) throw userError('VALIDATION', 'Fish count must be a whole number above zero')
  if (!(Number.isFinite(abwG) && abwG > 0)) throw userError('VALIDATION', 'Enter the fingerlings’ average weight')
}

/**
 * Move fingerlings to other units of the farm in one operation. Into an empty
 * unit the batch moves with them (lineage unchanged) and a stocking row opens
 * the grow-out cycle there; into a unit holding a batch they merge into it
 * (the fingerling batch becomes a parent) with a top-up row.
 */
export const transferFingerlings = idempotentMutation('nursery.transferFingerlings', {
  args: {
    sourceUnitId: v.id('cages'),
    date: v.string(),
    lines: v.array(v.object({ destinationUnitId: v.id('cages'), quantity: v.number(), abwG: v.number() })),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.dispatch')
    assertDate(args.date, 'a transfer date')
    if (!args.lines.length) throw userError('VALIDATION', 'Add at least one destination')
    if (args.lines.length > engine.MAX_LINES) throw userError('VALIDATION', `At most ${engine.MAX_LINES} destinations`)
    const source = await ownUnit(ctx, m, args.sourceUnitId)
    const batch = await batchIn(ctx, m, source, args.date)
    const dests: Doc<'cages'>[] = []
    const seen = new Set<string>()
    for (const l of args.lines) {
      validateOut(l.quantity, l.abwG)
      if (l.destinationUnitId === source._id) throw userError('VALIDATION', 'A destination cannot be the source unit')
      if (seen.has(String(l.destinationUnitId))) throw userError('VALIDATION', 'Each destination can appear once')
      seen.add(String(l.destinationUnitId))
      dests.push(await ownUnit(ctx, m, l.destinationUnitId))
    }
    const ids: Id<'nurseryMovements'>[] = []
    for (const [i, l] of args.lines.entries()) {
      ids.push(
        await insertMovement(ctx, m, source, batch, {
          kind: 'transfer',
          moveDate: args.date,
          quantity: l.quantity,
          abwG: l.abwG,
          destinationUnitId: dests[i]._id,
          destinationName: dests[i].name,
          notes: cleanText(args.notes),
        }),
      )
    }
    const result = await engine.transfer(
      ctx,
      { companyId: m.companyId, userId: m.user._id },
      args.lines.map((l, i) => ({
        src: { sourceTable: 'nurseryMovements' as const, sourceId: ids[i] },
        sourceUnitId: source._id,
        batchId: batch._id,
        destinationUnitId: l.destinationUnitId,
        qty: l.quantity,
        abwG: l.abwG,
        date: args.date,
      })),
    )
    // Cycle rows for the destinations, as batches.transferGroup does, so the
    // grow-out daily, sampling and harvest flows find a stocking.
    const now = Date.now()
    for (const [i, l] of args.lines.entries()) {
      const line = result.lines[i]
      await ctx.db.patch(ids[i], { destinationBatchId: line.targetBatchId ?? undefined })
      const common = {
        fishCount: l.quantity,
        notes: `Fingerlings from ${source.name}`,
        status: 'approved' as const,
        batchId: line.targetBatchId ?? undefined,
        locationId: dests[i].locationId,
        companyId: m.companyId,
        createdBy: m.user._id,
        approvedBy: m.user._id,
        approvedAt: now,
      }
      if (line.kind === 'move') {
        await ctx.db.insert('stockingHistory', {
          ...common,
          cageId: l.destinationUnitId,
          batchNumber: batch.batchNumber,
          stockingDate: args.date,
          initialAbw: l.abwG,
          initialBiomass: biomassKg(l.quantity, l.abwG),
          sourceCage: source.name,
          species: batch.speciesCode ?? source.species,
        })
      } else {
        const destStocking = await stockingAt(ctx, l.destinationUnitId, args.date)
        if (destStocking) {
          await ctx.db.insert('topupHistory', {
            ...common,
            stockingId: destStocking._id,
            topupDate: args.date,
            abw: l.abwG,
            sourceLocation: source.name,
          })
        }
      }
    }
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'nurseryMovements',
      recordId: ids.join(','),
      newValues: { ...args, batchId: batch._id },
      locationId: source.locationId,
    })
    return { movementIds: ids, batchId: batch._id, lines: result.lines, warnings: result.warnings }
  },
})

/**
 * Fingerlings leave the farm: sold by count (a `sales` row with the count,
 * price per fish and batch) or dispatched to another farm. The fish leave the
 * ledger as a harvest of the batch; withdrawal periods apply.
 */
export const dispatchFingerlings = idempotentMutation('nursery.dispatchFingerlings', {
  args: {
    kind: v.union(v.literal('sale'), v.literal('external')),
    unitId: v.id('cages'),
    date: v.string(),
    quantity: v.number(),
    abwG: v.number(),
    pricePerUnit: v.optional(v.number()),
    customerId: v.optional(v.id('customers')),
    customerName: v.optional(v.string()),
    destinationFarm: v.optional(v.string()),
    paymentStatus: v.optional(v.union(v.literal('pending'), v.literal('partial'), v.literal('paid'))),
    notes: v.optional(v.string()),
    withdrawalOverrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.dispatch')
    assertDate(args.date, 'a date')
    validateOut(args.quantity, args.abwG)
    const unit = await ownUnit(ctx, m, args.unitId)
    const batch = await batchIn(ctx, m, unit, args.date)
    const withdrawalOverride = await enforceWithdrawal(ctx, m.user, {
      cageId: unit._id,
      date: args.date,
      action: args.kind === 'sale' ? 'sale' : 'dispatch',
      overrideReason: args.withdrawalOverrideReason,
      batchId: batch._id,
    })
    const kg = round(biomassKg(args.quantity, args.abwG), 3) ?? 0
    let saleId: Id<'sales'> | undefined
    let destinationName: string | undefined
    if (args.kind === 'sale') {
      if (!(args.pricePerUnit !== undefined && Number.isFinite(args.pricePerUnit) && args.pricePerUnit >= 0)) {
        throw userError('VALIDATION', 'Enter the price per fingerling')
      }
      destinationName = cleanText(args.customerName)
      if (args.customerId) {
        const customer = ownDoc(m, await ctx.db.get(args.customerId), 'Customer')
        if (customer.deletedAt) throw userError('NOT_FOUND', 'Customer not found')
        destinationName = customer.name
      }
      if (!destinationName) throw userError('VALIDATION', 'Select a customer or enter a buyer name')
      const totalAmount = Math.round(args.quantity * args.pricePerUnit * 100) / 100
      saleId = await ctx.db.insert('sales', {
        cageId: unit._id,
        customerId: args.customerId,
        customerName: destinationName,
        saleDate: args.date,
        weightKg: kg,
        pricePerKg: kg > 0 ? Math.round((totalAmount / kg) * 100) / 100 : 0,
        totalAmount,
        unitCount: args.quantity,
        pricePerUnit: args.pricePerUnit,
        batchId: batch._id,
        paymentStatus: args.paymentStatus ?? 'pending',
        notes: cleanText(args.notes) ?? `Fingerlings, batch ${batch.batchNumber}`,
        withdrawalOverride,
        locationId: unit.locationId,
        companyId: m.companyId,
        createdBy: m.user._id,
        updatedAt: Date.now(),
      })
    } else {
      destinationName = cleanText(args.destinationFarm)
      if (!destinationName) throw userError('VALIDATION', 'Name the receiving farm')
    }
    const movementId = await insertMovement(ctx, m, unit, batch, {
      kind: args.kind,
      moveDate: args.date,
      quantity: args.quantity,
      abwG: args.abwG,
      destinationName,
      saleId,
      notes: cleanText(args.notes),
    })
    const result = await engine.harvest(
      ctx,
      { companyId: m.companyId, userId: m.user._id },
      { sourceTable: 'nurseryMovements', sourceId: movementId },
      { unitId: unit._id, batchId: batch._id, qty: args.quantity, kg, abwG: args.abwG, date: args.date, complete: false },
    )
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'nurseryMovements',
      recordId: movementId,
      newValues: { ...args, batchId: batch._id, saleId },
      locationId: unit.locationId,
    })
    return { movementId, saleId: saleId ?? null, batchId: batch._id, warnings: result.warnings }
  },
})

/** Reverse a fingerling transfer, sale or dispatch: its events and its sale row. */
export const reverseMovement = mutation({
  args: { id: v.id('nurseryMovements'), reason: v.string() },
  returns: v.object({ reversed: v.number() }),
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.correct')
    const mv = ownDoc(m, await ctx.db.get(args.id), 'Movement')
    if (mv.status === 'reversed') return { reversed: 0 }
    const reason = cleanText(args.reason)
    if (!reason) throw userError('VALIDATION', 'Give a reason')
    const result = await reverseMovementDoc(ctx, m, mv, reason)
    return { reversed: result }
  },
})

async function reverseMovementDoc(
  ctx: MutationCtx,
  m: { companyId: Id<'companies'>; user: Doc<'users'> },
  mv: Doc<'nurseryMovements'>,
  reason: string,
  opts: { keepSale?: boolean } = {},
) {
  const sale = mv.saleId && !opts.keepSale ? await ctx.db.get(mv.saleId) : null
  // Money received stays traceable (INV-009): remove the payments first.
  if (sale?.amountPaid) {
    throw userError('CONFLICT', 'Payments are recorded on this sale. Remove them on the Sales page before reversing.')
  }
  const r = await engine.reverseOperation(
    ctx,
    { companyId: m.companyId, userId: m.user._id },
    { sourceTable: 'nurseryMovements', sourceId: mv._id },
    reason,
  )
  await ctx.db.patch(mv._id, { status: 'reversed', updatedAt: Date.now() })
  if (sale) {
    if (sale.invoiceId) {
      const invoice = await ctx.db.get(sale.invoiceId)
      if (invoice && !invoice.voidedAt) await ctx.db.patch(invoice._id, { voidedAt: Date.now(), updatedAt: Date.now() })
    }
    await ctx.db.delete(sale._id)
  }
  await logAudit(ctx, {
    actionType: 'reverse',
    tableName: 'nurseryMovements',
    recordId: mv._id,
    previousValues: mv,
    newValues: { reason },
    locationId: mv.locationId,
  })
  return r.reversed
}

export const listMovements = query({
  args: { batchId: v.optional(v.id('batches')) },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const rows = args.batchId
      ? (
          await ctx.db
            .query('nurseryMovements')
            .withIndex('by_batchId', (q) => q.eq('batchId', args.batchId!))
            .take(200)
        ).filter((r) => r.companyId === m.companyId)
      : await ctx.db
          .query('nurseryMovements')
          .withIndex('by_companyId_and_moveDate', (q) => q.eq('companyId', m.companyId))
          .order('desc')
          .take(200)
    const out = []
    for (const r of rows) {
      const src = await ctx.db.get(r.sourceUnitId)
      const batch = await ctx.db.get(r.batchId)
      const sale = r.saleId ? await ctx.db.get(r.saleId) : null
      out.push({
        id: r._id,
        kind: r.kind,
        date: r.moveDate,
        status: r.status,
        quantity: r.quantity,
        abw_g: r.abwG,
        source_unit: src?.name ?? '—',
        batch_number: batch?.batchNumber ?? '—',
        destination: r.destinationName ?? null,
        destination_unit_id: r.destinationUnitId ?? null,
        sale_id: r.saleId ?? null,
        amount: sale?.totalAmount ?? null,
        price_per_unit: sale?.pricePerUnit ?? null,
      })
    }
    return out
  },
})

/** Nursery units for pickers: larval, nursery and incubation units with their batch and count. */
export const nurseryUnits = query({
  args: {},
  handler: async (ctx) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const cages = await ctx.db
      .query('cages')
      .withIndex('by_company', (q) => q.eq('companyId', m.companyId))
      .take(1000)
    const out = []
    for (const c of cages) {
      const type = c.unitType ?? 'cage'
      const batch = c.currentBatchId ? await ctx.db.get(c.currentBatchId) : null
      out.push({
        id: c._id,
        name: c.name,
        unit_type: type,
        nursery: NURSERY_UNITS.has(type),
        count: c.currentCount ?? 0,
        batch_id: batch?._id ?? null,
        batch_number: batch?.batchNumber ?? null,
        location_id: c.locationId ?? null,
        status: c.status,
      })
    }
    return out
  },
})
