import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'
import { applyStockChange, bagsFromKg } from './lib/feedLedger'

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

async function deductDailyFeed(
  ctx: any,
  user: any,
  args: {
    dailyRecordId: string
    feedTypeId: any
    cageId: any
    feedAmount: number
    date: string
    allowNegative?: boolean
    overrideReason?: string
  },
) {
  if (!args.feedTypeId || !(args.feedAmount > 0)) return

  const feedType = await ctx.db.get(args.feedTypeId)
  if (!feedType) throw new Error('Feed type not found')

  const bags = bagsFromKg(args.feedAmount, feedType.bagSizeKg)
  const usageId = await ctx.db.insert('feedUsage', {
    feedTypeId: args.feedTypeId,
    cageId: args.cageId,
    quantity: args.feedAmount,
    bags,
    usageDate: args.date,
    source: 'daily',
    notes: `Daily record ${args.date}`,
    companyId: feedType.companyId ?? user.companyId,
    updatedAt: Date.now(),
  })

  await applyStockChange(ctx, {
    user,
    feedTypeId: args.feedTypeId,
    deltaKg: -args.feedAmount,
    bags,
    transactionType: 'daily_usage',
    referenceId: String(args.dailyRecordId),
    notes: `Daily feed ${args.date} (usage ${usageId})`,
    allowNegative: args.allowNegative,
    overrideReason: args.overrideReason,
  })
}

async function reverseDailyFeed(ctx: any, user: any, dailyRecord: any) {
  if (!dailyRecord.feedTypeId || !(dailyRecord.feedAmount > 0)) return

  const ref = String(dailyRecord._id)
  const prior = await ctx.db
    .query('feedInventoryTransactions')
    .withIndex('by_reference', (q: any) => q.eq('referenceId', ref))
    .collect()

  const alreadyReversed = prior.some((t: any) => t.transactionType === 'reversal')
  const originals = prior.filter(
    (t: any) => t.transactionType === 'daily_usage' || t.transactionType === 'usage',
  )
  if (alreadyReversed || !originals.length) {
    // Fallback: restore by amount if no ledger row (legacy records)
    if (!originals.length) {
      await applyStockChange(ctx, {
        user,
        feedTypeId: dailyRecord.feedTypeId,
        deltaKg: dailyRecord.feedAmount,
        transactionType: 'reversal',
        referenceId: ref,
        notes: 'Reversal of daily feed (legacy)',
      })
    }
    return
  }

  for (const txn of originals) {
    await applyStockChange(ctx, {
      user,
      feedTypeId: dailyRecord.feedTypeId,
      deltaKg: -txn.quantityKg,
      bags: txn.bags,
      transactionType: 'reversal',
      referenceId: ref,
      notes: `Reversal of txn ${txn._id}`,
    })
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
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    if (!cage) throw new Error('Cage not found')

    if (args.feedAmount > 0 && !args.feedTypeId) {
      throw new Error('feedTypeId is required when feedAmount > 0')
    }

    const existing = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) =>
        q.eq('cageId', args.cageId).eq('date', args.date),
      )
      .first()
    if (existing) throw new Error('Daily record already exists for this cage and date')

    const id = await ctx.db.insert('dailyRecords', {
      cageId: args.cageId,
      date: args.date,
      feedAmount: args.feedAmount,
      feedTypeId: args.feedTypeId,
      feedType: args.feedType,
      feedPrice: args.feedPrice,
      feedCost: args.feedCost,
      mortality: args.mortality,
      notes: args.notes,
      companyId: (await writeCompanyId(user)) ?? cage.companyId,
      createdBy: user._id,
    })

    if (args.mortality && cage.currentCount != null) {
      await ctx.db.patch(args.cageId, {
        currentCount: Math.max(0, cage.currentCount - args.mortality),
        updatedAt: Date.now(),
      })
    }

    await deductDailyFeed(ctx, user, {
      dailyRecordId: id,
      feedTypeId: args.feedTypeId,
      cageId: args.cageId,
      feedAmount: args.feedAmount,
      date: args.date,
      allowNegative: args.allowNegative,
      overrideReason: args.overrideReason,
    })

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
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, { id, patch, allowNegative, overrideReason }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Daily record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    const feedTouched =
      patch.feedAmount !== undefined ||
      patch.feedTypeId !== undefined ||
      patch.date !== undefined

    if (feedTouched) {
      await reverseDailyFeed(ctx, user, existing)
    }

    await ctx.db.patch(id, patch)

    if (feedTouched) {
      const updated = await ctx.db.get(id)
      if (!updated) throw new Error('Daily record missing after update')
      if (updated.feedAmount > 0 && !updated.feedTypeId) {
        throw new Error('feedTypeId is required when feedAmount > 0')
      }
      await deductDailyFeed(ctx, user, {
        dailyRecordId: id,
        feedTypeId: updated.feedTypeId,
        cageId: updated.cageId,
        feedAmount: updated.feedAmount,
        date: updated.date,
        allowNegative,
        overrideReason,
      })
    }

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

    await reverseDailyFeed(ctx, user, existing)
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
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, { records, allowNegative, overrideReason }) => {
    const user = await requireUser(ctx)
    const ids = []
    for (const record of records) {
      if (record.feedAmount > 0 && !record.feedTypeId) {
        throw new Error(
          `feedTypeId is required when feedAmount > 0 (${record.date})`,
        )
      }
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

      if (record.mortality && cage.currentCount != null) {
        await ctx.db.patch(record.cageId, {
          currentCount: Math.max(0, cage.currentCount - record.mortality),
          updatedAt: Date.now(),
        })
      }

      await deductDailyFeed(ctx, user, {
        dailyRecordId: id,
        feedTypeId: record.feedTypeId,
        cageId: record.cageId,
        feedAmount: record.feedAmount,
        date: record.date,
        allowNegative,
        overrideReason,
      })
      ids.push(id)
    }
    return ids
  },
})
