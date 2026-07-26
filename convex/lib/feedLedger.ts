import { MutationCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'
import { requireRole } from './authz'
import { logAudit } from './tenancy'

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

/**
 * Apply a signed stock change (positive = in, negative = out).
 * Always writes feedInventoryTransactions and updates feedTypes.currentStock.
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
  },
) {
  if (!Number.isFinite(args.deltaKg) || args.deltaKg === 0) {
    throw new Error('Stock change quantity must be a non-zero number')
  }

  const feedType = await ctx.db.get(args.feedTypeId)
  if (!feedType || feedType.deletedAt) {
    throw new Error('Feed type not found')
  }

  const nextStock = feedType.currentStock + args.deltaKg
  if (nextStock < 0) {
    if (!args.allowNegative) {
      throw new Error(
        `Insufficient stock for ${feedType.name}: have ${feedType.currentStock} kg, need ${Math.abs(args.deltaKg)} kg`,
      )
    }
    requireRole(args.user, 'admin')
    if (!args.overrideReason?.trim()) {
      throw new Error('Admin override requires a reason')
    }
  }

  const now = Date.now()
  const bags =
    args.bags != null
      ? args.bags
      : bagsFromKg(Math.abs(args.deltaKg), feedType.bagSizeKg)

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
    companyId: feedType.companyId ?? args.user.companyId,
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
    })
  }

  return { transactionId, previousStock: feedType.currentStock, nextStock, feedType }
}
