/**
 * Traceability (Phase 12): harvest lots, dispatches, a batch's trace (origin
 * journey, feed lots, treatments, lots and customers) and the per-lot trace
 * report behind /trace/[lotId].
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, listForCompany, logAudit, writeCompanyId } from './lib/tenancy'
import { userError } from './lib/errors'
import {
  batchWithAncestors,
  blockingTreatments,
  enforceWithdrawal,
  feedLotsFor,
  journeyOf,
  nextLotCode,
  occupanciesFor,
  treatmentsDuring,
} from './lib/traceability'
import { requireMember } from './lib/permissions'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KG_TOLERANCE = 0.05
const LOT_LIMIT = 200

const round1 = (n: number) => Math.round(n * 10) / 10

function lotRow(l: Doc<'harvestLots'>, dispatchedKg = 0) {
  return {
    id: l._id,
    lot_code: l.lotCode,
    harvest_id: l.harvestId,
    cage_id: l.cageId,
    batch_id: l.batchId ?? null,
    harvest_date: l.harvestDate,
    weight_kg: l.weightKg,
    fish_count: l.fishCount ?? null,
    grade: l.grade ?? null,
    destination: l.destination ?? null,
    notes: l.notes ?? null,
    dispatched_kg: round1(dispatchedKg),
    remaining_kg: round1(Math.max(0, l.weightKg - dispatchedKg)),
    created_at: l._creationTime,
  }
}

function dispatchRow(d: Doc<'dispatches'>) {
  return {
    id: d._id,
    harvest_lot_id: d.harvestLotId,
    customer_id: d.customerId ?? null,
    customer_name: d.customerName ?? null,
    sale_id: d.saleId ?? null,
    dispatch_date: d.dispatchDate,
    weight_kg: d.weightKg,
    vehicle: d.vehicle ?? null,
    driver: d.driver ?? null,
    temperature_c: d.temperatureC ?? null,
    notes: d.notes ?? null,
    withdrawal_override: d.withdrawalOverride
      ? { reason: d.withdrawalOverride.reason, until: d.withdrawalOverride.until }
      : null,
  }
}

async function dispatchesOf(ctx: QueryCtx | MutationCtx, lotId: Id<'harvestLots'>) {
  return await ctx.db
    .query('dispatches')
    .withIndex('by_harvestLotId', (q) => q.eq('harvestLotId', lotId))
    .take(LOT_LIMIT)
}

async function lotsOfHarvest(ctx: QueryCtx | MutationCtx, harvestId: Id<'harvestRecords'>) {
  return await ctx.db
    .query('harvestLots')
    .withIndex('by_harvestId', (q) => q.eq('harvestId', harvestId))
    .take(LOT_LIMIT)
}

// ---------------------------------------------------------------------------
// Harvest lots
// ---------------------------------------------------------------------------

export const listLots = query({
  args: {
    harvestId: v.optional(v.id('harvestRecords')),
    batchId: v.optional(v.id('batches')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      cage_name: v.string(),
      id: v.id('harvestLots'),
      lot_code: v.string(),
      harvest_id: v.id('harvestRecords'),
      cage_id: v.id('cages'),
      batch_id: v.union(v.id('batches'), v.null()),
      harvest_date: v.string(),
      weight_kg: v.number(),
      fish_count: v.union(v.number(), v.null()),
      grade: v.union(v.string(), v.null()),
      destination: v.union(v.string(), v.null()),
      notes: v.union(v.string(), v.null()),
      dispatched_kg: v.number(),
      remaining_kg: v.number(),
      created_at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    let rows: Doc<'harvestLots'>[]
    if (args.harvestId) rows = await lotsOfHarvest(ctx, args.harvestId)
    else if (args.batchId) {
      const batchId = args.batchId
      rows = await ctx.db
        .query('harvestLots')
        .withIndex('by_batchId', (q) => q.eq('batchId', batchId))
        .take(LOT_LIMIT)
    } else {
      rows = await ctx.db
        .query('harvestLots')
        .withIndex('by_companyId_and_harvestDate', (q) => {
          const base = q.eq('companyId', companyId)
          if (args.dateFrom && args.dateTo) return base.gte('harvestDate', args.dateFrom).lte('harvestDate', args.dateTo)
          if (args.dateFrom) return base.gte('harvestDate', args.dateFrom)
          if (args.dateTo) return base.lte('harvestDate', args.dateTo)
          return base
        })
        .order('desc')
        .take(LOT_LIMIT)
    }
    rows = await listForCompany(user, rows)
    const out = []
    for (const l of rows) {
      const sent = (await dispatchesOf(ctx, l._id)).reduce((s, d) => s + d.weightKg, 0)
      const cage = await ctx.db.get(l.cageId)
      out.push({ ...lotRow(l, sent), cage_name: cage?.name ?? '—' })
    }
    return out.sort((a, b) => b.harvest_date.localeCompare(a.harvest_date) || a.lot_code.localeCompare(b.lot_code))
  },
})

export const createLot = mutation({
  args: {
    harvestId: v.id('harvestRecords'),
    lotCode: v.optional(v.string()),
    weightKg: v.number(),
    fishCount: v.optional(v.number()),
    grade: v.optional(v.string()),
    destination: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.object({ id: v.id('harvestLots'), lotCode: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.harvest.record' })
    const harvest = await ctx.db.get(args.harvestId)
    assertOwns(user, harvest, 'Harvest')
    const companyId = await writeCompanyId(user)
    if (!(args.weightKg > 0)) throw userError('VALIDATION', 'Lot weight must be greater than zero')
    if (args.fishCount != null && !(args.fishCount >= 0)) {
      throw userError('VALIDATION', 'Fish count cannot be negative')
    }
    const lotted = (await lotsOfHarvest(ctx, harvest._id)).reduce((s, l) => s + l.weightKg, 0)
    if (lotted + args.weightKg > harvest.totalWeight + KG_TOLERANCE) {
      throw userError(
        'VALIDATION',
        `Lots would exceed the harvest weight (harvest ${harvest.totalWeight} kg, already in lots ${round1(lotted)} kg)`,
      )
    }
    let lotCode = args.lotCode?.trim().toUpperCase()
    if (lotCode) {
      const code = lotCode
      const clash = await ctx.db
        .query('harvestLots')
        .withIndex('by_companyId_and_lotCode', (q) => q.eq('companyId', companyId).eq('lotCode', code))
        .first()
      if (clash) throw userError('DUPLICATE', `Lot code ${lotCode} is already used`)
    } else {
      lotCode = await nextLotCode(ctx, companyId, harvest)
    }
    const id = await ctx.db.insert('harvestLots', {
      companyId,
      locationId: harvest.locationId,
      harvestId: harvest._id,
      cageId: harvest.cageId,
      batchId: harvest.batchId,
      lotCode,
      harvestDate: harvest.harvestDate,
      weightKg: args.weightKg,
      fishCount: args.fishCount != null ? Math.round(args.fishCount) : undefined,
      grade: args.grade?.trim() || undefined,
      destination: args.destination?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'harvestLots',
      recordId: id,
      newValues: { ...args, lotCode },
      locationId: harvest.locationId,
    })
    return { id, lotCode }
  },
})

export const removeLot = mutation({
  args: { id: v.id('harvestLots') },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.records.delete' })
    const lot = await ctx.db.get(id)
    assertOwns(user, lot, 'Lot')
    if ((await dispatchesOf(ctx, id)).length) {
      throw userError('CONFLICT', 'This lot has dispatches; remove them first')
    }
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'harvestLots',
      recordId: id,
      previousValues: lot,
      locationId: lot.locationId,
    })
    return { ok: true }
  },
})

// ---------------------------------------------------------------------------
// Dispatches
// ---------------------------------------------------------------------------

export const createDispatch = mutation({
  args: {
    harvestLotId: v.id('harvestLots'),
    dispatchDate: v.string(),
    weightKg: v.optional(v.number()),
    customerId: v.optional(v.id('customers')),
    customerName: v.optional(v.string()),
    saleId: v.optional(v.id('sales')),
    vehicle: v.optional(v.string()),
    driver: v.optional(v.string()),
    temperatureC: v.optional(v.number()),
    notes: v.optional(v.string()),
    withdrawalOverrideReason: v.optional(v.string()),
  },
  returns: v.id('dispatches'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.harvest.record' })
    const lot = await ctx.db.get(args.harvestLotId)
    assertOwns(user, lot, 'Lot')
    if (!DATE_RE.test(args.dispatchDate)) throw userError('VALIDATION', 'Dispatch date must be YYYY-MM-DD')
    if (args.dispatchDate < lot.harvestDate) {
      throw userError('VALIDATION', 'A lot cannot be dispatched before it was harvested')
    }
    const sent = (await dispatchesOf(ctx, lot._id)).reduce((s, d) => s + d.weightKg, 0)
    const remaining = lot.weightKg - sent
    const weightKg = args.weightKg ?? remaining
    if (!(weightKg > 0)) throw userError('VALIDATION', 'Nothing left to dispatch from this lot')
    if (weightKg > remaining + KG_TOLERANCE) {
      throw userError('VALIDATION', `Only ${round1(remaining)} kg of lot ${lot.lotCode} is left to dispatch`)
    }

    let customerName = args.customerName?.trim() || undefined
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId)
      assertOwns(user, customer, 'Customer')
      if (customer.deletedAt) throw userError('NOT_FOUND', 'Customer not found')
      customerName = customer.name
    }
    if (!customerName) throw userError('VALIDATION', 'Select a customer or enter a buyer name')
    if (args.saleId) assertOwns(user, await ctx.db.get(args.saleId), 'Sale')

    // Fish leaving the farm are judged at their harvest date (PROD-012).
    const withdrawalOverride = await enforceWithdrawal(ctx, user, {
      cageId: lot.cageId,
      date: lot.harvestDate,
      action: 'dispatch',
      overrideReason: args.withdrawalOverrideReason,
      batchId: lot.batchId,
    })

    const id = await ctx.db.insert('dispatches', {
      companyId: lot.companyId,
      locationId: lot.locationId,
      harvestLotId: lot._id,
      customerId: args.customerId,
      customerName,
      saleId: args.saleId,
      dispatchDate: args.dispatchDate,
      weightKg,
      vehicle: args.vehicle?.trim() || undefined,
      driver: args.driver?.trim() || undefined,
      temperatureC: args.temperatureC,
      notes: args.notes?.trim() || undefined,
      withdrawalOverride,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'dispatches',
      recordId: id,
      newValues: { ...args, weightKg, customerName },
      locationId: lot.locationId,
    })
    return id
  },
})

export const removeDispatch = mutation({
  args: { id: v.id('dispatches') },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.records.delete' })
    const d = await ctx.db.get(id)
    assertOwns(user, d, 'Dispatch')
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'dispatches',
      recordId: id,
      previousValues: d,
      locationId: d.locationId,
    })
    return { ok: true }
  },
})

// ---------------------------------------------------------------------------
// Trace reads
// ---------------------------------------------------------------------------

function treatmentRow(t: Doc<'healthTreatments'> & { batchId: Id<'batches'> }, batchNumbers: Map<string, string>, cageNames: Map<string, string>) {
  return {
    id: t._id,
    date: t.date,
    batch_number: batchNumbers.get(String(t.batchId)) ?? '—',
    cage_name: cageNames.get(String(t.cageId)) ?? '—',
    diagnosis: t.diagnosis ?? null,
    treatment: t.treatment,
    product_name: t.productName ?? null,
    dosage: t.dosage ?? null,
    withdrawal_days: t.withdrawalDays ?? null,
    withdrawal_until: t.withdrawalUntil ?? null,
    administered_by: t.administeredBy ?? null,
  }
}

/** Origin journey, feed lots and treatments of a batch and its ancestors. */
async function traceBatch(ctx: QueryCtx, batch: Doc<'batches'>) {
  const chain = await batchWithAncestors(ctx, batch)
  const ids = chain.map((c) => c.batch._id)
  const { occupancies, events } = await occupanciesFor(ctx, ids)
  const batchNumbers = new Map(chain.map((c) => [String(c.batch._id), c.batch.batchNumber]))
  const cageNames = new Map<string, string>()
  for (const o of occupancies) {
    if (!cageNames.has(String(o.unitId))) cageNames.set(String(o.unitId), (await ctx.db.get(o.unitId))?.name ?? '—')
  }
  const treatments = await treatmentsDuring(ctx, occupancies)
  const feed = await feedLotsFor(ctx, occupancies)
  const roots = chain.filter((c) => !(c.batch.parentBatchIds ?? []).length)
  const origins = []
  for (const r of roots) {
    const s = r.batch.legacyStockingId ? await ctx.db.get(r.batch.legacyStockingId) : null
    origins.push({
      batch_id: r.batch._id,
      batch_number: r.batch.batchNumber,
      origin: r.batch.origin,
      species: r.batch.speciesCode ?? null,
      opened_on: r.batch.openedOn,
      source: s?.sourceLocation ?? null,
      source_cage: s?.sourceCage ?? null,
      stocked_count: s?.fishCount ?? null,
      initial_abw_g: s?.initialAbw ?? null,
    })
  }
  return {
    batches: chain.map((c) => ({ id: c.batch._id, batch_number: c.batch.batchNumber, depth: c.depth, status: c.batch.status })),
    origins,
    journey: await journeyOf(ctx, events),
    stays: occupancies.map((o) => ({
      batch_number: batchNumbers.get(String(o.batchId)) ?? '—',
      cage_id: o.unitId,
      cage_name: cageNames.get(String(o.unitId)) ?? '—',
      from: o.from,
      to: o.to,
    })),
    treatments: treatments.map((t) => treatmentRow(t, batchNumbers, cageNames)),
    feed: feed.map((f) => ({
      feed_type: f.feedTypeName,
      kg_fed: f.kgFed,
      first_fed: f.firstFed,
      last_fed: f.lastFed,
      lots: f.lots.map((l) => ({
        purchase_id: l.purchaseId,
        lot_number: l.lotNumber,
        received_on: l.receivedOn,
        quantity_kg: l.quantityKg,
        expiry_date: l.expiryDate,
        supplier: l.supplierName,
        po_number: l.poNumber,
      })),
    })),
  }
}

