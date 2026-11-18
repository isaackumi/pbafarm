import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { scopedRows } from './lib/scope'
import {
  assertOwns,
  listForCompany,
  listForCompanyAndLocation,
  logAudit,
  writeLocationId,
} from './lib/tenancy'
import { applyStockChange, bagsFromKg, siteStock, transferFeedStock } from './lib/feedLedger'
import { mergeSettings } from './lib/farmRules'
import { requireMember } from './lib/permissions'

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
    transfer_id: t.transferId ?? null,
    batch_number: t.batchNumber ?? null,
    expiry_date: t.expiryDate ?? null,
    location_id: t.locationId ?? null,
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
    location_id: lot.locationId || null,
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
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    let feedTypes =
      user.companyId && user.role !== 'super_admin'
        ? await ctx.db
            .query('feedTypes')
            .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
            .collect()
        : await scopedRows(ctx, user, 'feedTypes')
    feedTypes = await listForCompany(user, feedTypes)

    const company = user.companyId ? await ctx.db.get(user.companyId) : null
    const feedRules = mergeSettings(company?.settings).feedRules
    const multiplier = feedRules.lowStockMultiplier || 1

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
      const bagSize =
        feedType.bagSizeKg && feedType.bagSizeKg > 0
          ? feedType.bagSizeKg
          : feedRules.defaultBagSizeKg

      let currentStock = feedType.currentStock
      if (args.locationId) {
        // Same rule the ledger enforces: the site's lots plus unassigned stock.
        currentStock = (await siteStock(ctx, feedType, args.locationId)).available
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
        v.literal('transfer_out'),
        v.literal('transfer_in'),
      ),
    ),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    limit: v.optional(v.number()),
    /** Only this site's movements (FARM-003). */
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
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

    if (args.locationId) {
      transactions = transactions.filter((t) => t.locationId === args.locationId)
    }
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
    /** Site of the adjustment (INV-002); defaults to the caller's active site. */
    locationId: v.optional(v.id('farmLocations')),
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
  },
  returns: v.id('feedInventoryTransactions'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    if (!args.notes.trim()) throw new Error('Adjustment reason is required')

    const feedType = await ctx.db.get(args.feedTypeId)
    if (!feedType) throw new Error('Feed type not found')
    const allowed = await listForCompany(user, [feedType])
    if (!allowed.length) throw new Error('Access denied')
    const locationId = await writeLocationId(ctx, user, args.locationId)
    const site = locationId ? await ctx.db.get(locationId) : null

    const { transactionId, previousStock, nextStock } = await applyStockChange(ctx, {
      user,
      feedTypeId: args.feedTypeId,
      deltaKg: args.quantityKg,
      bags: args.bags,
      transactionType: 'adjustment',
      notes: args.notes,
      allowNegative: args.allowNegative,
      overrideReason: args.overrideReason,
      location: args.location || site?.name,
      locationId,
      batchNumber: args.batchNumber,
      expiryDate: args.expiryDate,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'feedInventoryTransactions',
      recordId: transactionId,
      newValues: {
        ...args,
        locationId,
        oldStock: previousStock,
        newStock: nextStock,
      },
      locationId,
    })

    return transactionId
  },
})

/**
 * Move stock between farm locations (or legacy store labels) without changing
 * the company total. Two ledger rows (INV-002); returns the transfer_in row.
 */
