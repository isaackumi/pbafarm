/**
 * Password sign-in hardening (CF-003, doc 07): wraps the Password provider's
 * `signIn` flow (convex/auth.ts).
 *
 * - Consecutive failures are counted per normalized email (unknown emails
 *   too, so the answer does not reveal which accounts exist) and reset on a
 *   successful sign-in.
 * - After SIGNIN_HUMAN_CHECK_AFTER consecutive failures, the next attempt for
 *   that email needs a `signin` human ticket (Turnstile). No-op when
 *   TURNSTILE_SECRET_KEY is unset (dev, CI, previews).
 * - `signInFailPerEmail` refuses further attempts for an email after too many
 *   failures in an hour. Convex does not give auth actions the caller's IP,
 *   so the per-IP limit is approximated platform-wide: once
 *   `signInFailGlobal` is used up, every password sign-in needs the human
 *   check until the window passes (never a hard block for everyone).
 *
 * The @convex-dev/auth per-account lockout (10 failures/hour) still applies.
 */
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { assertHumanTicket } from './humanVerification'
import { userError } from './lib/errors'
import { rateLimiter, retryAfterText } from './lib/rateLimits'

export const SIGNIN_HUMAN_CHECK_AFTER = 3
/** Failures older than this no longer count as consecutive. */
const FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000

/** RFC 5321 path limit; longer addresses cannot receive mail. */
export const MAX_EMAIL_LENGTH = 254
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

/**
 * The one email value password flows key on: the account (`profile`), the
 * sign-up/reset ticket grant and sign-in failure counts. Never truncated, so
 * distinct addresses can never share a key; overlong or malformed input is refused.
 */
export function canonicalEmail(value: unknown): string {
  const email = normalizeEmail(value)
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) {
    throw userError('VALIDATION', 'Enter a valid email address.', { reason: 'INVALID_EMAIL' })
  }
  return email
}

/** Refuse a rate-limited attempt; demand a human ticket after repeated failures. */
export const beforePasswordSignIn = internalMutation({
  args: { email: v.string(), humanTicket: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { email, humanTicket }) => {
    const key = normalizeEmail(email)
    const perEmail = await rateLimiter.check(ctx, 'signInFailPerEmail', { key })
    if (!perEmail.ok) {
      throw userError('RATE_LIMITED', `Too many failed sign-in attempts. ${retryAfterText(perEmail.retryAfter)}`, {
        reason: 'SIGNIN_RATE_LIMITED',
      })
    }
    const row = await ctx.db
      .query('signInFailures')
      .withIndex('by_email', (q) => q.eq('email', key))
      .unique()
    const consecutive = row && Date.now() - row.lastFailedAt < FAILURE_MEMORY_MS ? row.count : 0
    const global = await rateLimiter.check(ctx, 'signInFailGlobal')
    if (consecutive >= SIGNIN_HUMAN_CHECK_AFTER || !global.ok) {
      await assertHumanTicket(ctx, humanTicket, 'signin')
    }
    return null
  },
})

/** Count a failure (and spend the limits), or clear the count on success. */
export const recordPasswordSignIn = internalMutation({
  args: { email: v.string(), ok: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { email, ok }) => {
    const key = normalizeEmail(email)
    const row = await ctx.db
      .query('signInFailures')
      .withIndex('by_email', (q) => q.eq('email', key))
      .unique()
    if (ok) {
      if (row) await ctx.db.delete(row._id)
      return null
    }
    const now = Date.now()
    await rateLimiter.limit(ctx, 'signInFailPerEmail', { key })
    await rateLimiter.limit(ctx, 'signInFailGlobal')
    if (!row) {
      await ctx.db.insert('signInFailures', { email: key, count: 1, lastFailedAt: now })
    } else {
      const count = now - row.lastFailedAt < FAILURE_MEMORY_MS ? row.count + 1 : 1
      await ctx.db.patch(row._id, { count, lastFailedAt: now })
    }
    return null
  },
})
