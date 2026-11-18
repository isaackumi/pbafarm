import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { currentStocking } from './growth'

/**
 * Production-cycle guards.
 *
 * A cage's live fish count (`cages.currentCount`) belongs to its current cycle.
 * Editing or deleting a record from an earlier cycle must only change that
 * record, never the live count: the old cycle is closed and the fish now in
 * the cage are a different stocking.
 */

type Ctx = QueryCtx | MutationCtx

const EMPTY_STATUSES = new Set(['harvested', 'empty', 'fallow'])

/** First day of the cage's current cycle, or null when the cage has no open cycle. */
export async function currentCycleStart(ctx: Ctx, cage: Doc<'cages'>): Promise<string | null> {
  if (cage.status && EMPTY_STATUSES.has(cage.status)) return null
  const stocking = await currentStocking(ctx, cage._id)
  if (stocking && !stocking.closedAt) return stocking.stockingDate
  return cage.stockingDate ?? null
}

/** True when a record dated `date` belongs to the cage's current cycle. */
export async function inCurrentCycle(ctx: Ctx, cage: Doc<'cages'>, date: string) {
  const start = await currentCycleStart(ctx, cage)
  return start != null && date >= start
}

/**
 * Whether a harvest record is a real harvest for KPIs and cycle logic.
 * Records written by the old /harvest-sampling page (tagged by migration
 * M0-c) are samples, not harvests (doc 09 S12).
 */
export const isRealHarvest = (h: { source?: string }) => h.source !== 'sampling_page'

/** Is `a` (date + creation time) later than `b`? Same-day ties go to whichever was entered later. */
const isAfter = (aDate: string, aCreated: number, bDate: string, bCreated: number) =>
  aDate > bDate || (aDate === bDate && aCreated > bCreated)

/**
 * Whether a harvest still drives the cage's live state, i.e. nothing that
 * started a new cycle (a later approved stocking) or ended it again (a later
 * complete harvest) has happened since.
 */
export async function harvestIsCurrent(
  ctx: Ctx,
  harvest: Doc<'harvestRecords'>,
  closedStockingId?: Id<'stockingHistory'>,
) {
  const cage = await ctx.db.get(harvest.cageId)
  if (!cage) return false

  const stockings = await ctx.db
    .query('stockingHistory')
    .withIndex('by_cage', (q) => q.eq('cageId', harvest.cageId))
    .collect()
  const laterStocking = stockings.some(
    (s) =>
      s.status === 'approved' &&
      !s.deletedAt &&
      s._id !== closedStockingId &&
      isAfter(s.stockingDate, s._creationTime, harvest.harvestDate, harvest._creationTime),
  )
  if (laterStocking) return false

  const harvests = await ctx.db
    .query('harvestRecords')
    .withIndex('by_cage', (q) => q.eq('cageId', harvest.cageId))
    .collect()
  const laterComplete = harvests.some(
    (h) =>
      h._id !== harvest._id &&
      isRealHarvest(h) &&
      h.harvestType === 'complete' &&
      isAfter(h.harvestDate, h._creationTime, harvest.harvestDate, harvest._creationTime),
  )
  if (laterComplete) return false

  // A complete harvest is only current while the cage is still sitting empty after it.
  if (harvest.harvestType === 'complete') return cage.status === 'harvested'
  return true
}

/**
 * Refuse to start a new cycle on a cage whose current cycle is still running:
 * another approved stocking without `closedAt` while the cage is not sitting
 * empty. Stockings from before harvests closed their cycle have no `closedAt`,
 * so an unclosed stocking on a harvested/empty/fallow cage is not counted.
 */
export async function assertNoOtherOpenStocking(
  ctx: Ctx,
  cage: Doc<'cages'>,
  exceptStockingId?: Id<'stockingHistory'>,
) {
  if (cage.status && EMPTY_STATUSES.has(cage.status)) return
  const rows = await ctx.db
    .query('stockingHistory')
    .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
    .collect()
  const open = rows.find(
    (s) =>
      s._id !== exceptStockingId &&
      s.status === 'approved' &&
      !s.deletedAt &&
      !s.closedAt,
  )
  if (open) {
    throw new Error(
      `Cage ${cage.name} already has an open stocking (batch ${open.batchNumber}). Harvest the cage before stocking it again, or record these fish as a top-up.`,
    )
  }
}