export const createTransfer = mutation({
  args: {
    feedTypeId: v.id('feedTypes'),
    quantityKg: v.number(),
    fromLocation: v.optional(v.string()),
    toLocation: v.optional(v.string()),
    fromLocationId: v.optional(v.id('farmLocations')),
    toLocationId: v.optional(v.id('farmLocations')),
    notes: v.optional(v.string()),
    batchNumber: v.optional(v.string()),
  },
  returns: v.id('feedInventoryTransactions'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    if (!(args.quantityKg > 0)) throw new Error('Transfer quantity must be positive')

    let fromLabel = (args.fromLocation || '').trim()
    let toLabel = (args.toLocation || '').trim()
    const fromLocationId = args.fromLocationId
    const toLocationId = args.toLocationId

    if (fromLocationId) {
      const loc = await ctx.db.get(fromLocationId)
      assertOwns(user, loc, 'From location')
      fromLabel = fromLabel || loc.name
    }
    if (toLocationId) {
      const loc = await ctx.db.get(toLocationId)
      assertOwns(user, loc, 'To location')
      toLabel = toLabel || loc.name
    }

    if (!fromLabel || !toLabel) {
      throw new Error('From and to locations are required')
    }
    if (
      fromLocationId &&
      toLocationId &&
      fromLocationId === toLocationId
    ) {
      throw new Error('Locations must differ')
    }
    if (!fromLocationId && !toLocationId && fromLabel === toLabel) {
      throw new Error('Locations must differ')
    }

    const feedType = await ctx.db.get(args.feedTypeId)
    if (!feedType || feedType.deletedAt) throw new Error('Feed type not found')
    const allowed = await listForCompany(user, [feedType])
    if (!allowed.length) throw new Error('Access denied')

    if (fromLocationId) {
      const site = await siteStock(ctx, feedType, fromLocationId)
      if (site.available + 1e-6 < args.quantityKg) {
        throw new Error(
          `Not enough ${feedType.name} at ${fromLabel}: ${Math.round(site.available * 10) / 10} kg there, ${args.quantityKg} kg requested`,
        )
      }
    }

    const { transferId, outId, inId } = await transferFeedStock(ctx, {
      user,
      feedType,
      quantityKg: args.quantityKg,
      fromLocationId,
      toLocationId,
      fromLabel,
      toLabel,
      batchNumber: args.batchNumber,
      notes: args.notes,
    })

    await logAudit(ctx, {
      actionType: 'transfer',
      tableName: 'feedInventory',
      recordId: transferId,
      newValues: { ...args, outId, inId },
      locationId: toLocationId || fromLocationId,
    })

    return inId
  },
})

