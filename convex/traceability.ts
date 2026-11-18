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

/** A batch's trace: where its fish came from, what they ate and were treated with, and where they went. */
export const batchTrace = query({
  args: { batchId: v.id('batches') },
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

/** Whether a withdrawal period blocks a harvest or sale from a cage on a date (for forms). */
export const withdrawalStatus = query({
  args: { cageId: v.id('cages'), date: v.string() },
  handler: async (ctx, { cageId, date }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(cageId)
    if (!cage || !(await listForCompany(user, [cage])).length || !DATE_RE.test(date)) return null
    const rows = await blockingTreatments(ctx, cageId, date)
    if (!rows.length) return { blocked: false as const, until: null, treatments: [] }
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
