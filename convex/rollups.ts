import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { markDirty, processDirtyQueue, refreshUnitDays } from './lib/rollups'

/**
 * Rollup jobs (PLAT-002). The rows themselves are maintained by
 * convex/lib/rollups.ts on every write; these jobs drain the dirty queue,
 * roll open occupancies forward each night and backfill history.
 */

/** Occupancies recomputed per transaction (each reads its ledger and days). */
const DIRTY_BATCH = 10

/** Drain the dirty queue (cron every 5 minutes; continues itself while work remains). */
export const processDirty = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ processed: v.number(), more: v.boolean() }),
  handler: async (ctx, args) => {
    const r = await processDirtyQueue(ctx, DIRTY_BATCH, args.now)
    if (r.more) await ctx.scheduler.runAfter(0, internal.rollups.processDirty, {})
    return r
  },
})

/**
 * Nightly: queue every open occupancy so days of culture, "as of" and the
 * weekly snapshots move with the calendar even when nothing was recorded.
 */
export const queueOpen = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ queued: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('companies')
      .paginate({ numItems: 20, cursor: args.cursor ?? null })
    let queued = 0
    for (const company of page.page) {
      const open = await ctx.db
        .query('batchStats')
        .withIndex('by_companyId_and_open', (q) => q.eq('companyId', company._id).eq('open', true))
        .take(500)
      for (const s of open) {
        await markDirty(ctx, s.companyId, s.unitId, s.batchId)
        queued++
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.rollups.queueOpen, { cursor: page.continueCursor })
    } else {
      await ctx.scheduler.runAfter(0, internal.rollups.processDirty, {})
    }
    return { queued, done: page.isDone }
  },
})

/** Dates of a cage with source rows after `after`, ascending, at most `limit`. */
async function cageDates(
  ctx: Parameters<typeof refreshUnitDays>[0],
  cageId: Id<'cages'>,
  after: string,
  limit: number,
) {
  const dates = new Set<string>()
  for (const r of await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', cageId).gt('date', after))
    .take(limit)) {
    dates.add(r.date)
  }
  for (const e of await ctx.db
    .query('stockEvents')
    .withIndex('by_unitId_and_eventDate', (q) => q.eq('unitId', cageId).gt('eventDate', after))
    .take(limit * 4)) {
    dates.add(e.eventDate)
  }
  for (const s of await ctx.db
    .query('biweeklyRecords')
    .withIndex('by_cage_and_date', (q) => q.eq('cageId', cageId).gt('date', after))
    .take(limit)) {
    dates.add(s.date)
  }
  return [...dates].sort().slice(0, limit)
}

/** Unit-days rebuilt per transaction. */
const BACKFILL_DAYS = 40

/**
 * Backfill unitDailyStats (and queue batchStats) from existing records, one
 * cage at a time, BACKFILL_DAYS dates per transaction. Idempotent: a re-run
 * rewrites the same rows. `dryRun` (default) reports the first chunk only.
 *
 *   npx convex run rollups:backfill '{"dryRun": false}'
 */
export const backfill = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    cageId: v.optional(v.id('cages')),
    after: v.optional(v.string()),
    cageCursor: v.optional(v.union(v.string(), v.null())),
    totals: v.optional(v.object({ cages: v.number(), unitDays: v.number() })),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true
    const totals = args.totals ?? { cages: 0, unitDays: 0 }
    let cageId = args.cageId
    let nextCursor = args.cageCursor ?? null
    if (!cageId) {
      const page = await ctx.db.query('cages').paginate({ numItems: 1, cursor: args.cursor ?? null })
      if (page.page.length === 0) {
        if (!dryRun) await ctx.scheduler.runAfter(0, internal.rollups.processDirty, {})
        return { dryRun, done: true, ...totals }
      }
      cageId = page.page[0]._id
      nextCursor = page.isDone ? null : page.continueCursor
      totals.cages++
    }
    const dates = await cageDates(ctx, cageId, args.after ?? '', BACKFILL_DAYS)
    totals.unitDays += dates.length
    if (dryRun) {
      return { dryRun, done: false, cageId, wouldRebuild: dates, ...totals }
    }
    await refreshUnitDays(
      ctx,
      dates.map((date) => ({ unitId: cageId!, date })),
    )
    if (dates.length === BACKFILL_DAYS) {
      await ctx.scheduler.runAfter(0, internal.rollups.backfill, {
        dryRun: false,
        cageId,
        after: dates[dates.length - 1],
        cageCursor: nextCursor,
        totals,
      })
    } else if (nextCursor) {
      await ctx.scheduler.runAfter(0, internal.rollups.backfill, {
        dryRun: false,
        cursor: nextCursor,
        totals,
      })
    } else {
      await ctx.scheduler.runAfter(0, internal.rollups.processDirty, {})
    }
    return { dryRun, done: false, cageId, rebuilt: dates.length, ...totals }
  },
})
