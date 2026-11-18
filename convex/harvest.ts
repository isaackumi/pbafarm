import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireUser, requireRole } from './lib/authz'
import { assertOwns, listForCompany, listForCompanyAndLocation, writeCompanyId, logAudit } from './lib/tenancy'
import { mergeSettings, harvestWarnings } from './lib/farmRules'
import { harvestFcr } from './lib/growth'
import { harvestIsCurrent } from './lib/cycles'

function toClientHarvestRecord(r: any) {
  return {
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

function toClientHarvestSampling(s: any) {
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

export const list = query({
  args: {
    cageId: v.optional(v.id('cages')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let records = args.cageId
      ? await ctx.db
          .query('harvestRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await ctx.db.query('harvestRecords').collect()

    records = await listForCompanyAndLocation(user, records, args.locationId)
    if (args.dateFrom) records = records.filter((r) => r.harvestDate >= args.dateFrom!)
    if (args.dateTo) records = records.filter((r) => r.harvestDate <= args.dateTo!)
    const cageIds = [...new Set(records.map((r) => r.cageId))]
    const cages = new Map(
      await Promise.all(cageIds.map(async (id) => [id, await ctx.db.get(id)] as const)),
    )
    return records
      .map((r) => {
        const cage = cages.get(r.cageId)
        const cageInfo = { name: cage?.name ?? 'Unknown cage', code: cage?.code ?? '' }
        return { ...toClientHarvestRecord(r), cages: cageInfo, cage: cageInfo }
      })
      .sort((a, b) => b.harvest_date.localeCompare(a.harvest_date))
  },
})

export const get = query({
  args: { id: v.id('harvestRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
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

/** FCR for a planned harvest, from feed logged since stocking. */
export const suggestFcr = query({
  args: {
    cageId: v.id('cages'),
    harvestDate: v.string(),
    totalWeight: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null
    return await harvestFcr(ctx, cage, args.harvestDate, args.totalWeight)
  },
})

export const create = mutation({
  args: {
    cageId: v.id('cages'),
    harvestDate: v.string(),
    averageBodyWeight: v.number(),
    totalWeight: v.number(),
    estimatedCount: v.number(),
    fcr: v.number(),
    sizeBreakdown: v.optional(v.any()),
    notes: v.optional(v.string()),
    harvestType: v.optional(v.union(v.literal('complete'), v.literal('partial'))),
    status: v.optional(v.union(v.literal('completed'), v.literal('in_progress'))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')

    const companyId = (await writeCompanyId(user)) ?? cage.companyId
    const company = companyId ? await ctx.db.get(companyId) : null
    const rules = mergeSettings(company?.settings)
    let docDays: number | null = null
    if (cage.stockingDate && args.harvestDate) {
      docDays = Math.floor(
        (new Date(args.harvestDate).getTime() -
          new Date(cage.stockingDate).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    }
    const warnings = harvestWarnings({
      docDays,
      abw: args.averageBodyWeight,
      fcr: args.fcr,
      farmRules: rules.farmRules,
    })

    const cageEffect = await applyHarvestToCage(ctx, args.cageId, args, warnings)

    const id = await ctx.db.insert('harvestRecords', {
      ...args,
      cageEffect,
      locationId: cage.locationId,
      companyId,
      createdBy: user._id,
    })

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
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Harvest record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    // Changing the type or fish count re-posts the harvest against the cage.
    const warnings: string[] = []
    const cageTouched =
      (patch.harvestType !== undefined && patch.harvestType !== existing.harvestType) ||
      (patch.estimatedCount !== undefined && patch.estimatedCount !== existing.estimatedCount)
    // Re-posting fish counts is a stock correction (doc 07 V9): admin only.
    if (cageTouched) requireRole(user, 'admin')
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

    await ctx.db.patch(id, { ...patch, cageEffect })
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
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
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
    if (current) await undoHarvestOnCage(ctx, existing.cageId, existing.cageEffect)
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'harvestRecords',
      recordId: id,
      previousValues: existing,
    })
    return { ok: true }
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
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
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
   * Interim (doc 09 S12, OPEN-QUESTIONS Q-005): this used to insert a complete
   * harvest with a made-up FCR of 1.5 and no effect on the cage, which
   * double-counted harvest kg once the real harvest was recorded. Until the
   * owner says whether the page records harvests or pre-harvest samples, it
   * only stores a sampling row. `harvestType` and `notes` are accepted for
   * older clients and ignored.
   */
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')

    const companyId = (await writeCompanyId(user)) ?? cage.companyId
    const abw =
      args.abw ??
      (args.fishCount > 0 ? args.weight / args.fishCount : 0)

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
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
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
      : await ctx.db.query('harvestSampling').collect()

    samples = await listForCompany(user, samples)
    return samples.map(toClientHarvestSampling)
  },
})