import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'

function toClient(r: any) {
  return {
    id: r._id,
    _id: r._id,
    cage_id: r.cageId,
    date: r.date,
    batch_code: r.batchCode,
    average_body_weight: r.averageBodyWeight,
    total_fish_count: r.totalFishCount,
    total_weight: r.totalWeight,
    company_id: r.companyId,
    created_by: r.createdBy,
    updated_by: r.updatedBy,
    updated_at: r.updatedAt,
    created_at: r._creationTime,
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
    let rows = args.cageId
      ? await ctx.db
          .query('biweeklyRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await ctx.db.query('biweeklyRecords').collect()

    rows = await listForCompany(user, rows)
    if (args.dateFrom) rows = rows.filter((r) => r.date >= args.dateFrom!)
    if (args.dateTo) rows = rows.filter((r) => r.date <= args.dateTo!)
    return rows.map(toClient).sort((a, b) => b.date.localeCompare(a.date))
  },
})

export const get = query({
  args: { id: v.id('biweeklyRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const record = await ctx.db.get(id)
    if (!record) return null
    const allowed = await listForCompany(user, [record])
    if (!allowed.length) return null
    return toClient(record)
  },
})

export const create = mutation({
  args: {
    cageId: v.id('cages'),
    date: v.string(),
    batchCode: v.string(),
    averageBodyWeight: v.number(),
    totalFishCount: v.number(),
    totalWeight: v.number(),
    samples: v.optional(
      v.array(
        v.object({
          samplingNumber: v.number(),
          fishCount: v.number(),
          totalWeight: v.number(),
          averageBodyWeight: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    if (!cage) throw new Error('Cage not found')

    // Check for unique batch code
    const existing = await ctx.db
      .query('biweeklyRecords')
      .withIndex('by_batch_code', (q) => q.eq('batchCode', args.batchCode))
      .first()
    if (existing) throw new Error('Batch code already exists')

    const now = Date.now()
    const { samples, ...recordData } = args

    const id = await ctx.db.insert('biweeklyRecords', {
      ...recordData,
      companyId: (await writeCompanyId(user)) ?? cage.companyId,
      createdBy: user._id,
      updatedAt: now,
    })

    // Create sampling records if provided
    if (samples && samples.length > 0) {
      for (const sample of samples) {
        await ctx.db.insert('biweeklySampling', {
          biweeklyRecordId: id,
          samplingNumber: sample.samplingNumber,
          fishCount: sample.fishCount,
          totalWeight: sample.totalWeight,
          averageBodyWeight: sample.averageBodyWeight,
          createdBy: user._id,
          updatedAt: now,
        })
      }
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'biweeklyRecords',
      recordId: id,
      newValues: args,
    })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('biweeklyRecords'),
    patch: v.object({
      date: v.optional(v.string()),
      batchCode: v.optional(v.string()),
      averageBodyWeight: v.optional(v.number()),
      totalFishCount: v.optional(v.number()),
      totalWeight: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Biweekly record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    // Check batch code uniqueness if being updated
    if (patch.batchCode && patch.batchCode !== existing.batchCode) {
      const existingBatch = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_batch_code', (q) => q.eq('batchCode', patch.batchCode!))
        .first()
      if (existingBatch && existingBatch._id !== id) {
        throw new Error('Batch code already exists')
      }
    }

    await ctx.db.patch(id, {
      ...patch,
      updatedBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'biweeklyRecords',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

export const remove = mutation({
  args: { id: v.id('biweeklyRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Biweekly record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    // Delete associated sampling records
    const samples = await ctx.db
      .query('biweeklySampling')
      .withIndex('by_record', (q) => q.eq('biweeklyRecordId', id))
      .collect()
    for (const sample of samples) {
      await ctx.db.delete(sample._id)
    }

    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'biweeklyRecords',
      recordId: id,
      previousValues: existing,
    })
  },
})