const treatmentRow3 = v.object({
  id: v.id('healthTreatments'),
  date: v.string(),
  product: v.string(),
  withdrawal_until: v.string(),
})

const batchRow = v.object({
  id: v.id('batches'),
  batch_number: v.string(),
  depth: v.number(),
  status: v.union(v.literal('active'), v.literal('closed')),
})

const stayRow = v.object({
  batch_number: v.string(),
  cage_id: v.id('cages'),
  cage_name: v.string(),
  from: v.string(),
  to: v.union(v.string(), v.null()),
})

const feedRow = v.object({
  feed_type: v.string(),
  kg_fed: v.number(),
  first_fed: v.string(),
  last_fed: v.string(),
  lots: v.array(
    v.object({
      purchase_id: v.id('feedPurchases'),
      lot_number: v.union(v.string(), v.null()),
      received_on: v.string(),
      quantity_kg: v.number(),
      expiry_date: v.union(v.string(), v.null()),
      supplier: v.union(v.string(), v.null()),
      po_number: v.union(v.string(), v.null()),
    }),
  ),
})

const treatmentRow2 = v.object({
  id: v.id('healthTreatments'),
  date: v.string(),
  batch_number: v.string(),
  cage_name: v.string(),
  diagnosis: v.union(v.string(), v.null()),
  treatment: v.string(),
  product_name: v.union(v.string(), v.null()),
  dosage: v.union(v.string(), v.null()),
  withdrawal_days: v.union(v.number(), v.null()),
  withdrawal_until: v.union(v.string(), v.null()),
  administered_by: v.union(v.string(), v.null()),
})

