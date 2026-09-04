import { MutationCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'
import { requireRole } from './authz'
import { logAudit } from './tenancy'
import { mergeSettings } from './farmRules'

export type StockTxnType =
  | 'purchase'
  | 'usage'
  | 'issue'
  | 'daily_usage'
  | 'adjustment'
  | 'transfer'
  | 'reversal'

export function bagsFromKg(quantityKg: number, bagSizeKg?: number | null) {
  const size = bagSizeKg && bagSizeKg > 0 ? bagSizeKg : 25
  return Math.round((quantityKg / size) * 1000) / 1000
}

export function kgFromBags(bags: number, bagSizeKg?: number | null) {
  const size = bagSizeKg && bagSizeKg > 0 ? bagSizeKg : 25
  return Math.round(bags * size * 1000) / 1000
}

async function loadFeedRules(ctx: MutationCtx, companyId?: Id<'companies'>) {
  if (!companyId) return mergeSettings(undefined).feedRules
  const company = await ctx.db.get(companyId)
  return mergeSettings(company?.settings).feedRules
}

/** Add or merge a lot row for inbound stock. */
export async function addInventoryLot(
  ctx: MutationCtx,
  args: {
    feedTypeId: Id<'feedTypes'>
    quantityKg: number
    companyId?: Id<'companies'>
    batchNumber?: string
    expiryDate?: string
    location?: string
    locationId?: Id<'farmLocations'>
  },
) {
  if (args.quantityKg <= 0) return null
  const now = Date.now()
  const location = (args.location || 'Main store').trim() || 'Main store'

  const existing = await ctx.db
    .query('feedInventory')
    .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId))
    .collect()

  const match = existing.find(
    (lot) =>
      (lot.locationId
        ? lot.locationId === args.locationId
        : (lot.location || 'Main store') === location) &&
      (lot.batchNumber || '') === (args.batchNumber || '') &&
      (lot.expiryDate || '') === (args.expiryDate || ''),
  )

  if (match) {
    await ctx.db.patch(match._id, {
      quantityKg: match.quantityKg + args.quantityKg,
      locationId: args.locationId ?? match.locationId,
      updatedAt: now,
    })
    return match._id
  }

  return await ctx.db.insert('feedInventory', {
    feedTypeId: args.feedTypeId,
    quantityKg: args.quantityKg,
    batchNumber: args.batchNumber,
    expiryDate: args.expiryDate,
    location,
    locationId: args.locationId,
    companyId: args.companyId,
    updatedAt: now,
  })
}

/** FIFO deduct from lots for a feed type (optionally locked to a location). */
export async function deductInventoryLots(
  ctx: MutationCtx,
  args: {
    feedTypeId: Id<'feedTypes'>
    quantityKg: number
    location?: string
    locationId?: Id<'farmLocations'>
  },
) {
  let remaining = args.quantityKg
  if (remaining <= 0) return

  let lots = await ctx.db
    .query('feedInventory')
    .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId))
    .collect()

  lots = lots.filter((lot) => lot.quantityKg > 0)
  if (args.locationId) {
    lots = lots.filter((lot) => lot.locationId === args.locationId)
  } else if (args.location) {
    const loc = args.location.trim()
    lots = lots.filter((lot) => (lot.location || 'Main store') === loc)
  }

  lots.sort((a, b) => {
    const ae = a.expiryDate || '9999-99-99'
    const be = b.expiryDate || '9999-99-99'
    if (ae !== be) return ae.localeCompare(be)
    return a._creationTime - b._creationTime
  })

  const now = Date.now()
  for (const lot of lots) {
    if (remaining <= 0) break
    const take = Math.min(lot.quantityKg, remaining)
    const next = lot.quantityKg - take
    if (next <= 0.0001) {
      await ctx.db.delete(lot._id)
    } else {
      await ctx.db.patch(lot._id, { quantityKg: next, updatedAt: now })
    }
    remaining -= take
  }
}

