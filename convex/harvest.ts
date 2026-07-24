import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'

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
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let records = args.cageId
      ? await ctx.db
          .query('harvestRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await ctx.db.query('harvestRecords').collect()

    records = await listForCompany(user, records)
    if (args.dateFrom) records = records.filter((r) => r.harvestDate >= args.dateFrom!)
    if (args.dateTo) records = records.filter((r) => r.harvestDate <= args.dateTo!)
    return records.map(toClientHarvestRecord).sort((a, b) => b.harvest_date.localeCompare(a.harvest_date))
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
    if (!cage) throw new Error('Cage not found')

    const id = await ctx.db.insert('harvestRecords', {
      ...args,
      companyId: (await writeCompanyId(user)) ?? cage.companyId,
      createdBy: user._id,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'harvestRecords',
      recordId: id,
      newValues: args,
    })
    return id
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

    await ctx.db.patch(id, patch)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'harvestRecords',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
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

    const id = await ctx.db.insert('harvestSampling', {
      ...args,
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
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    if (!cage) throw new Error('Cage not found')

    const companyId = (await writeCompanyId(user)) ?? cage.companyId
    const abw =
      args.abw ??
      (args.fishCount > 0 ? args.weight / args.fishCount : 0)

    const fcr = 1.5

    const harvestId = await ctx.db.insert('harvestRecords', {
      cageId: args.cageId,
      harvestDate: args.date,
      averageBodyWeight: abw,
      totalWeight: args.weight,
      estimatedCount: args.fishCount,
      fcr: fcr,
      sizeBreakdown: args.sizes,
      notes: args.notes,
      harvestType: args.harvestType ?? 'complete',
      status: 'completed',
      companyId,
      createdBy: user._id,
    })

    const samplingId = await ctx.db.insert('harvestSampling', {
      harvestId,
      cageId: args.cageId,
      date: args.date,
      weight: args.weight,
      fishCount: args.fishCount,
      samples: args.sizes,
      sizeBreakdown: args.sizes,
      doc: args.doc,
      abw,
      companyId,
      createdBy: user._id,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'harvestRecords',
      recordId: harvestId,
      newValues: { harvestId, samplingId, ...args },
    })

    return { harvestId, samplingId }
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