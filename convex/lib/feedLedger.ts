import { MutationCtx, QueryCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'
import { requireRole } from './authz'
import { assertOwns, logAudit } from './tenancy'
import { mergeSettings } from './farmRules'

export type StockTxnType =
  | 'purchase'
  | 'usage'
  | 'issue'
  | 'daily_usage'
  | 'adjustment'
  | 'transfer'
  | 'reversal'

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
    remaining -= take
  }
}

/** Kg issued from the store to this cage on this date and not reversed since. */
async function issuedKg(ctx: MutationCtx, cageId: Id<'cages'>, date: string) {
  const usage = await ctx.db
    .query('feedUsage')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .collect()
  let kg = 0
  for (const u of usage) {
    if (u.source !== 'issue' || u.usageDate !== date) continue
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
    requireRole(args.user, 'admin')
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
  throw new Error(
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
    throw new Error('Stock change quantity must be a non-zero number')
  }

  const feedType = await ctx.db.get(args.feedTypeId)
  if (!feedType || feedType.deletedAt) {
    throw new Error('Feed type not found')
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
      throw new Error(
        `Insufficient stock for ${feedType.name}: have ${feedType.currentStock} kg, need ${Math.abs(args.deltaKg)} kg`,
      )
    }
    requireRole(args.user, 'admin')
    if (!args.overrideReason?.trim() && !feedRules.allowNegativeStock) {
      throw new Error('Admin override requires a reason')
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
        throw new Error(
          `Not enough ${feedType.name} at ${siteName}: ${round1(site.available)} kg there, ${round1(need)} kg needed. ` +
            `${round1(feedType.currentStock)} kg across all sites; transfer feed to ${siteName} or record a purchase for it.`,
        )
      }
      requireRole(args.user, 'admin')
      if (!args.overrideReason?.trim() && !feedRules.allowNegativeStock) {
        throw new Error('Admin override requires a reason')
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