const journeyRow = v.object({
  date: v.string(),
  kind: v.union(
    v.literal('harvested'),
    v.literal('transfer_out'),
    v.literal('transfer_in'),
    v.literal('stocked'),
    v.literal('topped_up'),
    v.literal('graded'),
    v.literal('merged'),
  ),
  batchNumber: v.string(),
  cageName: v.string(),
  counterpartCage: v.union(v.string(), v.null()),
  counterpartBatch: v.union(v.string(), v.null()),
  qty: v.number(),
  kg: v.number(),
  source: v.union(v.string(), v.null()),
})

const originRow = v.object({
  batch_id: v.id('batches'),
  batch_number: v.string(),
  origin: v.union(
    v.literal('legacy'),
    v.literal('hatchery'),
    v.literal('merge'),
    v.literal('stocking'),
    v.literal('transfer_split'),
    v.literal('grading_split'),
  ),
  species: v.union(v.string(), v.null()),
  opened_on: v.string(),
  source: v.union(v.string(), v.null()),
  source_cage: v.union(v.string(), v.null()),
  stocked_count: v.union(v.number(), v.null()),
  initial_abw_g: v.union(v.number(), v.null()),
})

const dispatchRow2 = v.object({
  id: v.id('dispatches'),
  harvest_lot_id: v.id('harvestLots'),
  customer_id: v.union(v.id('customers'), v.null()),
  customer_name: v.union(v.string(), v.null()),
  sale_id: v.union(v.id('sales'), v.null()),
  dispatch_date: v.string(),
  weight_kg: v.number(),
  vehicle: v.union(v.string(), v.null()),
  driver: v.union(v.string(), v.null()),
  temperature_c: v.union(v.number(), v.null()),
  notes: v.union(v.string(), v.null()),
  withdrawal_override: v.union(v.object({ reason: v.string(), until: v.string() }), v.null()),
})

