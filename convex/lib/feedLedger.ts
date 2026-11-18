import { MutationCtx, QueryCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'
import { assertUserCan } from './permissions'
import { assertOwns, logAudit } from './tenancy'
import { emitDomainEvent } from './events'
import { mergeSettings } from './farmRules'
import { userError } from './errors'

export type StockTxnType =
  | 'purchase'
  | 'usage'
  | 'issue'
  | 'daily_usage'
  | 'adjustment'
  | 'transfer'
  | 'reversal'
  | 'transfer_out'
  | 'transfer_in'

const round1 = (n: number) => Math.round(n * 10) / 10

export function bagsFromKg(quantityKg: number, bagSizeKg?: number | null) {
  const size = bagSizeKg && bagSizeKg > 0 ? bagSizeKg : 20
  return Math.round((quantityKg / size) * 1000) / 1000
}

export function kgFromBags(bags: number, bagSizeKg?: number | null) {
  const size = bagSizeKg && bagSizeKg > 0 ? bagSizeKg : 20
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

/**
 * Feed a site can use: its own lots, plus stock not tied to any site
 * (lots with no location, and stock from before lots were tracked).
 */
export async function siteStock(
  ctx: MutationCtx | QueryCtx,
  feedType: Doc<'feedTypes'>,
  locationId: Id<'farmLocations'>,
) {
  const lots = await ctx.db
    .query('feedInventory')
    .withIndex('by_feed_type', (q) => q.eq('feedTypeId', feedType._id))
    .collect()
  const sum = (rows: Doc<'feedInventory'>[]) =>
    rows.reduce((s, l) => s + Math.max(0, l.quantityKg || 0), 0)
  const own = sum(lots.filter((l) => l.locationId === locationId))
  const unassignedLots = sum(lots.filter((l) => !l.locationId))
  const untracked = Math.max(0, (feedType.currentStock || 0) - sum(lots))
  const shared = unassignedLots + untracked
  return { own, shared, available: own + shared }
}

export type TakenLot = { quantityKg: number; batchNumber?: string; expiryDate?: string }

/**
 * FIFO deduct from lots for a feed type (optionally locked to a location).
 * Returns what was taken from each lot, so a transfer can recreate the same
 * batch and expiry at the destination.
 */
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
  const taken: TakenLot[] = []
  if (remaining <= 0) return taken

  let lots = await ctx.db
    .query('feedInventory')
    .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId))
    .collect()

  lots = lots.filter((lot) => lot.quantityKg > 0)
  const fifo = (a: Doc<'feedInventory'>, b: Doc<'feedInventory'>) => {
    const ae = a.expiryDate || '9999-99-99'
    const be = b.expiryDate || '9999-99-99'
    if (ae !== be) return ae.localeCompare(be)
    return a._creationTime - b._creationTime
  }
  if (args.locationId) {
    // The site's own lots first, then stock not tied to any site.
    const own = lots.filter((lot) => lot.locationId === args.locationId).sort(fifo)
    const shared = lots.filter((lot) => !lot.locationId).sort(fifo)
    lots = [...own, ...shared]
  } else if (args.location) {
    const loc = args.location.trim()
    lots = lots.filter((lot) => (lot.location || 'Main store') === loc).sort(fifo)
  } else {
    lots.sort(fifo)
  }

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
    taken.push({ quantityKg: take, batchNumber: lot.batchNumber, expiryDate: lot.expiryDate })
    remaining -= take
  }
  return taken
}

/** Kg issued from the store to this cage on this date and not reversed since. */
async function issuedKg(ctx: MutationCtx, cageId: Id<'cages'>, date: string) {
  const usage = await ctx.db
    .query('feedUsage')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .collect()
  let kg = 0
  for (const u of usage) {
    if (u.deletedAt || u.source !== 'issue' || u.usageDate !== date) continue
    const txns = await ctx.db
      .query('feedInventoryTransactions')
      .withIndex('by_reference', (q) => q.eq('referenceId', String(u._id)))
      .collect()
    const issue = txns.find((t) => t.transactionType === 'issue')
    if (issue) {
      const reversed = await ctx.db
        .query('feedInventoryTransactions')
        .withIndex('by_reference', (q) => q.eq('referenceId', String(issue._id)))
        .filter((q) => q.eq(q.field('transactionType'), 'reversal'))
        .first()
      if (reversed) continue
    }
    kg += u.quantity || 0
  }
  return kg
}

