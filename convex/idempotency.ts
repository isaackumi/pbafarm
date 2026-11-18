import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { IDEMPOTENCY_RETENTION_MS } from './lib/idempotency'

const BATCH = 500

/** Delete replay keys older than the retention window, in batches. */
export const prune = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }) => {
    const cutoff = (now ?? Date.now()) - IDEMPOTENCY_RETENTION_MS
    const old = await ctx.db
      .query('idempotencyKeys')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(BATCH)
    for (const row of old) await ctx.db.delete(row._id)
    if (old.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.idempotency.prune, { now })
    }
    return old.length
  },
})
