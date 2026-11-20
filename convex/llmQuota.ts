/**
 * Durable assistant limits for calls on the server's LLM key (SEC-004).
 *
 * The Next proxy (`/api/llm/chat`, `/api/llm/insights`) keeps its in-memory
 * limiter as a first line, but that is per instance. Before a server-key call
 * it spends the same Convex limits the organization-key path spends in
 * `llmGateway.begin` (per user per minute and hour, per company per hour), so
 * the limits hold across instances whichever key answers.
 */
import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { requireMember } from './lib/permissions'
import { rateLimiter, retryAfterText } from './lib/rateLimits'
import { userError } from './lib/errors'
import { spendDailyQuestion } from './lib/aiPolicy'

export const consumeServerKeyQuota = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'ai.use' })
    const companyId = user.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Assistant is not available for your account')
    const limits = [
      ['llmPerUserMinute', user._id],
      ['llmPerUserHour', user._id],
      ['llmPerCompanyHour', companyId],
    ] as const
    // Check all first so a refused call spends nothing.
    for (const [name, key] of limits) {
      const verdict = await rateLimiter.check(ctx, name, { key })
      if (!verdict.ok) {
        throw userError('RATE_LIMITED', `Too many assistant requests. ${retryAfterText(verdict.retryAfter)}`)
      }
    }
    // Admin's daily cap per member (AI-POLICY); refuses before anything is spent.
    await spendDailyQuestion(ctx, await ctx.db.get(companyId), user._id)
    for (const [name, key] of limits) await rateLimiter.limit(ctx, name, { key })
    return null
  },
})
