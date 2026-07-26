import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { listForCompany, logAudit } from './lib/tenancy'
import { applyStockChange, bagsFromKg } from './lib/feedLedger'

function toClientTransaction(t: any) {
  return {
    id: t._id,
    _id: t._id,
    feed_type_id: t.feedTypeId,
    transaction_type: t.transactionType,
    quantity_kg: t.quantityKg,
    bags: t.bags,
    transaction_date: t.transactionDate,
    reference_id: t.referenceId,
    notes: t.notes,
    company_id: t.companyId,
    created_by: t.createdBy,
    created_at: t._creationTime,
  }
}

function toClientStockLevel(s: any) {
  return {
    feed_type_id: s.feedTypeId,
    feed_type_name: s.feedTypeName,
    current_stock: s.currentStock,
    current_stock_bags: s.currentStockBags,
    bag_size_kg: s.bagSizeKg,
    minimum_stock: s.minimumStock,
    price_per_kg: s.pricePerKg,
    supplier_name: s.supplierName,
    active: s.active,
    stock_value: s.stockValue,
    is_low_stock: s.isLowStock,
  }
}

function toClientAlert(a: any) {
  return {
    feed_type_id: a.feedTypeId,
    feed_type_name: a.feedTypeName,
    current_stock: a.currentStock,
    minimum_stock: a.minimumStock,
    shortage: a.shortage,
    supplier_name: a.supplierName,
  }
}

export const listStockLevels = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let feedTypes = await ctx.db.query('feedTypes').collect()
    feedTypes = await listForCompany(user, feedTypes)

    if (!args.includeInactive) {
      feedTypes = feedTypes.filter((f) => f.active && !f.deletedAt)
    }

    const stockLevels = []
    for (const feedType of feedTypes) {
      let supplierName = null
      if (feedType.supplierId) {
        const supplier = await ctx.db.get(feedType.supplierId)
        supplierName = supplier?.name || null
      }
      const bagSize = feedType.bagSizeKg && feedType.bagSizeKg > 0 ? feedType.bagSizeKg : 25

      stockLevels.push({
        feedTypeId: feedType._id,
        feedTypeName: feedType.name,
        currentStock: feedType.currentStock,
        currentStockBags: bagsFromKg(feedType.currentStock, bagSize),
        bagSizeKg: bagSize,
        minimumStock: feedType.minimumStock,
        pricePerKg: feedType.pricePerKg,
        supplierName,
        active: feedType.active,
        stockValue: feedType.currentStock * feedType.pricePerKg,
        isLowStock: feedType.currentStock <= feedType.minimumStock,
      })
    }

    return stockLevels
      .map(toClientStockLevel)
      .sort((a, b) => a.feed_type_name.localeCompare(b.feed_type_name))
  },
})

export const listTransactions = query({
  args: {
    feedTypeId: v.optional(v.id('feedTypes')),
    transactionType: v.optional(
      v.union(
        v.literal('purchase'),
        v.literal('usage'),
        v.literal('issue'),
        v.literal('daily_usage'),
        v.literal('adjustment'),
        v.literal('transfer'),
        v.literal('reversal'),
      ),
    ),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let transactions = args.feedTypeId
      ? await ctx.db
          .query('feedInventoryTransactions')
          .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId!))
          .collect()
      : await ctx.db.query('feedInventoryTransactions').collect()

    transactions = await listForCompany(user, transactions)

    if (args.transactionType) {
      transactions = transactions.filter((t) => t.transactionType === args.transactionType)
    }
    if (args.dateFrom) {
      transactions = transactions.filter((t) => t.transactionDate >= args.dateFrom!)
    }
    if (args.dateTo) {
      transactions = transactions.filter((t) => t.transactionDate <= args.dateTo!)
    }

    transactions = transactions.sort((a, b) => b.transactionDate - a.transactionDate)

    if (args.limit) {
      transactions = transactions.slice(0, args.limit)
    }

    return transactions.map(toClientTransaction)
  },
})

export const createAdjustment = mutation({
  args: {
    feedTypeId: v.id('feedTypes'),
    quantityKg: v.number(),
    bags: v.optional(v.number()),
    notes: v.string(),
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!args.notes.trim()) throw new Error('Adjustment reason is required')

    const feedType = await ctx.db.get(args.feedTypeId)
    if (!feedType) throw new Error('Feed type not found')
    const allowed = await listForCompany(user, [feedType])
    if (!allowed.length) throw new Error('Access denied')

    const { transactionId, previousStock, nextStock } = await applyStockChange(ctx, {
      user,
      feedTypeId: args.feedTypeId,
      deltaKg: args.quantityKg,
      bags: args.bags,
      transactionType: 'adjustment',
      notes: args.notes,
      allowNegative: args.allowNegative,
      overrideReason: args.overrideReason,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'feedInventoryTransactions',
      recordId: transactionId,
      newValues: {
        ...args,
        oldStock: previousStock,
        newStock: nextStock,
      },
    })

    return transactionId
  },
})

export const listAlerts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    let feedTypes = await ctx.db.query('feedTypes').collect()
    feedTypes = await listForCompany(user, feedTypes)

    const lowStockFeedTypes = feedTypes.filter(
      (f) => f.active && !f.deletedAt && f.currentStock <= f.minimumStock,
    )

    const alerts = []
    for (const feedType of lowStockFeedTypes) {
      let supplierName = null
      if (feedType.supplierId) {
        const supplier = await ctx.db.get(feedType.supplierId)
        supplierName = supplier?.name || null
      }

      alerts.push({
        feedTypeId: feedType._id,
        feedTypeName: feedType.name,
        currentStock: feedType.currentStock,
        minimumStock: feedType.minimumStock,
        shortage: feedType.minimumStock - feedType.currentStock,
        supplierName,
      })
    }

    return alerts.map(toClientAlert).sort((a, b) => b.shortage - a.shortage)
  },
})

/** Tally check: currentStock vs sum of ledger quantities. */
export const stockTally = query({
  args: { feedTypeId: v.optional(v.id('feedTypes')) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let feedTypes = await ctx.db.query('feedTypes').collect()
    feedTypes = await listForCompany(user, feedTypes)
    if (args.feedTypeId) {
      feedTypes = feedTypes.filter((f) => f._id === args.feedTypeId)
    }

    const rows = []
    for (const feedType of feedTypes) {
      if (feedType.deletedAt) continue
      const txns = await ctx.db
        .query('feedInventoryTransactions')
        .withIndex('by_feed_type', (q) => q.eq('feedTypeId', feedType._id))
        .collect()
      const ledgerSum = txns.reduce((s, t) => s + t.quantityKg, 0)
      rows.push({
        feed_type_id: feedType._id,
        feed_type_name: feedType.name,
        current_stock: feedType.currentStock,
        ledger_sum: ledgerSum,
        delta: Math.round((feedType.currentStock - ledgerSum) * 1000) / 1000,
        ok: Math.abs(feedType.currentStock - ledgerSum) < 0.001,
      })
    }
    return rows
  },
})
