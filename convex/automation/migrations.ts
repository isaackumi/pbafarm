import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { internal } from '../_generated/api'
import { onEngine, seedBuiltIns } from './rules'

/**
 * M17 (roadmap Phase 10): move every approved company's daily reminders onto
 * the automation engine by creating the built-in rules (missed daily entry,
 * low feed stock, low item stock), enabled at 16:00 company time (default
 * UTC, the legacy cron time). From then on `reminders.companyDigest` skips
 * the company and the engine sends the same notifications with the same
 * dedupe keys, so nothing is sent twice on the switch-over day.
 *
 *   npx convex run automation/migrations:seedBuiltInRules '{}'                 # dry run
 *   npx convex run automation/migrations:seedBuiltInRules '{"dryRun":false}'
 *
 * Rollback: delete the built-in rules of a company (or all) and the legacy
 * cron resumes for it the next evening.
 */
const PAGE = 50

export const seedBuiltInRules = internalMutation({
  args: { dryRun: v.optional(v.boolean()), cursor: v.optional(v.string()) },
  returns: v.object({ dryRun: v.boolean(), companies: v.array(v.object({ name: v.string(), alreadyOnEngine: v.boolean(), created: v.array(v.string()) })), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { dryRun, cursor }) => {
    const dry = dryRun !== false
    const page = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'approved'))
      .paginate({ numItems: PAGE, cursor: cursor ?? null })
    const companies: { name: string; alreadyOnEngine: boolean; created: string[] }[] = []
    for (const c of page.page) {
      const already = await onEngine(ctx, c._id)
      const created = dry || already ? [] : await seedBuiltIns(ctx, c._id)
      companies.push({ name: c.name, alreadyOnEngine: already, created })
    }
    if (!dry && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.automation.migrations.seedBuiltInRules, {
        dryRun: false,
        cursor: page.continueCursor,
      })
    }
    return { dryRun: dry, companies, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})