/** A batch's trace: where its fish came from, what they ate and were treated with, and where they went. */
export const batchTrace = query({
  args: { batchId: v.id('batches') },
  returns: v.union(
    v.object({
      lots: v.array(
        v.object({
          dispatches: v.array(dispatchRow2),
          id: v.id('harvestLots'),
          lot_code: v.string(),
          harvest_id: v.id('harvestRecords'),
          cage_id: v.id('cages'),
          batch_id: v.union(v.id('batches'), v.null()),
          harvest_date: v.string(),
          weight_kg: v.number(),
          fish_count: v.union(v.number(), v.null()),
          grade: v.union(v.string(), v.null()),
          destination: v.union(v.string(), v.null()),
          notes: v.union(v.string(), v.null()),
          dispatched_kg: v.number(),
          remaining_kg: v.number(),
          created_at: v.number(),
        }),
      ),
      batches: v.array(batchRow),
      origins: v.array(originRow),
      journey: v.array(journeyRow),
      stays: v.array(stayRow),
      treatments: v.array(treatmentRow2),
      feed: v.array(feedRow),
    }),
    v.null(),
  ),
  handler: async (ctx, { batchId }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const batch = await ctx.db.get(batchId)
    if (!batch || !(await listForCompany(user, [batch])).length) return null
    const trace = await traceBatch(ctx, batch)
    const lots = await ctx.db
      .query('harvestLots')
      .withIndex('by_batchId', (q) => q.eq('batchId', batchId))
      .take(LOT_LIMIT)
    const lotRows = []
    for (const l of lots) {
      const ds = await dispatchesOf(ctx, l._id)
      lotRows.push({ ...lotRow(l, ds.reduce((s, d) => s + d.weightKg, 0)), dispatches: ds.map(dispatchRow) })
    }
    return { ...trace, lots: lotRows.sort((a, b) => a.harvest_date.localeCompare(b.harvest_date)) }
  },
})

