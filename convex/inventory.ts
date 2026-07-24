import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'

function toClientTransaction(t: any) {
  return {
    id: t._id,
    _id: t._id,
    feed_type_id: t.feedTypeId,
    transaction_type: t.transactionType,
    quantity_kg: t.quantityKg,
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
      // Get supplier info if available
      let supplierName = null
      if (feedType.supplierId) {
        const supplier = await ctx.db.get(feedType.supplierId)
        supplierName = supplier?.name || null
      }

      const stockLevel = {
        feedTypeId: feedType._id,
        feedTypeName: feedType.name,
        currentStock: feedType.currentStock,
        minimumStock: feedType.minimumStock,
        pricePerKg: feedType.pricePerKg,
        supplierName,
        active: feedType.active,
        stockValue: feedType.currentStock * feedType.pricePerKg,
        isLowStock: feedType.currentStock <= feedType.minimumStock,
      }
      stockLevels.push(stockLevel)
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
        v.literal('adjustment'),
        v.literal('transfer'),
      )
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

    // Apply filters
    if (args.transactionType) {
      transactions = transactions.filter((t) => t.transactionType === args.transactionType)
    }
    if (args.dateFrom) {
      transactions = transactions.filter((t) => t.transactionDate >= args.dateFrom!)
    }
    if (args.dateTo) {
      transactions = transactions.filter((t) => t.transactionDate <= args.dateTo!)
    }

    // Sort by date descending and apply limit
    transactions = transactions
      .sort((a, b) => b.transactionDate - a.transactionDate)
    
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
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const feedType = await ctx.db.get(args.feedTypeId)
    if (!feedType) throw new Error('Feed type not found')

    const allowed = await listForCompany(user, [feedType])
    if (!allowed.length) throw new Error('Access denied')

    const now = Date.now()

    // Create the transaction record
    const transactionId = await ctx.db.insert('feedInventoryTransactions', {
      feedTypeId: args.feedTypeId,
      transactionType: 'adjustment',
      quantityKg: args.quantityKg,
      transactionDate: now,
      notes: args.notes || 'Manual stock adjustment',
      companyId: feedType.companyId,
      createdBy: user._id,
    })

    // Update feed type stock
    const newStock = Math.max(0, feedType.currentStock + args.quantityKg)
    await ctx.db.patch(args.feedTypeId, {
      currentStock: newStock,
      updatedAt: now,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'feedInventoryTransactions',
      recordId: transactionId,
      newValues: {
        ...args,
        oldStock: feedType.currentStock,
        newStock,
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
    
    // Filter to only active feed types that are low on stock
    const lowStockFeedTypes = feedTypes.filter(
      (f) => f.active && !f.deletedAt && f.currentStock <= f.minimumStock
    )

    const alerts = []
    for (const feedType of lowStockFeedTypes) {
      // Get supplier info if available
      let supplierName = null
      if (feedType.supplierId) {
        const supplier = await ctx.db.get(feedType.supplierId)
        supplierName = supplier?.name || null
      }

      const alert = {
        feedTypeId: feedType._id,
        feedTypeName: feedType.name,
        currentStock: feedType.currentStock,
        minimumStock: feedType.minimumStock,
        shortage: feedType.minimumStock - feedType.currentStock,
        supplierName,
      }
      alerts.push(alert)
    }

    return alerts
      .map(toClientAlert)
      .sort((a, b) => b.shortage - a.shortage) // Sort by shortage descending (most critical first)
  },
})