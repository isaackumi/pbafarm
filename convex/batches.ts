/**
 * Batches and the stock ledger for the UI (PROD-001, PROD-006, TRACE-001):
 * a cage's batch history (events, as-of count), a batch with its lineage and
 * occupancies, and the engine-native operations that the legacy flows cannot
 * express: one transfer to several cages, and grading into child batches.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, listForCompany, logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import * as engine from './lib/productionEngine'
import { flowsOf, occupancyKpis, survivalPct, cumulativeMortalityPct, round } from './lib/kpi'
import { feedFor, stockingAt } from './lib/productionDualWrite'
import { deriveTransferType, transferBiomassKg } from './lib/fishTransferLogic'
import { requireMember } from './lib/permissions'
import { GRADING_LIMITS, gradingCv, sampleStats } from './lib/gradingMath'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EVENT_LIMIT = 200

const LABEL: Record<string, string> = {
  stock_in: 'Stocked',
  mortality: 'Deaths',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
  harvest: 'Harvested',
  grading_split: 'Graded',
  merge: 'Merged',
  count_adjustment: 'Count adjustment',
  reversal: 'Reversal',
}

/** Client rows for events, with batch numbers and counterpart cage names. */
async function eventRows(ctx: QueryCtx, events: Doc<'stockEvents'>[]) {
  const reversed = new Set(events.map((e) => e.reversesEventId).filter(Boolean).map(String))
  const batches = new Map<string, string>()
  const cages = new Map<string, string>()
  const batchNo = async (id?: Id<'batches'>) => {
    if (!id) return null
    if (!batches.has(String(id))) batches.set(String(id), (await ctx.db.get(id))?.batchNumber ?? '—')
    return batches.get(String(id))!
  }
  const cageName = async (id?: Id<'cages'>) => {
    if (!id) return null
    if (!cages.has(String(id))) cages.set(String(id), (await ctx.db.get(id))?.name ?? '—')
    return cages.get(String(id))!
  }
  const out = []
  for (const e of events) {
    const kind = e.type === 'reversal' ? e.reversedType ?? 'count_adjustment' : e.type
    out.push({
      id: e._id,
      date: e.eventDate,
      type: e.type,
      label:
        e.type === 'reversal'
          ? `Reversal of ${(LABEL[kind] ?? kind).toLowerCase()}`
          : e.component === engine.CLOSEOUT
            ? 'Close-out'
            : LABEL[e.type] ?? e.type,
      qty: e.qtyDelta,
      kg: round(e.biomassKgDelta, 1),
      abw_g: e.abwG ?? null,
      batch_id: e.batchId,
      batch_number: await batchNo(e.batchId),
      cage_id: e.unitId,
      cage_name: await cageName(e.unitId),
      counterpart_cage: await cageName(e.counterpartUnitId),
      counterpart_batch: await batchNo(e.counterpartBatchId),
      reason: e.reason ?? null,
      source: e.sourceTable,
      reversed: reversed.has(String(e._id)),
      recorded_at: e.recordedAt,
    })
  }
  return out
}

const newestFirst = (a: Doc<'stockEvents'>, b: Doc<'stockEvents'>) => engine.compareLedger(b, a)

const ancestorRow = v.object({
  id: v.id('batches'),
  batch_number: v.string(),
  depth: v.number(),
  status: v.string(),
})

const originValues = v.union(
  v.literal('legacy'),
  v.literal('hatchery'),
  v.literal('merge'),
  v.literal('stocking'),
  v.literal('transfer_split'),
  v.literal('grading_split'),
)

