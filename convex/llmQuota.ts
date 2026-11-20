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
import { admissionError, admitCall } from './aiGuard'
import { PROVIDERS } from './lib/llmGateway'

/**
 * Also the AI protections' gate for server-key calls (D-023): refuses when
 * the company's (or the server key's) monthly budget is used up or a
 * concurrency cap is full, before any quota is spent, and returns the lease
 * the proxy gives back (`aiGuard.releaseLease`) plus the open breakers.
 */
export const consumeServerKeyQuota = mutation({
  args: { providerId: v.optional(v.string()), feature: v.optional(v.string()) },
  returns: v.object({
    leaseId: v.id('aiLeases'),
    deadlineAt: v.number(),
    attemptMs: v.number(),
    blocked: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
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
    const admitted = await admitCall(ctx, {
      companyId,
      userId: user._id,
      server: true,
      feature: (args.feature ?? 'proxy').slice(0, 40),
      providerId: args.providerId && PROVIDERS[args.providerId] ? args.providerId : null,
    })
    if (!admitted.ok) throw admissionError(admitted)
    // Admin's daily cap per member (AI-POLICY); refuses before anything is spent.
    await spendDailyQuestion(ctx, await ctx.db.get(companyId), user._id)
    for (const [name, key] of limits) await rateLimiter.limit(ctx, name, { key })
    return { leaseId: admitted.leaseId, deadlineAt: admitted.deadlineAt, attemptMs: admitted.attemptMs, blocked: admitted.blocked }
  },
})
