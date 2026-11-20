import { HOUR } from '@convex-dev/rate-limiter'
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { rateLimiter, retryAfterText } from './rateLimits'
import { userError } from './errors'
import { aiPolicyOf } from './aiPolicyShared'

export * from './aiPolicyShared'

/**
 * Spend one of the member's daily assistant requests when the company sets a
 * cap. A fixed 24-hour window per user in the shared rate limiter: cheap, and
 * it holds across server instances. Throws RATE_LIMITED when used up.
 */
export async function spendDailyQuestion(
  ctx: MutationCtx,
  company: Doc<'companies'> | null | undefined,
  userId: Id<'users'>,
) {
  const cap = aiPolicyOf(company).dailyQuestionsPerMember
  if (cap === null) return
  const verdict = await rateLimiter.limit(ctx, 'llmDailyPerMember', {
    key: String(userId),
    config: { kind: 'fixed window', rate: cap, period: 24 * HOUR },
  })
  if (!verdict.ok) {
    throw userError(
      'RATE_LIMITED',
      `You have used today's ${cap} Anowa questions set by your admin. ${retryAfterText(verdict.retryAfter)}`,
    )
  }
}