/** Treatment history of a batch and its ancestors (TRACE-003). */
export const batchTreatments = query({
  args: { batchId: v.id('batches') },
  returns: v.union(v.array(treatmentRow2), v.null()),
  handler: async (ctx, { batchId }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const batch = await ctx.db.get(batchId)
    if (!batch || !(await listForCompany(user, [batch])).length) return null
    const chain = await batchWithAncestors(ctx, batch)
    const { occupancies } = await occupanciesFor(ctx, chain.map((c) => c.batch._id))
    const batchNumbers = new Map(chain.map((c) => [String(c.batch._id), c.batch.batchNumber]))
    const cageNames = new Map<string, string>()
    const rows = await treatmentsDuring(ctx, occupancies)
    for (const t of rows) {
      if (!cageNames.has(String(t.cageId))) cageNames.set(String(t.cageId), (await ctx.db.get(t.cageId))?.name ?? '—')
    }
    return rows.map((t) => treatmentRow(t, batchNumbers, cageNames))
  },
})

type Withdrawal = { id: Id<'healthTreatments'>; date: string; product: string; withdrawal_until: string }

/** Whether a withdrawal period blocks a harvest or sale from a cage on a date (for forms). */
export const withdrawalStatus = query({
  args: { cageId: v.id('cages'), date: v.string() },
  returns: v.union(
    v.object({ blocked: v.literal(false), until: v.null(), treatments: v.array(treatmentRow3) }),
    v.object({ blocked: v.literal(true), until: v.string(), treatments: v.array(treatmentRow3) }),
    v.null(),
  ),
  handler: async (ctx, { cageId, date }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(cageId)
    if (!cage || !(await listForCompany(user, [cage])).length || !DATE_RE.test(date)) return null
    const rows = await blockingTreatments(ctx, cageId, date)
    if (!rows.length) return { blocked: false as const, until: null, treatments: [] as Withdrawal[] }
    return {
      blocked: true as const,
      until: rows.reduce((m, t) => (t.withdrawalUntil! > m ? t.withdrawalUntil! : m), ''),
      treatments: rows.map((t) => ({
        id: t._id,
        date: t.date,
        product: t.productName || t.treatment,
        withdrawal_until: t.withdrawalUntil!,
      })),
    }
  },
})

