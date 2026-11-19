import { v } from 'convex/values'
import { paginationResultValidator, paginationOptsValidator } from 'convex/server'
import { query, mutation } from './_generated/server'
import { idempotentMutation } from './lib/idempotency'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, listForCompany, listForCompanyAndLocation, writeCompanyId, logAudit } from './lib/tenancy'
import { mergeSettings, harvestWarnings } from './lib/farmRules'
import { harvestFcr, daysBetween } from './lib/growth'
import { harvestIsCurrent } from './lib/cycles'
import { beginStockWrite, previewHarvestFcr, shadowHarvest, storeHarvestFcr } from './lib/productionDualWrite'
import { scopedPageInRange, scopedRows, scopedRowsInRange } from './lib/scope'
import { assertUserCan, requireMember } from './lib/permissions'
import { validateCustom } from './lib/customFields'
import { customValues } from './schema'
import { enforceWithdrawal } from './lib/traceability'

/** Client rows with the cage name/code (one `get` per distinct cage). */
async function withCages(ctx: QueryCtx, records: Doc<'harvestRecords'>[]) {
  const cageIds = [...new Set(records.map((r) => r.cageId))]
  const cages = new Map(
    await Promise.all(cageIds.map(async (id) => [id, await ctx.db.get(id)] as const)),
  )
  return records.map((r) => {
    const cage = cages.get(r.cageId)
    const cageInfo = { name: cage?.name ?? 'Unknown cage', code: cage?.code ?? '' }
    return { ...toClientHarvestRecord(r), cages: cageInfo, cage: cageInfo }
  })
}

function toClientHarvestRecord(r: Doc<'harvestRecords'>) {
  return {
    custom: r.custom ?? {},
    id: r._id,
    _id: r._id,
    cage_id: r.cageId,
    harvest_date: r.harvestDate,
    average_body_weight: r.averageBodyWeight,
    total_weight: r.totalWeight,
    estimated_count: r.estimatedCount,
    fcr: r.fcr,
    size_breakdown: r.sizeBreakdown,
    notes: r.notes,
    harvest_type: r.harvestType,
    source: r.source ?? null,
    status: r.status,
    company_id: r.companyId,
    created_by: r.createdBy,
    created_at: r._creationTime,
  }
}

function toClientHarvestSampling(s: Doc<'harvestSampling'>) {
  return {
    id: s._id,
    _id: s._id,
    harvest_id: s.harvestId,
    cage_id: s.cageId,
    date: s.date,
    weight: s.weight,
    fish_count: s.fishCount,
    crate_size: s.crateSize,
    samples: s.samples,
    size_breakdown: s.sizeBreakdown,
    doc: s.doc,
    abw: s.abw,
    company_id: s.companyId,
    created_by: s.createdBy,
    created_at: s._creationTime,
  }
}

const listItem = v.object({
  cages: v.object({ name: v.string(), code: v.string() }),
  cage: v.object({ name: v.string(), code: v.string() }),
  custom: v.record(v.string(), v.any()),
  id: v.id('harvestRecords'),
  _id: v.id('harvestRecords'),
  cage_id: v.id('cages'),
  harvest_date: v.string(),
  average_body_weight: v.number(),
  total_weight: v.number(),
  estimated_count: v.number(),
  fcr: v.number(),
  size_breakdown: v.optional(v.any()),
  notes: v.optional(v.string()),
  harvest_type: v.optional(v.union(v.literal('partial'), v.literal('complete'))),
  source: v.union(v.string(), v.null()),
  status: v.optional(v.union(v.literal('completed'), v.literal('in_progress'))),
  company_id: v.optional(v.id('companies')),
  created_by: v.optional(v.id('users')),
  created_at: v.number(),
})

