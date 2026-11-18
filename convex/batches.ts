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
import { requireRole, requireUser } from './lib/authz'
import { assertOwns, listForCompany, logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import * as engine from './lib/productionEngine'
import { flowsOf, occupancyKpis, survivalPct, cumulativeMortalityPct, round } from './lib/kpi'
import { feedFor, stockingAt } from './lib/productionDualWrite'
import { deriveTransferType, transferBiomassKg } from './lib/fishTransferLogic'

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

/** A cage's batch history: events, occupancies and the count as of a date. */
export const forCage = query({
  args: { cageId: v.id('cages'), asOf: v.optional(v.string()) },
  handler: async (ctx, { cageId, asOf }) => {
    const user = await requireUser(ctx)
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
  handler: async (ctx, { status }) => {
    const user = await requireUser(ctx)
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
  handler: async (ctx, { id, asOf }) => {
    const user = await requireUser(ctx)
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
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
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
      }),
    ),
    culls: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
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
    const companyId = cage.companyId!
    const opId = await ctx.db.insert('stockOperations', {
      companyId,
      locationId: cage.locationId,
      kind: 'grading_split',
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
      newValues: { ...args, childBatchIds: result.childBatchIds, unaccounted: result.unaccounted },
      locationId: cage.locationId,
    })
    return { operationId: opId, childBatchIds: result.childBatchIds, unaccounted: result.unaccounted, warnings: result.warnings }
  },
})
