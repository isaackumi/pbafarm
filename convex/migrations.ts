import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { currentStocking } from './lib/growth'

/**
 * One-off data repairs for PROD-000. None of these run automatically: they are
 * internal functions an operator runs by hand from the Convex dashboard (or
 * `npx convex run`) after the code fix is deployed. Every one defaults to
 * `dryRun: true`, which only reports what it would change; pass
 * `dryRun: false` to write. Each written change keeps the previous value in
 * an `auditLogs` row (actionType `migration`).
 */

/**
 * M0-b: cages restocked since their last bi-weekly sample still carry the
 * previous cycle's ABW in `currentWeight` (doc 09 S7). Reset it to the
 * current stocking's ABW. Cages with a sample in the current cycle, and cages
 * that have never been sampled, are left alone.
 */
export const repairStaleCageWeight = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun = true }) => {
    const changes: Array<{
      cageId: string
      cage: string
      stockingDate: string
      lastSampleDate: string
      from: number
      to: number
    }> = []

    for await (const cage of ctx.db.query('cages')) {
      if (!cage.stockingDate || cage.currentWeight == null) continue
      const samples = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
        .collect()
      if (!samples.length) continue
      if (samples.some((s) => s.date >= cage.stockingDate!)) continue

      const stocking = await currentStocking(ctx, cage._id)
      const target = stocking?.initialAbw ?? cage.initialAbw
      if (target == null || target === cage.currentWeight) continue

      const lastSampleDate = samples.map((s) => s.date).sort()[samples.length - 1]
      changes.push({
        cageId: cage._id,
        cage: cage.name,
        stockingDate: cage.stockingDate,
        lastSampleDate,
        from: cage.currentWeight,
        to: target,
      })
      if (dryRun) continue

      await ctx.db.patch(cage._id, { currentWeight: target, updatedAt: Date.now() })
      await ctx.db.insert('auditLogs', {
        actionType: 'migration',
        tableName: 'cages',
        recordId: cage._id,
        previousValues: { currentWeight: cage.currentWeight },
        newValues: { currentWeight: target, migration: 'M0-b' },
        locationId: cage.locationId,
        companyId: cage.companyId,
      })
    }

    return { dryRun, count: changes.length, changes }
  },
})

/**
 * M0-c: tag the harvest records the old /harvest-sampling page wrote
 * (`harvest.createFromSampling`) with `source: 'sampling_page'`, so harvest
 * KPIs leave them out (doc 09 S12). The records are not deleted.
 *
 * Fingerprint of such a record: FCR exactly 1.5, no `cageEffect` (the page
 * never touched the cage), and a `harvestSampling` row pointing at it with the
 * same date, total weight and fish count. Review the dry-run list before
 * writing: an old real harvest that happens to match all of these would be
 * tagged too.
 */
export const tagSamplingPageHarvests = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun = true }) => {
    const changes: Array<{
      harvestId: string
      cageId: string
      harvestDate: string
      totalWeight: number
      estimatedCount: number
    }> = []

    for await (const h of ctx.db.query('harvestRecords')) {
      if (h.source || h.cageEffect || h.fcr !== 1.5) continue
      const samples = await ctx.db
        .query('harvestSampling')
        .withIndex('by_harvest', (q) => q.eq('harvestId', h._id))
        .collect()
      const match = samples.some(
        (s) =>
          s.cageId === h.cageId &&
          s.date === h.harvestDate &&
          s.weight === h.totalWeight &&
          s.fishCount === h.estimatedCount,
      )
      if (!match) continue

      changes.push({
        harvestId: h._id,
        cageId: h.cageId,
        harvestDate: h.harvestDate,
        totalWeight: h.totalWeight,
        estimatedCount: h.estimatedCount,
      })
      if (dryRun) continue

      await ctx.db.patch(h._id, { source: 'sampling_page' })
      await ctx.db.insert('auditLogs', {
        actionType: 'migration',
        tableName: 'harvestRecords',
        recordId: h._id,
        previousValues: { source: null },
        newValues: { source: 'sampling_page', migration: 'M0-c' },
        locationId: h.locationId,
        companyId: h.companyId,
      })
    }

    return { dryRun, count: changes.length, changes }
  },
})
