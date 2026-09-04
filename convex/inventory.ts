import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { listForCompany, listForCompanyAndLocation, logAudit } from './lib/tenancy'
import {
  applyStockChange,
  bagsFromKg,
  addInventoryLot,
  deductInventoryLots,
} from './lib/feedLedger'
import { mergeSettings } from './lib/farmRules'

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

function toClientLot(lot: any, feedTypeName?: string) {
  return {
    id: lot._id,
    _id: lot._id,
    feed_type_id: lot.feedTypeId,
    feed_type_name: feedTypeName || null,
    quantity_kg: lot.quantityKg,
    batch_number: lot.batchNumber || null,
    expiry_date: lot.expiryDate || null,
    location: lot.location || 'Main store',
    company_id: lot.companyId,
    updated_at: lot.updatedAt,
    created_at: lot._creationTime,
  }
}

export const listStockLevels = query({
  args: {
    includeInactive: v.optional(v.boolean()),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let feedTypes =
      user.companyId && user.role !== 'super_admin'
        ? await ctx.db
            .query('feedTypes')
            .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
            .collect()
        : await ctx.db.query('feedTypes').collect()
    feedTypes = await listForCompany(user, feedTypes)

    const company = user.companyId ? await ctx.db.get(user.companyId) : null
    const feedRules = mergeSettings(company?.settings).feedRules
    const multiplier = feedRules.lowStockMultiplier || 1

    if (!args.includeInactive) {
      feedTypes = feedTypes.filter((f) => f.active && !f.deletedAt)
    }

    let lots: any[] = []
    if (args.locationId) {
      lots = await ctx.db
        .query('feedInventory')
        .withIndex('by_location', (q) => q.eq('locationId', args.locationId!))
        .collect()
      lots = await listForCompany(user, lots)
    }

    const stockLevels = []
    for (const feedType of feedTypes) {
      let supplierName = null
      if (feedType.supplierId) {
        const supplier = await ctx.db.get(feedType.supplierId)
        supplierName = supplier?.name || null
      }
      const bagSize =
        feedType.bagSizeKg && feedType.bagSizeKg > 0
          ? feedType.bagSizeKg
          : feedRules.defaultBagSizeKg

      let currentStock = feedType.currentStock
      if (args.locationId) {
        currentStock = lots
          .filter((l) => l.feedTypeId === feedType._id)
          .reduce((sum, l) => sum + (l.quantityKg || 0), 0)
        // Fallback: sum location-scoped transactions when lots empty
        if (currentStock === 0 && lots.length === 0) {
          const txns = await ctx.db
            .query('feedInventoryTransactions')
            .withIndex('by_feed_type', (q) => q.eq('feedTypeId', feedType._id))
            .collect()
          currentStock = txns
            .filter((t) => t.locationId === args.locationId)
            .reduce((sum, t) => sum + (t.quantityKg || 0), 0)
        }
      }

      const threshold = feedType.minimumStock * multiplier
      stockLevels.push({
        feedTypeId: feedType._id,
        feedTypeName: feedType.name,
        currentStock,
        currentStockBags: bagsFromKg(currentStock, bagSize),
        bagSizeKg: bagSize,
        minimumStock: feedType.minimumStock,
        pricePerKg: feedType.pricePerKg,
        supplierName,
        active: feedType.active,
        stockValue: currentStock * feedType.pricePerKg,
        isLowStock: currentStock <= threshold,
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
    const maxRows = Math.min(args.limit ?? 200, 500)

    let transactions = args.feedTypeId
      ? await ctx.db
          .query('feedInventoryTransactions')
          .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId!))
          .order('desc')
          .take(maxRows * 2)
      : user.companyId && user.role !== 'super_admin'
        ? await ctx.db
            .query('feedInventoryTransactions')
            .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
            .order('desc')
            .take(maxRows * 2)
        : await ctx.db
            .query('feedInventoryTransactions')
            .order('desc')
            .take(maxRows * 2)

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

    return transactions
      .sort((a, b) => b.transactionDate - a.transactionDate)
      .slice(0, maxRows)
      .map(toClientTransaction)
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
    location: v.optional(v.string()),
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
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
      location: args.location,
      batchNumber: args.batchNumber,
      expiryDate: args.expiryDate,
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

/** Move stock between locations without changing on-hand total. */
export const createTransfer = mutation({
  args: {
    feedTypeId: v.id('feedTypes'),
    quantityKg: v.number(),
    fromLocation: v.string(),
    toLocation: v.string(),
    notes: v.optional(v.string()),
    batchNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!(args.quantityKg > 0)) throw new Error('Transfer quantity must be positive')
    const from = args.fromLocation.trim()
    const to = args.toLocation.trim()
    if (!from || !to) throw new Error('From and to locations are required')
    if (from === to) throw new Error('Locations must differ')

    const feedType = await ctx.db.get(args.feedTypeId)
    if (!feedType || feedType.deletedAt) throw new Error('Feed type not found')
    const allowed = await listForCompany(user, [feedType])
    if (!allowed.length) throw new Error('Access denied')

    await deductInventoryLots(ctx, {
      feedTypeId: args.feedTypeId,
      quantityKg: args.quantityKg,
      location: from,
    })
    await addInventoryLot(ctx, {
      feedTypeId: args.feedTypeId,
      quantityKg: args.quantityKg,
      companyId: feedType.companyId ?? user.companyId,
      batchNumber: args.batchNumber,
      location: to,
    })

    const now = Date.now()
    const transactionId = await ctx.db.insert('feedInventoryTransactions', {
      feedTypeId: args.feedTypeId,
      transactionType: 'transfer',
      quantityKg: args.quantityKg,
      bags: bagsFromKg(args.quantityKg, feedType.bagSizeKg),
      transactionDate: now,
      notes:
        args.notes ||
        `Transfer ${args.quantityKg} kg from ${from} → ${to}`,
      companyId: feedType.companyId ?? user.companyId,
      createdBy: user._id,
    })

    await logAudit(ctx, {
      actionType: 'transfer',
      tableName: 'feedInventory',
      recordId: transactionId,
      newValues: args,
    })

    return transactionId
  },
})

/** Reverse a ledger transaction (creates compensating reversal). */
export const reverseTransaction = mutation({
  args: {
    transactionId: v.id('feedInventoryTransactions'),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!args.reason.trim()) throw new Error('Reversal reason is required')

    const txn = await ctx.db.get(args.transactionId)
    if (!txn) throw new Error('Transaction not found')
    const allowed = await listForCompany(user, [txn])
    if (!allowed.length) throw new Error('Access denied')
    if (txn.transactionType === 'reversal') {
      throw new Error('Cannot reverse a reversal')
    }
    if (txn.transactionType === 'transfer') {
      throw new Error('Transfer reversals are not supported yet — reverse with an adjustment')
    }

    const { transactionId, previousStock, nextStock } = await applyStockChange(ctx, {
      user,
      feedTypeId: txn.feedTypeId,
      deltaKg: -txn.quantityKg,
      transactionType: 'reversal',
      referenceId: String(args.transactionId),
      notes: `Reversal of ${args.transactionId}: ${args.reason}`,
      allowNegative: true,
      overrideReason: args.reason,
    })

    await logAudit(ctx, {
      actionType: 'reversal',
      tableName: 'feedInventoryTransactions',
      recordId: transactionId,
      previousValues: txn,
      newValues: { reversed: args.transactionId, reason: args.reason, previousStock, nextStock },
    })

    return transactionId
  },
})

export const listLots = query({
  args: {
    feedTypeId: v.optional(v.id('feedTypes')),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let lots = args.feedTypeId
      ? await ctx.db
          .query('feedInventory')
          .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId!))
          .collect()
      : user.companyId && user.role !== 'super_admin'
        ? await ctx.db
            .query('feedInventory')
            .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
            .collect()
        : await ctx.db.query('feedInventory').collect()
    lots = await listForCompanyAndLocation(user, lots, args.locationId)
    lots = lots.filter((lot) => lot.quantityKg > 0)

    const names = new Map<string, string>()
    const out = []
    for (const lot of lots) {
      if (!names.has(lot.feedTypeId)) {
        const ft = await ctx.db.get(lot.feedTypeId)
        names.set(lot.feedTypeId, ft?.name || '—')
      }
      out.push(toClientLot(lot, names.get(lot.feedTypeId)))
    }

    return out.sort((a, b) => {
      const byType = (a.feed_type_name || '').localeCompare(b.feed_type_name || '')
      if (byType) return byType
      return (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999')
    })
  },
})

export const listAlerts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    let feedTypes = await ctx.db.query('feedTypes').collect()
    feedTypes = await listForCompany(user, feedTypes)

    const company = user.companyId ? await ctx.db.get(user.companyId) : null
    const multiplier = mergeSettings(company?.settings).feedRules.lowStockMultiplier || 1

    const lowStockFeedTypes = feedTypes.filter(
      (f) =>
        f.active &&
        !f.deletedAt &&
        f.currentStock <= f.minimumStock * multiplier,
    )

    const alerts = []
    for (const feedType of lowStockFeedTypes) {
      let supplierName = null
      if (feedType.supplierId) {
        const supplier = await ctx.db.get(feedType.supplierId)
        supplierName = supplier?.name || null
      }

      const threshold = feedType.minimumStock * multiplier
      alerts.push({
        feedTypeId: feedType._id,
        feedTypeName: feedType.name,
        currentStock: feedType.currentStock,
        minimumStock: feedType.minimumStock,
        shortage: threshold - feedType.currentStock,
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
      const ledgerSum = txns
        .filter((t) => t.transactionType !== 'transfer')
        .reduce((s, t) => s + t.quantityKg, 0)

      const lots = await ctx.db
        .query('feedInventory')
        .withIndex('by_feed_type', (q) => q.eq('feedTypeId', feedType._id))
        .collect()
      const lotsSum = lots.reduce((s, l) => s + l.quantityKg, 0)

      rows.push({
        feed_type_id: feedType._id,
        feed_type_name: feedType.name,
        current_stock: feedType.currentStock,
        ledger_sum: ledgerSum,
        lots_sum: lotsSum,
        delta: Math.round((feedType.currentStock - ledgerSum) * 1000) / 1000,
        ok: Math.abs(feedType.currentStock - ledgerSum) < 0.001,
      })
    }
    return rows
  },
})