export const list = query({
  args: {
    cageId: v.optional(v.id('cages')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.array(listItem),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    let records = args.cageId
      ? await ctx.db
          .query('harvestRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRowsInRange(ctx, user, 'harvestRecords', {
          from: args.dateFrom,
          to: args.dateTo,
          locationId: args.locationId,
        })

    records = await listForCompanyAndLocation(user, records, args.locationId)
    if (args.dateFrom) records = records.filter((r) => r.harvestDate >= args.dateFrom!)
    if (args.dateTo) records = records.filter((r) => r.harvestDate <= args.dateTo!)
    return (await withCages(ctx, records)).sort((a, b) =>
      b.harvest_date.localeCompare(a.harvest_date),
    )
  },
})

/**
 * Paginated harvests, newest harvest date first (PLAT-001), via
 * `by_company_and_harvestDate`. A site filter is applied per page.
 */
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: paginationResultValidator(listItem),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const result = await scopedPageInRange(ctx, user, 'harvestRecords', args.paginationOpts, {
      from: args.dateFrom,
      to: args.dateTo,
    })
    const rows = args.locationId
      ? result.page.filter((r) => r.locationId === args.locationId)
      : result.page
    return { ...result, page: await withCages(ctx, rows) }
  },
})

export const get = query({
  args: { id: v.id('harvestRecords') },
  returns: v.union(
    v.object({
      custom: v.record(v.string(), v.any()),
      id: v.id('harvestRecords'),
      _id: v.id('harvestRecords'),
      cage_id: v.id('cages'),
      harvest_date: v.string(),
      average_body_weight: v.number(),
      total_weight: v.number(),
      estimated_count: v.number(),
      fcr: v.number(),
      size_breakdown: v.optional(v.any()),
      notes: v.optional(v.string()),
      harvest_type: v.optional(v.union(v.literal('partial'), v.literal('complete'))),
      source: v.union(v.string(), v.null()),
      status: v.optional(v.union(v.literal('completed'), v.literal('in_progress'))),
      company_id: v.optional(v.id('companies')),
      created_by: v.optional(v.id('users')),
      created_at: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const record = await ctx.db.get(id)
    if (!record) return null
    const allowed = await listForCompany(user, [record])
    if (!allowed.length) return null
    return toClientHarvestRecord(record)
  },
})

type CageEffect = {
  fishRemoved: number
  countBefore?: number
  statusBefore?: string
  closedStockingId?: Id<'stockingHistory'>
}

/**
 * Take harvested fish off the cage. A complete harvest empties the cage, marks
 * it harvested and closes its open stocking cycle; a partial one subtracts the
 * fish taken. Returns what changed so it can be undone later.
 */
async function applyHarvestToCage(
  ctx: MutationCtx,
  cageId: Id<'cages'>,
  harvest: { harvestType?: string; estimatedCount: number; harvestDate: string },
  warnings: string[],
): Promise<CageEffect | undefined> {
  const cage = await ctx.db.get(cageId)
  if (!cage) return undefined
  const before = cage.currentCount
  const taken = Math.max(0, Math.round(harvest.estimatedCount || 0))

  if (harvest.harvestType === 'partial') {
    if (before != null && taken > before) {
      warnings.push(
        `Harvest count ${taken.toLocaleString()} is more than the ${before.toLocaleString()} fish on record for ${cage.name}. Cage count set to 0`,
      )
    }
    const next = before != null ? Math.max(0, before - taken) : undefined
    await ctx.db.patch(cageId, {
      ...(next !== undefined ? { currentCount: next } : {}),
      updatedAt: Date.now(),
    })
    return { fishRemoved: before != null ? before - (next ?? 0) : taken, countBefore: before }
  }

  // Complete harvest: the cycle is over.
  if (before != null && before !== taken) {
    const gap = before - taken
    warnings.push(
      gap > 0
        ? `${gap.toLocaleString()} fish on record for ${cage.name} were not in the harvest count (loss, escape or count drift)`
        : `Harvest count is ${Math.abs(gap).toLocaleString()} more than the fish on record for ${cage.name}`,
    )
  }
  const stockings = await ctx.db
    .query('stockingHistory')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .collect()
  const open = stockings
    .filter(
      (s) =>
        s.status === 'approved' &&
        !s.deletedAt &&
        !s.closedAt &&
        s.stockingDate <= harvest.harvestDate,
    )
    .sort((a, b) => b.stockingDate.localeCompare(a.stockingDate))[0]
  if (open) await ctx.db.patch(open._id, { closedAt: harvest.harvestDate })

  await ctx.db.patch(cageId, {
    currentCount: 0,
    status: 'harvested',
    updatedAt: Date.now(),
  })
  return {
    fishRemoved: before ?? taken,
    countBefore: before,
    statusBefore: cage.status,
    closedStockingId: open?._id,
  }
}

/** Reverse applyHarvestToCage (used when a harvest is edited or deleted). */
async function undoHarvestOnCage(
  ctx: MutationCtx,
  cageId: Id<'cages'>,
  effect: CageEffect | undefined,
) {
  if (!effect) return
  const cage = await ctx.db.get(cageId)
  if (!cage) return
  const patch: Record<string, unknown> = { updatedAt: Date.now() }
  if (effect.statusBefore !== undefined) {
    // Only reopen the cage if nothing else has happened to it since.
    // Only reopen the cage (and its cycle) if nothing else has happened to it since.
    if (cage.status !== 'harvested') return
    patch.status = effect.statusBefore
    if (effect.countBefore !== undefined) patch.currentCount = effect.countBefore
    if (effect.closedStockingId) {
      const st = await ctx.db.get(effect.closedStockingId)
      if (st) await ctx.db.patch(effect.closedStockingId, { closedAt: undefined })
    }
  } else if (cage.currentCount != null) {
    patch.currentCount = cage.currentCount + effect.fishRemoved
  }
  await ctx.db.patch(cageId, patch as any)
}

/**
 * FCR a harvest would be saved with (PROD-009): from the stock ledger when the
 * cage has one, else from feed logged since stocking. Read-only in the form.
 */
export const suggestFcr = query({
  args: {
    cageId: v.id('cages'),
    harvestDate: v.string(),
    totalWeight: v.number(),
    estimatedCount: v.optional(v.number()),
    harvestType: v.optional(v.union(v.literal('complete'), v.literal('partial'))),
  },
  returns: v.union(
    v.object({
      fcr: v.union(v.number(), v.null()),
      feed_kg: v.number(),
      gain_kg: v.optional(v.number()),
      method: v.optional(v.union(v.literal('complete'), v.literal('interim'))),
      source: v.optional(v.union(v.literal('ledger'), v.literal('legacy'))),
      stocked_biomass_kg: v.union(v.number(), v.null()),
      stocking_date: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(args.cageId)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null
    const ledger = await previewHarvestFcr(ctx, {
      cageId: args.cageId,
      harvestDate: args.harvestDate,
      totalWeight: args.totalWeight,
      estimatedCount: args.estimatedCount ?? 0,
      harvestType: args.harvestType ?? 'complete',
    })
    if (ledger) {
      return {
        fcr: ledger.fcr,
        feed_kg: ledger.feedKg,
        gain_kg: ledger.gainKg,
        method: ledger.method,
        source: 'ledger' as const,
        stocked_biomass_kg: ledger.stockedBiomassKg,
        stocking_date: ledger.openedOn ?? cage.stockingDate ?? '',
      }
    }
    const legacy = await harvestFcr(ctx, cage, args.harvestDate, args.totalWeight)
    return legacy ? { ...legacy, source: 'legacy' as const } : null
  },
})

/** Accepts `clientMutationId` so outbox retries never write twice (MOBILE-002). */
export const create = idempotentMutation('harvest.create', {
  args: {
    cageId: v.id('cages'),
    harvestDate: v.string(),
    averageBodyWeight: v.number(),
    totalWeight: v.number(),
    estimatedCount: v.number(),
    /**
     * Ignored when the ledger can compute the FCR (PROD-009); kept optional
     * for older clients and cages with no stocking on record.
     */
    fcr: v.optional(v.number()),
    sizeBreakdown: v.optional(v.any()),
    notes: v.optional(v.string()),
    harvestType: v.optional(v.union(v.literal('complete'), v.literal('partial'))),
    status: v.optional(v.union(v.literal('completed'), v.literal('in_progress'))),
    /** Admin only: harvest inside a treatment withdrawal period (PROD-012). */
    withdrawalOverrideReason: v.optional(v.string()),
    custom: v.optional(customValues),
  },
  handler: async (ctx, { withdrawalOverrideReason, custom: rawCustom, ...args }) => {
    const { user } = await requireMember(ctx, { permission: 'production.harvest.record' })
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')
    const custom = await validateCustom(ctx, {
      companyId: cage.companyId,
      entity: 'harvestRecords',
      custom: rawCustom,
      mode: 'create',
      context: { locationId: cage.locationId, core: args },
    })
    const withdrawalOverride = await enforceWithdrawal(ctx, user, {
      cageId: args.cageId,
      date: args.harvestDate,
      action: 'harvest',
      overrideReason: withdrawalOverrideReason,
    })

    const companyId = (await writeCompanyId(user)) ?? cage.companyId
    const company = companyId ? await ctx.db.get(companyId) : null
    const rules = mergeSettings(company?.settings)
    let docDays: number | null = null
    if (cage.stockingDate && args.harvestDate) {
      docDays = daysBetween(cage.stockingDate, args.harvestDate)
    }
    const warnings = harvestWarnings({
      docDays,
      abw: args.averageBodyWeight,
      farmRules: rules.farmRules,
    })

    const write = await beginStockWrite(ctx, [cage], user._id)
    const cageEffect = await applyHarvestToCage(ctx, args.cageId, args, warnings)

    const id = await ctx.db.insert('harvestRecords', {
      ...args,
      fcr: args.fcr ?? 0,
      custom,
      cageEffect,
      withdrawalOverride,
      locationId: cage.locationId,
      companyId,
      createdBy: user._id,
    })
    // Ledger warnings go to reconciliation, not to the person saving.
    const inserted = (await ctx.db.get(id))!
    await write.post((o) => shadowHarvest(ctx, inserted, user._id, 'create', o))
    const fcr = (await ctx.db.get(id))!.fcr
    warnings.push(...harvestWarnings({ fcr: fcr || null, farmRules: rules.farmRules }))

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'harvestRecords',
      recordId: id,
      newValues: args,
      locationId: cage.locationId,
    })
    return { id, warnings }
  },
})

export const update = mutation({
  args: {
    id: v.id('harvestRecords'),
    patch: v.object({
      harvestDate: v.optional(v.string()),
      averageBodyWeight: v.optional(v.number()),
      totalWeight: v.optional(v.number()),
      estimatedCount: v.optional(v.number()),
      fcr: v.optional(v.number()),
      sizeBreakdown: v.optional(v.any()),
      notes: v.optional(v.string()),
      harvestType: v.optional(v.union(v.literal('complete'), v.literal('partial'))),
      status: v.optional(v.union(v.literal('completed'), v.literal('in_progress'))),
      custom: v.optional(customValues),
    }),
    withdrawalOverrideReason: v.optional(v.string()),
  },
  returns: v.object({ id: v.id('harvestRecords'), warnings: v.array(v.string()) }),
  handler: async (ctx, { id, patch: rawPatch, withdrawalOverrideReason }) => {
    const { user } = await requireMember(ctx, { permission: 'production.harvest.correct' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Harvest record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    const patch = { ...rawPatch }
    if (patch.custom !== undefined) {
      patch.custom = await validateCustom(ctx, {
        companyId: existing.companyId,
        entity: 'harvestRecords',
        custom: patch.custom,
        previous: existing.custom,
        mode: 'update',
        context: { locationId: existing.locationId, core: { ...existing, ...rawPatch } },
      })
    }
    // Moving the harvest date is a new harvest date for withdrawal (PROD-012).
    let withdrawalOverride = existing.withdrawalOverride
    if (patch.harvestDate !== undefined && patch.harvestDate !== existing.harvestDate) {
      withdrawalOverride =
        (await enforceWithdrawal(ctx, user, {
          cageId: existing.cageId,
          date: patch.harvestDate,
          action: 'harvest',
          overrideReason: withdrawalOverrideReason,
          batchId: existing.batchId,
        })) ?? undefined
    }

    // Changing the type or fish count re-posts the harvest against the cage.
    const warnings: string[] = []
    const cageTouched =
      (patch.harvestType !== undefined && patch.harvestType !== existing.harvestType) ||
      (patch.estimatedCount !== undefined && patch.estimatedCount !== existing.estimatedCount)
    // Re-posting fish counts is a stock correction (doc 07 V9).
    if (cageTouched) await assertUserCan(ctx, user, 'production.stock.adjust')
    let cageEffect = existing.cageEffect
    // Once the cage has moved on (restocked, or harvested again), this harvest
    // belongs to a closed cycle: correct the record, leave the live cage alone.
    const current = cageTouched
      ? await harvestIsCurrent(ctx, existing, existing.cageEffect?.closedStockingId)
      : false
    if (cageTouched && !current) {
      warnings.push(
        'The cage has been restocked or harvested again since this harvest, so its current fish count was not changed',
      )
    }
    const ledgerTouched = (['harvestDate', 'estimatedCount', 'harvestType', 'totalWeight', 'averageBodyWeight'] as const).some(
      (k) => patch[k] !== undefined && patch[k] !== existing[k],
    )
    const write = ledgerTouched ? await beginStockWrite(ctx, [await ctx.db.get(existing.cageId)], user._id) : null
    if (cageTouched && current) {
      await undoHarvestOnCage(ctx, existing.cageId, existing.cageEffect)
      cageEffect = await applyHarvestToCage(
        ctx,
        existing.cageId,
        {
          harvestType: patch.harvestType ?? existing.harvestType,
          estimatedCount: patch.estimatedCount ?? existing.estimatedCount,
          harvestDate: patch.harvestDate ?? existing.harvestDate,
        },
        warnings,
      )
    }

    await ctx.db.patch(id, { ...patch, cageEffect, withdrawalOverride })
    if (write) {
      const updated = (await ctx.db.get(id))!
      await write.post((o) => shadowHarvest(ctx, updated, user._id, 'update', o))
    }
    // The stored FCR is the computed one, whatever an older client typed.
    await storeHarvestFcr(ctx, id)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'harvestRecords',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return { id, warnings }
  },
})

export const remove = mutation({
  args: { id: v.id('harvestRecords') },
  returns: v.object({ ok: v.boolean(), warnings: v.array(v.string()) }),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.records.delete' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Harvest record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    const samples = await ctx.db
      .query('harvestSampling')
      .withIndex('by_harvest', (q) => q.eq('harvestId', id))
      .collect()
    for (const s of samples) {
      await ctx.db.delete(s._id)
    }
    // Put the fish back and reopen the cage if this harvest emptied it, unless
    // the cage has since moved on to a new cycle.
    const current = await harvestIsCurrent(ctx, existing, existing.cageEffect?.closedStockingId)
    const warnings: string[] = []
    const write = await beginStockWrite(ctx, [await ctx.db.get(existing.cageId)], user._id)
    if (current) {
      await undoHarvestOnCage(ctx, existing.cageId, existing.cageEffect)
    } else if (existing.cageEffect) {
      warnings.push(
        'The cage has been restocked or harvested again since this harvest, so its current fish count was not changed',
      )
    }
    await write.post((o) => shadowHarvest(ctx, existing, user._id, 'remove', o))
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'harvestRecords',
      recordId: id,
      previousValues: existing,
    })
    return { ok: true, warnings }
  },
})

export const createSampling = mutation({
  args: {
    harvestId: v.id('harvestRecords'),
    cageId: v.optional(v.id('cages')),
    date: v.optional(v.string()),
    weight: v.optional(v.number()),
    fishCount: v.optional(v.number()),
    crateSize: v.optional(v.number()),
    samples: v.any(),
    sizeBreakdown: v.optional(v.any()),
    doc: v.optional(v.number()),
    abw: v.optional(v.number()),
  },
  returns: v.id('harvestSampling'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.harvest.record' })
    const harvest = await ctx.db.get(args.harvestId)
    if (!harvest) throw new Error('Harvest record not found')

    const allowed = await listForCompany(user, [harvest])
    if (!allowed.length) throw new Error('Access denied')
    if (args.cageId) {
      assertOwns(user, await ctx.db.get(args.cageId), 'Cage')
    }

    const id = await ctx.db.insert('harvestSampling', {
      ...args,
      cageId: args.cageId ?? harvest.cageId,
      locationId: harvest.locationId,
      companyId: (await writeCompanyId(user)) ?? harvest.companyId,
      createdBy: user._id,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'harvestSampling',
      recordId: id,
      newValues: args,
    })
    return id
  },
})

export const createFromSampling = mutation({
  args: {
    cageId: v.id('cages'),
    date: v.string(),
    weight: v.number(),
    fishCount: v.number(),
    sizes: v.any(),
    doc: v.optional(v.number()),
    abw: v.optional(v.number()),
    harvestType: v.optional(v.union(v.literal('complete'), v.literal('partial'))),
    notes: v.optional(v.string()),
  },
  /**
   * A pre-harvest sample, not a harvest (doc 09 S12, PROD-000g; Q-005 assumed
   * answer 2026-11-18). It used to insert a complete harvest with a made-up
   * FCR of 1.5 and no effect on the cage, which double-counted harvest kg once
   * the real harvest was recorded. It now stores only a sampling row; the
   * fish count and FCR are untouched. ABW is in grams like every other ABW in
   * the app, worked out from weight (kg) and count; a client `abw` is only
   * used when there is no count. `harvestType` and `notes` are accepted for
   * older clients and ignored.
   */
  returns: v.object({ harvestId: v.null(), samplingId: v.id('harvestSampling') }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.harvest.record' })
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')

    const companyId = (await writeCompanyId(user)) ?? cage.companyId
    const abw =
      args.fishCount > 0 && args.weight > 0
        ? Math.round(((args.weight * 1000) / args.fishCount) * 100) / 100
        : (args.abw ?? 0)

    const samplingId = await ctx.db.insert('harvestSampling', {
      cageId: args.cageId,
      date: args.date,
      weight: args.weight,
      fishCount: args.fishCount,
      samples: args.sizes,
      sizeBreakdown: args.sizes,
      doc: args.doc,
      abw,
      locationId: cage.locationId,
      companyId,
      createdBy: user._id,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'harvestSampling',
      recordId: samplingId,
      newValues: args,
      locationId: cage.locationId,
    })

    return { harvestId: null, samplingId }
  },
})

export const listSampling = query({
  args: {
    harvestId: v.optional(v.id('harvestRecords')),
    cageId: v.optional(v.id('cages')),
  },
  returns: v.array(
    v.object({
      id: v.id('harvestSampling'),
      _id: v.id('harvestSampling'),
      harvest_id: v.optional(v.id('harvestRecords')),
      cage_id: v.optional(v.id('cages')),
      date: v.optional(v.string()),
      weight: v.optional(v.number()),
      fish_count: v.optional(v.number()),
      crate_size: v.optional(v.number()),
      samples: v.optional(v.any()),
      size_breakdown: v.optional(v.any()),
      doc: v.optional(v.number()),
      abw: v.optional(v.number()),
      company_id: v.optional(v.id('companies')),
      created_by: v.optional(v.id('users')),
      created_at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    let samples = args.harvestId
      ? await ctx.db
          .query('harvestSampling')
          .withIndex('by_harvest', (q) => q.eq('harvestId', args.harvestId!))
          .collect()
      : args.cageId
      ? await ctx.db
          .query('harvestSampling')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRows(ctx, user, 'harvestSampling')


    samples = await listForCompany(user, samples)
    return samples.map(toClientHarvestSampling)
  },
})