/** Everything a buyer-facing trace report for one harvest lot needs (TRACE-004). */
export const lotReport = query({
  args: { lotId: v.id('harvestLots') },
  returns: v.union(
    v.object({
      company: v.string(),
      site: v.union(v.string(), v.null()),
      lot: v.object({
        id: v.id('harvestLots'),
        lot_code: v.string(),
        harvest_id: v.id('harvestRecords'),
        cage_id: v.id('cages'),
        batch_id: v.union(v.id('batches'), v.null()),
        harvest_date: v.string(),
        weight_kg: v.number(),
        fish_count: v.union(v.number(), v.null()),
        grade: v.union(v.string(), v.null()),
        destination: v.union(v.string(), v.null()),
        notes: v.union(v.string(), v.null()),
        dispatched_kg: v.number(),
        remaining_kg: v.number(),
        created_at: v.number(),
      }),
      cage_name: v.string(),
      harvest: v.union(
        v.object({
          id: v.id('harvestRecords'),
          date: v.string(),
          type: v.union(v.literal('partial'), v.literal('complete')),
          total_weight_kg: v.number(),
          fish_count: v.number(),
          abw_g: v.number(),
          withdrawal_override: v.union(
            v.object({ reason: v.string(), until: v.string() }),
            v.null(),
          ),
        }),
        v.null(),
      ),
      batch: v.union(
        v.object({
          id: v.id('batches'),
          batch_number: v.string(),
          species: v.union(v.string(), v.null()),
          origin: v.union(
            v.literal('legacy'),
            v.literal('hatchery'),
            v.literal('merge'),
            v.literal('stocking'),
            v.literal('transfer_split'),
            v.literal('grading_split'),
          ),
        }),
        v.null(),
      ),
      withdrawal_clear_at_harvest: v.boolean(),
      trace: v.union(
        v.object({
          batches: v.array(batchRow),
          origins: v.array(originRow),
          journey: v.array(journeyRow),
          stays: v.array(stayRow),
          treatments: v.array(treatmentRow2),
          feed: v.array(feedRow),
        }),
        v.null(),
      ),
      dispatches: v.array(dispatchRow2),
    }),
    v.null(),
  ),
  handler: async (ctx, { lotId }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const lot = await ctx.db.get(lotId)
    if (!lot || !(await listForCompany(user, [lot])).length) return null
    const [harvest, cage, company, site] = await Promise.all([
      ctx.db.get(lot.harvestId),
      ctx.db.get(lot.cageId),
      ctx.db.get(lot.companyId),
      lot.locationId ? ctx.db.get(lot.locationId) : Promise.resolve(null),
    ])
    const batch = lot.batchId ? await ctx.db.get(lot.batchId) : null
    const trace = batch ? await traceBatch(ctx, batch) : null
    const ds = await dispatchesOf(ctx, lot._id)
    // Withdrawal status at harvest: anything still running then, and any override.
    const atHarvest = await blockingTreatments(ctx, lot.cageId, lot.harvestDate, lot.batchId)
    return {
      company: company?.name ?? '',
      site: site?.name ?? null,
      lot: lotRow(lot, ds.reduce((s, d) => s + d.weightKg, 0)),
      cage_name: cage?.name ?? '—',
      harvest: harvest
        ? {
            id: harvest._id,
            date: harvest.harvestDate,
            type: harvest.harvestType ?? 'complete',
            total_weight_kg: harvest.totalWeight,
            fish_count: harvest.estimatedCount,
            abw_g: harvest.averageBodyWeight,
            withdrawal_override: harvest.withdrawalOverride
              ? { reason: harvest.withdrawalOverride.reason, until: harvest.withdrawalOverride.until }
              : null,
          }
        : null,
      batch: batch
        ? { id: batch._id, batch_number: batch.batchNumber, species: batch.speciesCode ?? null, origin: batch.origin }
        : null,
      withdrawal_clear_at_harvest: atHarvest.length === 0,
      trace,
      dispatches: ds.map(dispatchRow),
    }
  },
})