/**
 * Interim guard for doc 09 S14 (OPEN-QUESTIONS Q-003): a feed issue to a cage
 * and the daily entry's feed for the same cage and date both deduct stock, so
 * recording the same feed both ways counts it twice. Whichever is recorded
 * second is refused unless an admin gives an override reason (for a genuine
 * extra ration), which is written to the audit log.
 */
export async function assertFeedNotAlreadyRecorded(
  ctx: MutationCtx,
  args: {
    user: Doc<'users'>
    cageId: Id<'cages'>
    date: string
    writing: 'issue' | 'daily'
    overrideReason?: string
  },
) {
  let existingKg = 0
  if (args.writing === 'daily') {
    existingKg = await issuedKg(ctx, args.cageId, args.date)
  } else {
    const rec = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', args.cageId).eq('date', args.date))
      .first()
    existingKg = rec?.feedAmount ?? 0
  }
  if (!(existingKg > 0)) return

  if (args.overrideReason?.trim()) {
    await assertUserCan(ctx, args.user, 'inventory.adjust')
    const cage = await ctx.db.get(args.cageId)
    await logAudit(ctx, {
      actionType: 'feed_overlap_override',
      tableName: args.writing === 'daily' ? 'daily_records' : 'feedUsage',
      recordId: String(args.cageId),
      newValues: {
        cageId: args.cageId,
        date: args.date,
        writing: args.writing,
        alreadyRecordedKg: existingKg,
        reason: args.overrideReason.trim(),
      },
      locationId: cage?.locationId,
    })
    return
  }

  const cage = await ctx.db.get(args.cageId)
  const name = cage?.name ?? 'this cage'
  const kg = round1(existingKg)
  throw userError(
    'CONFLICT',
    args.writing === 'daily'
      ? `Feed for cage ${name} on ${args.date} was already issued from the store (${kg} kg). Recording it in the daily entry as well would deduct the stock twice. Enter 0 feed here, or ask an admin to save it with an override reason.`
      : `Feed for cage ${name} on ${args.date} is already recorded in the daily entry (${kg} kg). Issuing it as well would deduct the stock twice. Correct the daily entry instead, or ask an admin to issue it with an override reason.`,
  )
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
    throw userError('VALIDATION', 'Stock change quantity must be a non-zero number')
  }

  const feedType = await ctx.db.get(args.feedTypeId)
  if (!feedType || feedType.deletedAt) {
    throw userError('NOT_FOUND', 'Feed type not found')
  }
  // Defensive (SEC-002, V1): never move another company's stock, whatever
  // the caller checked.
  assertOwns(args.user, feedType, 'Feed type')

  const companyId = feedType.companyId ?? args.user.companyId
  const feedRules = await loadFeedRules(ctx, companyId)

  const nextStock = feedType.currentStock + args.deltaKg
  if (nextStock < 0) {
    const allowNeg =
      args.allowNegative === true || feedRules.allowNegativeStock === true
    if (!allowNeg) {
      throw userError(
        'INSUFFICIENT_STOCK',
        `Insufficient stock for ${feedType.name}: have ${feedType.currentStock} kg, need ${Math.abs(args.deltaKg)} kg`,
      )
    }
    await assertUserCan(ctx, args.user, 'inventory.adjust')
    if (!args.overrideReason?.trim() && !feedRules.allowNegativeStock) {
      throw userError('VALIDATION', 'Admin override requires a reason')
    }
  } else if (
    args.deltaKg < 0 &&
    args.locationId &&
    feedRules.trackLots &&
    !args.skipLots
  ) {
    // The company has enough in total; check this site has it.
    const need = Math.abs(args.deltaKg)
    const site = await siteStock(ctx, feedType, args.locationId)
    if (site.available + 1e-6 < need) {
      const allowNeg =
        args.allowNegative === true || feedRules.allowNegativeStock === true
      const siteDoc = await ctx.db.get(args.locationId)
      const siteName = siteDoc?.name || 'this site'
      if (!allowNeg) {
        throw userError(
          'INSUFFICIENT_STOCK',
          `Not enough ${feedType.name} at ${siteName}: ${round1(site.available)} kg there, ${round1(need)} kg needed. ` +
            `${round1(feedType.currentStock)} kg across all sites; transfer feed to ${siteName} or record a purchase for it.`,
        )
      }
      await assertUserCan(ctx, args.user, 'inventory.adjust')
      if (!args.overrideReason?.trim() && !feedRules.allowNegativeStock) {
        throw userError('VALIDATION', 'Admin override requires a reason')
      }
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
    batchNumber: args.deltaKg > 0 ? args.batchNumber || undefined : undefined,
    expiryDate: args.deltaKg > 0 ? args.expiryDate || undefined : undefined,
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

  // Edge-triggered: only the change that takes stock to or below the minimum.
  const minimum = feedType.minimumStock ?? 0
  if (
    companyId &&
    args.deltaKg < 0 &&
    minimum > 0 &&
    feedType.currentStock > minimum &&
    nextStock <= minimum
  ) {
    await emitDomainEvent(
      ctx,
      'inventory.stock.low',
      {
        feedTypeId: String(feedType._id),
        feedTypeName: feedType.name,
        stockKg: Math.round(nextStock * 1000) / 1000,
        minimumKg: minimum,
        transactionType: args.transactionType,
      },
      { companyId, locationId: args.locationId },
    )
  }

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

/**
 * Move feed between two sites (INV-002, d08 §6.3): lots leave the source
 * (its own lots first, then unassigned stock) and arrive at the destination
 * with the same batch and expiry; the ledger gets two rows sharing a
 * `transferId`: `transfer_out` (negative, source site) and `transfer_in`
 * (positive, destination site). The company total does not change.
 */
export async function transferFeedStock(
  ctx: MutationCtx,
  args: {
    user: Doc<'users'>
    feedType: Doc<'feedTypes'>
    quantityKg: number
    fromLocationId?: Id<'farmLocations'>
    toLocationId?: Id<'farmLocations'>
    /** Legacy store labels, used when a side has no farm location. */
    fromLabel: string
    toLabel: string
    /** Replaces the moved lots' batch number when given. */
    batchNumber?: string
    notes?: string
  },
) {
  const { feedType, quantityKg } = args
  const companyId = feedType.companyId ?? args.user.companyId
  const taken = await deductInventoryLots(ctx, {
    feedTypeId: feedType._id,
    quantityKg,
    location: args.fromLocationId ? undefined : args.fromLabel,
    locationId: args.fromLocationId,
  })
  const batchOverride = args.batchNumber?.trim() || undefined
  const parts: TakenLot[] = [...taken]
  const fromLots = taken.reduce((s, p) => s + p.quantityKg, 0)
  // Stock from before lots were tracked has no lot to move.
  if (quantityKg - fromLots > 1e-6) parts.push({ quantityKg: quantityKg - fromLots })
  for (const part of parts) {
    await addInventoryLot(ctx, {
      feedTypeId: feedType._id,
      quantityKg: part.quantityKg,
      companyId,
      batchNumber: batchOverride ?? part.batchNumber,
      expiryDate: part.expiryDate,
      location: args.toLabel,
      locationId: args.toLocationId,
    })
  }

  // Trace on the rows: the batch when the transfer moved one, the earliest expiry.
  const batches = new Set(parts.map((p) => batchOverride ?? p.batchNumber))
  const rowBatch = batches.size === 1 ? [...batches][0] : undefined
  const rowExpiry = parts.map((p) => p.expiryDate).filter((d): d is string => Boolean(d)).sort()[0]

  const now = Date.now()
  const bags = bagsFromKg(quantityKg, feedType.bagSizeKg)
  const notes = args.notes?.trim() || `Transfer ${quantityKg} kg from ${args.fromLabel} → ${args.toLabel}`
  const outId = await ctx.db.insert('feedInventoryTransactions', {
    feedTypeId: feedType._id,
    transactionType: 'transfer_out',
    quantityKg: -quantityKg,
    bags,
    transactionDate: now,
    notes,
    batchNumber: rowBatch,
    expiryDate: rowExpiry,
    locationId: args.fromLocationId,
    companyId,
    createdBy: args.user._id,
  })
  const transferId = String(outId)
  await ctx.db.patch(outId, { transferId })
  const inId = await ctx.db.insert('feedInventoryTransactions', {
    feedTypeId: feedType._id,
    transactionType: 'transfer_in',
    quantityKg,
    bags,
    transactionDate: now,
    transferId,
    batchNumber: rowBatch,
    expiryDate: rowExpiry,
    notes,
    locationId: args.toLocationId,
    companyId,
    createdBy: args.user._id,
  })
  return { transferId, outId, inId }
}
