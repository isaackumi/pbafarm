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
    feed_amount: r.feedAmount,
    feed_type_id: r.feedTypeId,
    feed_type: r.feedType,
    feed_price: r.feedPrice,
    feed_cost: r.feedCost,
    mortality: r.mortality,
    notes: r.notes,
    created_by: r.createdBy,
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
          .query('dailyRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await ctx.db.query('dailyRecords').collect()

    rows = await listForCompany(user, rows)
    if (args.dateFrom) rows = rows.filter((r) => r.date >= args.dateFrom!)
    if (args.dateTo) rows = rows.filter((r) => r.date <= args.dateTo!)
    return rows.map(toClient).sort((a, b) => b.date.localeCompare(a.date))
  },
})

export const get = query({
  args: { id: v.id('dailyRecords') },
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
    feedAmount: v.number(),
    feedTypeId: v.optional(v.id('feedTypes')),
    feedType: v.optional(v.string()),
    feedPrice: v.number(),
    feedCost: v.number(),
    mortality: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    if (!cage) throw new Error('Cage not found')

    const existing = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) =>
        q.eq('cageId', args.cageId).eq('date', args.date),
      )
      .first()
    if (existing) throw new Error('Daily record already exists for this cage and date')

    const id = await ctx.db.insert('dailyRecords', {
      ...args,
      companyId: (await writeCompanyId(user)) ?? cage.companyId,
      createdBy: user._id,
    })

    if (args.mortality && cage.currentCount != null) {
      await ctx.db.patch(args.cageId, {
        currentCount: Math.max(0, cage.currentCount - args.mortality),
        updatedAt: Date.now(),
      })
    }

    if (args.feedTypeId && args.feedAmount > 0) {
      const feedType = await ctx.db.get(args.feedTypeId)
      if (feedType) {
        await ctx.db.patch(args.feedTypeId, {
          currentStock: Math.max(0, feedType.currentStock - args.feedAmount),
          updatedAt: Date.now(),
        })
        await ctx.db.insert('feedUsage', {
          feedTypeId: args.feedTypeId,
          cageId: args.cageId,
          quantity: args.feedAmount,
          usageDate: args.date,
          companyId: feedType.companyId,
          updatedAt: Date.now(),
        })
      }
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'daily_records',
      recordId: id,
      newValues: args,
    })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('dailyRecords'),
    patch: v.object({
      date: v.optional(v.string()),
      feedAmount: v.optional(v.number()),
      feedTypeId: v.optional(v.id('feedTypes')),
      feedType: v.optional(v.string()),
      feedPrice: v.optional(v.number()),
      feedCost: v.optional(v.number()),
      mortality: v.optional(v.number()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Daily record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    await ctx.db.patch(id, patch)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'daily_records',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

export const remove = mutation({
  args: { id: v.id('dailyRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Daily record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'daily_records',
      recordId: id,
      previousValues: existing,
    })
  },
})

export const createMany = mutation({
  args: {
    records: v.array(
      v.object({
        cageId: v.id('cages'),
        date: v.string(),
        feedAmount: v.number(),
        feedTypeId: v.optional(v.id('feedTypes')),
        feedType: v.optional(v.string()),
        feedPrice: v.number(),
        feedCost: v.number(),
        mortality: v.number(),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { records }) => {
    const user = await requireUser(ctx)
    const ids = []
    for (const record of records) {
      const cage = await ctx.db.get(record.cageId)
      if (!cage) continue
      const existing = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) =>
          q.eq('cageId', record.cageId).eq('date', record.date),
        )
        .first()
      if (existing) continue

      const id = await ctx.db.insert('dailyRecords', {
        ...record,
        companyId: (await writeCompanyId(user)) ?? cage.companyId,
        createdBy: user._id,
      })
      ids.push(id)
    }
    return ids
  },
})