const eventRow = v.object({
  id: v.id('stockEvents'),
  date: v.string(),
  type: v.union(
    v.literal('mortality'),
    v.literal('reversal'),
    v.literal('transfer_out'),
    v.literal('transfer_in'),
    v.literal('merge'),
    v.literal('grading_split'),
    v.literal('stock_in'),
    v.literal('harvest'),
    v.literal('count_adjustment'),
  ),
  label: v.string(),
  qty: v.number(),
  kg: v.union(v.number(), v.null()),
  abw_g: v.union(v.number(), v.null()),
  batch_id: v.id('batches'),
  batch_number: v.union(v.string(), v.null()),
  cage_id: v.id('cages'),
  cage_name: v.union(v.string(), v.null()),
  counterpart_cage: v.union(v.string(), v.null()),
  counterpart_batch: v.union(v.string(), v.null()),
  reason: v.union(v.string(), v.null()),
  source: v.union(
    v.literal('dailyRecords'),
    v.literal('stockingHistory'),
    v.literal('harvestRecords'),
    v.literal('topupHistory'),
    v.literal('fishTransfers'),
    v.literal('stockOperations'),
    v.literal('legacyBackfill'),
    v.literal('incubationLots'),
    v.literal('larvalLogs'),
    v.literal('nurseryMovements'),
  ),
  reversed: v.boolean(),
  recorded_at: v.number(),
})

/** A cage's batch history: events, occupancies and the count as of a date. */
export const forCage = query({
  args: { cageId: v.id('cages'), asOf: v.optional(v.string()) },
  returns: v.union(
    v.object({
      cage_count: v.number(),
      ledger_count: v.number(),
      in_step: v.boolean(),
      has_ledger: v.boolean(),
      as_of: v.union(
        v.object({
          date: v.optional(v.string()),
          count: v.number(),
          biomass_kg: v.union(v.number(), v.null()),
          abw_g: v.union(v.number(), v.null()),
        }),
        v.null(),
      ),
      occupancies: v.array(
        v.object({
          batch_id: v.id('batches'),
          batch_number: v.string(),
          opened_on: v.string(),
          closed_on: v.union(v.string(), v.null()),
          count: v.number(),
        }),
      ),
      events: v.array(eventRow),
    }),
    v.null(),
  ),
  handler: async (ctx, { cageId, asOf }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(cageId)
    if (!cage || !(await listForCompany(user, [cage])).length) return null
    const all = await engine.eventsForUnit(ctx, cageId)
    const ledgerCount = all.reduce((s, e) => s + e.qtyDelta, 0)

    const byBatch = new Map<string, Doc<'stockEvents'>[]>()
    for (const e of all) {
      const k = String(e.batchId)
      if (!byBatch.has(k)) byBatch.set(k, [])
      byBatch.get(k)!.push(e)
    }
    const occupancies = []
    for (const list of byBatch.values()) {
      const sorted = [...list].sort(engine.compareLedger)
      const b = await ctx.db.get(sorted[0].batchId)
      const count = sorted.reduce((s, e) => s + e.qtyDelta, 0)
      occupancies.push({
        batch_id: sorted[0].batchId,
        batch_number: b?.batchNumber ?? '—',
        opened_on: sorted.find((e) => e.qtyDelta > 0)?.eventDate ?? sorted[0].eventDate,
        closed_on: count <= 0 ? sorted[sorted.length - 1].eventDate : null,
        count,
      })
    }
    occupancies.sort((a, b) => b.opened_on.localeCompare(a.opened_on))

    const asOfStock = asOf && DATE_RE.test(asOf) ? await engine.stockAsOf(ctx, { unitId: cageId, date: asOf }) : null
    return {
      cage_count: cage.currentCount ?? 0,
      ledger_count: ledgerCount,
      in_step: ledgerCount === (cage.currentCount ?? 0),
      has_ledger: all.length > 0,
      as_of: asOfStock
        ? { date: asOf, count: asOfStock.count, biomass_kg: round(asOfStock.biomassKg, 1), abw_g: round(asOfStock.abwG, 1) }
        : null,
      occupancies,
      events: await eventRows(ctx, [...all].sort(newestFirst).slice(0, EVENT_LIMIT)),
    }
  },
})