/**
 * Apply a signed stock change (positive = in, negative = out).
 * Always writes feedInventoryTransactions and updates feedTypes.currentStock.
 * When feedRules.trackLots is on, also maintains feedInventory lot rows.
 */
export async function applyStockChange(
  ctx: MutationCtx,
  args: {
    user: Doc<'users'>
    feedTypeId: Id<'feedTypes'>
    deltaKg: number
    bags?: number
    transactionType: StockTxnType
    referenceId?: string
    notes?: string
    allowNegative?: boolean
    overrideReason?: string
    batchNumber?: string
    expiryDate?: string
    location?: string
    locationId?: Id<'farmLocations'>
    /** Skip lot updates (e.g. pure transfer bookkeeping already applied). */
    skipLots?: boolean
  },
) {
  if (!Number.isFinite(args.deltaKg) || args.deltaKg === 0) {
    throw new Error('Stock change quantity must be a non-zero number')
  }

  const feedType = await ctx.db.get(args.feedTypeId)
  if (!feedType || feedType.deletedAt) {
    throw new Error('Feed type not found')
  }

  const companyId = feedType.companyId ?? args.user.companyId
  const feedRules = await loadFeedRules(ctx, companyId)

  const nextStock = feedType.currentStock + args.deltaKg
  if (nextStock < 0) {
    const allowNeg =
      args.allowNegative === true || feedRules.allowNegativeStock === true
    if (!allowNeg) {
      throw new Error(
        `Insufficient stock for ${feedType.name}: have ${feedType.currentStock} kg, need ${Math.abs(args.deltaKg)} kg`,
      )
    }
    requireRole(args.user, 'admin')
    if (!args.overrideReason?.trim() && !feedRules.allowNegativeStock) {
      throw new Error('Admin override requires a reason')
    }
  }

  const bagSize =
    feedType.bagSizeKg && feedType.bagSizeKg > 0
      ? feedType.bagSizeKg
      : feedRules.defaultBagSizeKg

  const now = Date.now()
  const bags =
    args.bags != null
      ? args.bags
      : bagsFromKg(Math.abs(args.deltaKg), bagSize)

  const location =
    (args.location || feedRules.defaultLocation || 'Main store').trim() ||
    'Main store'

  if (!args.skipLots && feedRules.trackLots) {
    if (args.deltaKg > 0) {
      await addInventoryLot(ctx, {
        feedTypeId: args.feedTypeId,
        quantityKg: args.deltaKg,
        companyId,
        batchNumber: args.batchNumber,
        expiryDate: args.expiryDate,
        location,
        locationId: args.locationId,
      })
    } else {
      await deductInventoryLots(ctx, {
        feedTypeId: args.feedTypeId,
        quantityKg: Math.abs(args.deltaKg),
        location: args.location ? location : undefined,
        locationId: args.locationId,
      })
    }
  }

  const transactionId = await ctx.db.insert('feedInventoryTransactions', {
    feedTypeId: args.feedTypeId,
    transactionType: args.transactionType,
    quantityKg: args.deltaKg,
    bags,
    transactionDate: now,
    referenceId: args.referenceId,
    notes: args.overrideReason
      ? `${args.notes || ''} [override: ${args.overrideReason}]`.trim()
      : args.notes,
    locationId: args.locationId,
    companyId,
    createdBy: args.user._id,
  })

  await ctx.db.patch(args.feedTypeId, {
    currentStock: nextStock,
    updatedAt: now,
  })

  if (args.allowNegative && nextStock < 0) {
    await logAudit(ctx, {
      actionType: 'stock_override',
      tableName: 'feedInventoryTransactions',
      recordId: transactionId,
      previousValues: { currentStock: feedType.currentStock },
      newValues: {
        nextStock,
        deltaKg: args.deltaKg,
        overrideReason: args.overrideReason,
      },
      locationId: args.locationId,
    })
  }

  return {
    transactionId,
    previousStock: feedType.currentStock,
    nextStock,
    feedType,
    feedRules,
  }
}
