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