/** Reverse a ledger transaction (creates compensating reversal). */
export const reverseTransaction = mutation({
  args: {
    transactionId: v.id('feedInventoryTransactions'),
    reason: v.string(),
  },
  returns: v.id('feedInventoryTransactions'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    if (!args.reason.trim()) throw new Error('Reversal reason is required')

    const txn = await ctx.db.get(args.transactionId)
    if (!txn) throw new Error('Transaction not found')
    const allowed = await listForCompany(user, [txn])
    if (!allowed.length) throw new Error('Access denied')
    if (txn.transactionType === 'reversal') {
      throw new Error('Cannot reverse a reversal')
    }
    if (
      txn.transactionType === 'transfer' ||
      txn.transactionType === 'transfer_out' ||
      txn.transactionType === 'transfer_in'
    ) {
      throw new Error('Transfer reversals are not supported yet — transfer the feed back instead')
    }
    // Daily usage belongs to a daily record: reversing the ledger row alone
    // leaves the record counting the feed, and a later edit of the record
    // returns the stock a second time (doc 09 S13).
    if (txn.transactionType === 'daily_usage') {
      throw new Error(
        'This feed was recorded in a daily entry. To correct it, edit the daily record instead of reversing the stock transaction.',
      )
    }
    const ref = String(args.transactionId)
    const priorReversal = await ctx.db
      .query('feedInventoryTransactions')
      .withIndex('by_reference', (q) => q.eq('referenceId', ref))
      .filter((q) => q.eq(q.field('transactionType'), 'reversal'))
      .first()
    if (priorReversal) {
      throw new Error('This transaction has already been reversed.')
    }

    const { transactionId, previousStock, nextStock } = await applyStockChange(ctx, {
      user,
      feedTypeId: txn.feedTypeId,
      deltaKg: -txn.quantityKg,
      transactionType: 'reversal',
      referenceId: String(args.transactionId),
      notes: `Reversal of ${args.transactionId}: ${args.reason}`,
      locationId: txn.locationId,
      allowNegative: true,
      overrideReason: args.reason,
    })

    // An issue or usage row stands for feed that left the store; once the stock
    // comes back, void it so feed reports stop counting it (INV-003).
    let voidedUsageId: Id<'feedUsage'> | null = null
    if ((txn.transactionType === 'issue' || txn.transactionType === 'usage') && txn.referenceId) {
      const usageId = ctx.db.normalizeId('feedUsage', txn.referenceId)
      const usage = usageId ? await ctx.db.get(usageId) : null
      if (usage && !usage.deletedAt) {
        await ctx.db.patch(usage._id, { deletedAt: Date.now(), updatedAt: Date.now() })
        voidedUsageId = usage._id
      }
    }

    await logAudit(ctx, {
      actionType: 'reversal',
      tableName: 'feedInventoryTransactions',
      recordId: transactionId,
      previousValues: txn,
      newValues: {
        reversed: args.transactionId,
        reason: args.reason,
        previousStock,
        nextStock,
        voidedUsageId,
      },
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
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
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
        : await scopedRows(ctx, user, 'feedInventory')
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
  args: {
    /** Stock at this site (its lots plus unassigned stock), FARM-003. */
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    let feedTypes = await scopedRows(ctx, user, 'feedTypes')
    feedTypes = await listForCompany(user, feedTypes)

    const company = user.companyId ? await ctx.db.get(user.companyId) : null
    const multiplier = mergeSettings(company?.settings).feedRules.lowStockMultiplier || 1

    const candidates = []
    for (const f of feedTypes) {
      // Min must be configured — otherwise 0 ≤ 0 alerts every empty type
      if (!f.active || f.deletedAt || !((f.minimumStock ?? 0) > 0)) continue
      const currentStock = args.locationId
        ? (await siteStock(ctx, f, args.locationId)).available
        : f.currentStock
      if (currentStock <= f.minimumStock * multiplier) {
        candidates.push({ ...f, currentStock })
      }
    }
    const lowStockFeedTypes = candidates

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
  returns: v.array(v.object({ feed_type_id: v.id('feedTypes'), feed_type_name: v.string(), current_stock: v.number(), ledger_sum: v.number(), lots_sum: v.number(), delta: v.number(), ok: v.boolean() })),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    let feedTypes = await scopedRows(ctx, user, 'feedTypes')
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

/**
 * Per-site check (INV-002, R03 Phase 9 "site ledger balance = lots"): for each
 * feed type, Σ ledger kg booked to each site against Σ lot kg held there.
 * Rows with no site are grouped under `location_id: null`. Legacy one-row
 * `transfer` rows never recorded their source site, so they are left out and
 * counted in `legacy_transfers`; a site whose usage drew on unassigned stock
 * shows a difference that the unassigned group offsets.
 */
export const siteLedgerTally = query({
  args: { feedTypeId: v.optional(v.id('feedTypes')) },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    let feedTypes = await scopedRows(ctx, user, 'feedTypes')
    feedTypes = await listForCompany(user, feedTypes)
    if (args.feedTypeId) feedTypes = feedTypes.filter((f) => f._id === args.feedTypeId)

    const round = (n: number) => Math.round(n * 1000) / 1000
    const rows = []
    for (const feedType of feedTypes) {
      if (feedType.deletedAt) continue
      const txns = await ctx.db
        .query('feedInventoryTransactions')
        .withIndex('by_feed_type', (q) => q.eq('feedTypeId', feedType._id))
        .collect()
      const lots = await ctx.db
        .query('feedInventory')
        .withIndex('by_feed_type', (q) => q.eq('feedTypeId', feedType._id))
        .collect()
      const sites = new Map<string, { ledger: number; lots: number }>()
      const at = (id?: string) => {
        const key = id ?? ''
        if (!sites.has(key)) sites.set(key, { ledger: 0, lots: 0 })
        return sites.get(key)!
      }
      let legacyTransfers = 0
      for (const t of txns) {
        if (t.transactionType === 'transfer') {
          legacyTransfers += 1
          continue
        }
        at(t.locationId).ledger += t.quantityKg
      }
      for (const l of lots) at(l.locationId).lots += l.quantityKg
      for (const [key, s] of sites) {
        const locationId = (key || null) as Id<'farmLocations'> | null
        if (locationId && !(await listForCompany(user, [{ companyId: feedType.companyId, locationId }])).length) {
          continue
        }
        const delta = round(s.ledger - s.lots)
        rows.push({
          feed_type_id: feedType._id,
          feed_type_name: feedType.name,
          location_id: locationId,
          ledger_kg: round(s.ledger),
          lots_kg: round(s.lots),
          delta,
          ok: Math.abs(delta) < 0.001,
          legacy_transfers: legacyTransfers,
        })
      }
    }
    return rows
  },
})