/** Company batches, newest first. */
export const list = query({
  args: { status: v.optional(v.union(v.literal('active'), v.literal('closed'))) },
  returns: v.array(
    v.object({
      id: v.id('batches'),
      batch_number: v.string(),
      status: v.union(v.literal('active'), v.literal('closed')),
      origin: originValues,
      species: v.union(v.string(), v.null()),
      opened_on: v.string(),
      closed_on: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { status }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    const rows = status
      ? await ctx.db
          .query('batches')
          .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', status))
          .order('desc')
          .take(200)
      : await ctx.db
          .query('batches')
          .withIndex('by_companyId_and_batchNumber', (q) => q.eq('companyId', companyId))
          .take(500)
    return rows
      .sort((a, b) => b.openedOn.localeCompare(a.openedOn))
      .map((b) => ({
        id: b._id,
        batch_number: b.batchNumber,
        status: b.status,
        origin: b.origin,
        species: b.speciesCode ?? null,
        opened_on: b.openedOn,
        closed_on: b.closedOn ?? null,
      }))
  },
})

/** One batch: lineage, every occupancy with its KPIs, totals and recent events. */
export const get = query({
  args: { id: v.id('batches'), asOf: v.optional(v.string()) },
  returns: v.union(
    v.object({
      id: v.id('batches'),
      batch_number: v.string(),
      status: v.union(v.literal('active'), v.literal('closed')),
      origin: originValues,
      species: v.union(v.string(), v.null()),
      opened_on: v.string(),
      closed_on: v.union(v.string(), v.null()),
      home_location_id: v.union(v.id('farmLocations'), v.null()),
      custom: v.record(v.string(), v.any()),
      stocking_id: v.union(v.id('stockingHistory'), v.null()),
      parents: v.array(v.object({ id: v.id('batches'), batch_number: v.string() })),
      ancestors: v.array(ancestorRow),
      descendants: v.array(ancestorRow),
      totals: v.object({
        count: v.number(),
        stocked: v.number(),
        moved_in: v.number(),
        moved_out: v.number(),
        mortality: v.number(),
        harvested: v.number(),
        harvested_kg: v.union(v.number(), v.null()),
        unaccounted: v.number(),
        survival_pct: v.union(v.number(), v.null()),
        mortality_pct: v.union(v.number(), v.null()),
      }),
      occupancies: v.array(
        v.object({
          opened_on: v.union(v.string(), v.null()),
          closed_on: v.union(v.string(), v.null()),
          days_of_culture: v.union(v.number(), v.null()),
          count: v.number(),
          stocked_count: v.number(),
          in_count: v.number(),
          out_count: v.number(),
          harvested_count: v.number(),
          harvested_kg: v.number(),
          mortality: v.number(),
          unaccounted: v.number(),
          initial_abw_g: v.union(v.number(), v.null()),
          current_abw_g: v.union(v.number(), v.null()),
          abw_measured_on: v.union(v.string(), v.null()),
          stocked_biomass_kg: v.number(),
          current_biomass_kg: v.number(),
          gain_kg: v.number(),
          feed_kg: v.number(),
          feed_cost: v.number(),
          efcr: v.union(v.number(), v.null()),
          biological_fcr: v.union(v.number(), v.null()),
          survival_pct: v.union(v.number(), v.null()),
          mortality_pct: v.union(v.number(), v.null()),
          sgr_pct_day: v.union(v.number(), v.null()),
          adg_g_day: v.union(v.number(), v.null()),
          cage_id: v.id('cages'),
          cage_name: v.string(),
        }),
      ),
      events: v.array(eventRow),
    }),
    v.null(),
  ),
  handler: async (ctx, { id, asOf }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const batch = await ctx.db.get(id)
    if (!batch || !(await listForCompany(user, [batch])).length) return null
    const events = await engine.eventsForBatch(ctx, id)
    // Queries do not read the clock: the client passes its today.
    const latest = events.reduce((m, e) => (e.eventDate > m ? e.eventDate : m), batch.openedOn)
    const date = asOf && DATE_RE.test(asOf) ? asOf : latest
    const lin = await engine.lineage(ctx, id)

    const byUnit = new Map<string, Doc<'stockEvents'>[]>()
    for (const e of events) {
      const k = String(e.unitId)
      if (!byUnit.has(k)) byUnit.set(k, [])
      byUnit.get(k)!.push(e)
    }
    const occupancies = []
    for (const list of byUnit.values()) {
      const unitId = list[0].unitId
      const cage = await ctx.db.get(unitId)
      const sorted = [...list].sort(engine.compareLedger)
      const openedOn = sorted.find((e) => e.qtyDelta > 0)?.eventDate ?? sorted[0].eventDate
      const count = sorted.reduce((s, e) => s + e.qtyDelta, 0)
      const end = count <= 0 ? sorted[sorted.length - 1].eventDate : date
      const feed = await feedFor(ctx, unitId, id, openedOn, end)
      const k = occupancyKpis({
        events: sorted,
        samples: await engine.samplesFor(ctx, unitId, id),
        feedKg: feed.kg,
        feedCost: feed.cost,
        asOf: end,
      })
      occupancies.push({ cage_id: unitId, cage_name: cage?.name ?? '—', ...k })
    }
    occupancies.sort((a, b) => (b.opened_on ?? '').localeCompare(a.opened_on ?? ''))

    const f = flowsOf(events)
    const refs = async (ids: Id<'batches'>[] | undefined) => {
      const out = []
      for (const pid of ids ?? []) {
        const p = await ctx.db.get(pid)
        if (p) out.push({ id: p._id, batch_number: p.batchNumber })
      }
      return out
    }
    const stocking = batch.legacyStockingId ? await ctx.db.get(batch.legacyStockingId) : null
    return {
      id: batch._id,
      batch_number: batch.batchNumber,
      status: batch.status,
      origin: batch.origin,
      species: batch.speciesCode ?? null,
      opened_on: batch.openedOn,
      closed_on: batch.closedOn ?? null,
      home_location_id: batch.homeLocationId ?? null,
      custom: batch.custom ?? {},
      stocking_id: stocking?._id ?? null,
      parents: await refs(batch.parentBatchIds),
      ancestors: lin.ancestors.map((a) => ({ id: a._id, batch_number: a.batchNumber, depth: a.depth, status: a.status })),
      descendants: lin.descendants.map((d) => ({ id: d._id, batch_number: d.batchNumber, depth: d.depth, status: d.status })),
      totals: {
        count: f.count,
        stocked: f.stockedCount,
        moved_in: f.inCount,
        moved_out: f.outCount,
        mortality: f.mortalityCount,
        harvested: f.harvestedCount,
        harvested_kg: round(f.harvestedKg, 1),
        unaccounted: f.unaccountedCount,
        survival_pct: round(survivalPct(f), 1),
        mortality_pct: round(cumulativeMortalityPct(f), 1),
      },
      occupancies,
      events: await eventRows(ctx, [...events].sort(newestFirst).slice(0, EVENT_LIMIT)),
    }
  },
})

// ---------------------------------------------------------------------------
// Engine-native operations
// ---------------------------------------------------------------------------

/** Refuse engine-only operations on a cage whose ledger has not been built yet. */
async function assertLedgerReady(ctx: MutationCtx, cage: Doc<'cages'>) {
  const events = await engine.eventsForUnit(ctx, cage._id)
  const ledger = events.reduce((s, e) => s + e.qtyDelta, 0)
  if ((cage.currentCount ?? 0) > 0 && events.length === 0) {
    throw userError(
      'CONFLICT',
      `The stock ledger for ${cage.name} has not been built yet. Use a single transfer until the backfill has run.`,
      { reason: 'LEDGER_NOT_READY' },
    )
  }
  if (ledger !== (cage.currentCount ?? 0)) {
    throw userError(
      'CONFLICT',
      `${cage.name} shows ${(cage.currentCount ?? 0).toLocaleString()} fish but the stock ledger has ${ledger.toLocaleString()}. Reconcile the count first.`,
      { reason: 'LEDGER_MISMATCH' },
    )
  }
}

async function ownedCage(ctx: MutationCtx, user: Doc<'users'>, id: Id<'cages'>) {
  const cage = await ctx.db.get(id)
  assertOwns(user, cage, 'Cage')
  if (!cage.companyId) throw userError('NOT_FOUND', 'Cage not found')
  return cage
}

/**
 * Move fish from one cage to several in one approved operation (doc 05 §7.2).
 * All lines post together, so they cannot together exceed the source. Each
 * line is a `fishTransfers` row sharing `transferGroupId`; an empty
 * destination gets a stocking row for the same batch, an occupied one a
 * top-up row, so the cycle views keep working. Admin only.
 */
export const transferGroup = mutation({
  args: {
    sourceCageId: v.id('cages'),
    transferDate: v.string(),
    lines: v.array(
      v.object({
        destinationCageId: v.id('cages'),
        quantity: v.number(),
        abw: v.number(),
      }),
    ),
    transferSupervisor: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.object({ transferGroupId: v.string(), ids: v.array(v.id('fishTransfers')), warnings: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.transfer.approve' })
    if (!DATE_RE.test(args.transferDate)) throw userError('VALIDATION', 'Choose a transfer date')
    if (!args.lines.length) throw userError('VALIDATION', 'Add at least one destination')
    if (args.lines.length > engine.MAX_LINES) {
      throw userError('VALIDATION', `At most ${engine.MAX_LINES} destinations`)
    }
    const source = await ownedCage(ctx, user, args.sourceCageId)
    await assertLedgerReady(ctx, source)
    const seen = new Set<string>()
    const dests: Doc<'cages'>[] = []
    for (const l of args.lines) {
      if (l.destinationCageId === args.sourceCageId) {
        throw userError('VALIDATION', 'A destination cannot be the source cage')
      }
      if (seen.has(String(l.destinationCageId))) {
        throw userError('VALIDATION', 'Each destination cage can appear once')
      }
      seen.add(String(l.destinationCageId))
      if (!(Number.isInteger(l.quantity) && l.quantity > 0) || !(l.abw > 0)) {
        throw userError('VALIDATION', 'Each destination needs a whole number of fish and an ABW')
      }
      const dest = await ownedCage(ctx, user, l.destinationCageId)
      if (dest.companyId !== source.companyId) throw userError('NOT_FOUND', 'Cage not found')
      dests.push(dest)
    }
    const total = args.lines.reduce((s, l) => s + l.quantity, 0)
    const sourceCount = source.currentCount ?? 0
    if (total > sourceCount) {
      throw userError('CONFLICT', `${total.toLocaleString()} fish is more than the ${sourceCount.toLocaleString()} in ${source.name}`)
    }

    const companyId = source.companyId!
    const now = Date.now()
    const transferGroupId = `${args.sourceCageId}-${now}`
    const batchId = await engine.openBatchInUnit(ctx, source._id, args.transferDate)
    const batch = batchId ? await ctx.db.get(batchId) : null
    const sourceStocking = await stockingAt(ctx, source._id, args.transferDate)
    const ids: Id<'fishTransfers'>[] = []
    for (const [i, l] of args.lines.entries()) {
      ids.push(
        await ctx.db.insert('fishTransfers', {
          sourceCageId: source._id,
          destinationCageId: l.destinationCageId,
          sourceLocationId: source.locationId,
          destinationLocationId: dests[i].locationId,
          sourceStockingId: sourceStocking?._id,
          transferDate: args.transferDate,
          quantity: l.quantity,
          abw: l.abw,
          biomass: transferBiomassKg(l.quantity, l.abw),
          transferType: deriveTransferType(total, sourceCount),
          transferSupervisor: args.transferSupervisor,
          notes: args.notes,
          status: 'approved',
          companyId,
          createdBy: user._id,
          approvedBy: user._id,
          approvedAt: now,
          batchId: batchId ?? undefined,
          transferGroupId,
          updatedAt: now,
        }),
      )
    }

    const result = await engine.transfer(
      ctx,
      { companyId, userId: user._id },
      args.lines.map((l, i) => ({
        src: { sourceTable: 'fishTransfers' as const, sourceId: ids[i] },
        sourceUnitId: source._id,
        batchId: batchId ?? undefined,
        destinationUnitId: l.destinationCageId,
        qty: l.quantity,
        abwG: l.abw,
        date: args.transferDate,
      })),
    )

    // Cycle rows for the destinations (the cycle views and the dual-write read them).
    for (const [i, l] of args.lines.entries()) {
      const line = result.lines[i]
      const patch: Partial<Doc<'fishTransfers'>> = { mode: line.kind }
      if (line.kind === 'move') {
        const stockingId = await ctx.db.insert('stockingHistory', {
          cageId: l.destinationCageId,
          batchNumber: batch?.batchNumber ?? sourceStocking?.batchNumber ?? 'TRANSFER',
          stockingDate: args.transferDate,
          fishCount: l.quantity,
          initialAbw: l.abw,
          initialBiomass: transferBiomassKg(l.quantity, l.abw),
          sourceCage: source.name,
          notes: `Fish transfer from ${source.name}`,
          species: source.species,
          status: 'approved',
          batchId: line.targetBatchId ?? undefined,
          locationId: dests[i].locationId,
          companyId,
          createdBy: user._id,
          approvedBy: user._id,
          approvedAt: now,
        })
        patch.destinationStockingId = stockingId
      } else {
        const destStocking = await stockingAt(ctx, l.destinationCageId, args.transferDate)
        if (destStocking) {
          patch.destinationTopupId = await ctx.db.insert('topupHistory', {
            stockingId: destStocking._id,
            topupDate: args.transferDate,
            fishCount: l.quantity,
            abw: l.abw,
            sourceLocation: source.name,
            notes: `Fish transfer from ${source.name}`,
            status: 'approved',
            batchId: line.targetBatchId ?? undefined,
            locationId: dests[i].locationId,
            companyId,
            createdBy: user._id,
            approvedBy: user._id,
            approvedAt: now,
          })
        }
      }
      await ctx.db.patch(ids[i], patch)
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'fishTransfers',
      recordId: transferGroupId,
      newValues: { ...args, transferGroupId, ids },
      locationId: source.locationId,
    })
    return { transferGroupId, ids, warnings: result.warnings }
  },
})

/**
 * Grade a cage's whole batch into child batches (doc 05 §7.3): each output
 * opens a child batch in its cage, culls are recorded as deaths, and any fish
 * not accounted for become a close-out. Admin only.
 */
export const grade = mutation({
  args: {
    cageId: v.id('cages'),
    date: v.string(),
    outputs: v.array(
      v.object({
        cageId: v.id('cages'),
        quantity: v.number(),
        abw: v.number(),
        batchNumber: v.optional(v.string()),
        /** Sample check (Paper 52): weighing rounds of fish weights (g). */
        samples: v.optional(v.array(v.array(v.number()))),
      }),
    ),
    culls: v.optional(v.number()),
    reason: v.optional(v.string()),
    /** Grader bar spacing, e.g. "18 / 24 mm". */
    graderBars: v.optional(v.string()),
  },
  returns: v.object({ operationId: v.id('stockOperations'), childBatchIds: v.array(v.id('batches')), unaccounted: v.number(), warnings: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.transfer.approve' })
    if (!DATE_RE.test(args.date)) throw userError('VALIDATION', 'Choose a grading date')
    const cage = await ownedCage(ctx, user, args.cageId)
    await assertLedgerReady(ctx, cage)
    const outCages = new Map<string, Doc<'cages'>>()
    for (const o of args.outputs) {
      if (outCages.has(String(o.cageId))) throw userError('VALIDATION', 'Each cage can receive one grade')
      const c = await ownedCage(ctx, user, o.cageId)
      if (c.companyId !== cage.companyId) throw userError('NOT_FOUND', 'Cage not found')
      outCages.set(String(o.cageId), c)
    }
    if ((args.graderBars ?? '').length > GRADING_LIMITS.graderBars) throw userError('VALIDATION', 'Grader bars are too long')
    for (const o of args.outputs) {
      const rounds = o.samples ?? []
      if (rounds.length > GRADING_LIMITS.rounds || rounds.some((r) => r.length > GRADING_LIMITS.perRound)) {
        throw userError('VALIDATION', `At most ${GRADING_LIMITS.rounds} rounds of ${GRADING_LIMITS.perRound} fish per class`)
      }
    }
    const stats = args.outputs.map((o) => sampleStats(o.samples))
    const cv = gradingCv(args.outputs.map((o, i) => ({ count: o.quantity, stats: stats[i] })))
    const companyId = cage.companyId!
    const opId = await ctx.db.insert('stockOperations', {
      companyId,
      locationId: cage.locationId,
      kind: 'grading_split',
      grading: {
        graderBars: args.graderBars?.trim() || undefined,
        classes: args.outputs.length,
        sampledFish: stats.reduce((s, x) => s + (x?.n ?? 0), 0),
        cvBeforePct: cv ? Math.round(cv.beforePct * 10) / 10 : null,
        cvAfterPct: cv ? Math.round(cv.afterPct * 10) / 10 : null,
      },
      operationDate: args.date,
      status: 'approved',
      unitId: cage._id,
      reason: args.reason?.trim() || undefined,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    const parentStocking = await stockingAt(ctx, cage._id, args.date)
    const result = await engine.gradingSplit(
      ctx,
      { companyId, userId: user._id },
      { sourceTable: 'stockOperations', sourceId: opId },
      {
        unitId: cage._id,
        date: args.date,
        outputs: args.outputs.map((o) => ({
          unitId: o.cageId,
          qty: o.quantity,
          abwG: o.abw,
          newBatchNumber: o.batchNumber,
        })),
        culls: args.culls ?? 0,
      },
    )

    // The old cycle ends; each output cage starts a cycle for its child batch.
    if (parentStocking && !parentStocking.closedAt) {
      await ctx.db.patch(parentStocking._id, { closedAt: args.date })
    }
    const now = Date.now()
    for (const [i, o] of args.outputs.entries()) {
      const childId = result.childBatchIds[i]
      const child = await ctx.db.get(childId)
      const stockingId = await ctx.db.insert('stockingHistory', {
        cageId: o.cageId,
        batchNumber: child?.batchNumber ?? `${parentStocking?.batchNumber ?? 'GRADE'}-${i + 1}`,
        stockingDate: args.date,
        fishCount: o.quantity,
        initialAbw: o.abw,
        initialBiomass: transferBiomassKg(o.quantity, o.abw),
        sourceCage: cage.name,
        notes: `Graded from ${cage.name}`,
        species: cage.species,
        status: 'approved',
        batchId: childId,
        locationId: outCages.get(String(o.cageId))!.locationId,
        companyId,
        createdBy: user._id,
        approvedBy: user._id,
        approvedAt: now,
      })
      await ctx.db.patch(childId, { legacyStockingId: stockingId })
      await ctx.db.patch(o.cageId, {
        stockingDate: args.date,
        initialCount: o.quantity,
        initialAbw: o.abw,
        currentWeight: o.abw,
        status: 'active',
        species: cage.species,
        updatedAt: now,
      })
    }
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'stockOperations',
      recordId: opId,
      newValues: {
        cageId: args.cageId,
        date: args.date,
        outputs: args.outputs.map(({ samples: _samples, ...o }) => o),
        culls: args.culls,
        reason: args.reason,
        graderBars: args.graderBars,
        childBatchIds: result.childBatchIds,
        unaccounted: result.unaccounted,
      },
      locationId: cage.locationId,
    })
    // The grading is confirmed: its draft is done.
    const draft = await ctx.db
      .query('gradingDrafts')
      .withIndex('by_companyId_and_unitId', (q) => q.eq('companyId', companyId).eq('unitId', cage._id))
      .unique()
    if (draft) await ctx.db.delete(draft._id)
    return { operationId: opId, childBatchIds: result.childBatchIds, unaccounted: result.unaccounted, warnings: result.warnings }
  },
})
