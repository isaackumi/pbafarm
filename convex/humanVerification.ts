/**
 * Human checks for public forms (CF-003): sign-up, company registration,
 * password reset and invite acceptance.
 *
 * The browser solves a Turnstile widget and sends its token to `verify`.
 * The action checks it with Cloudflare (lib/turnstile.ts) and returns a
 * single-use ticket for that purpose, valid five minutes. The protected
 * mutation (or the Password provider) then calls `assertHumanTicket`, which
 * consumes it. Only a SHA-256 of the ticket is stored.
 *
 * A sign-up ticket stays reusable for the same email for a few minutes after
 * use (a failed sign-up need not redo the widget), and password sign-in asks
 * for a `signin` ticket after repeated failures (authGuard.ts).
 *
 * With TURNSTILE_SECRET_KEY unset the whole check is off: `verify` returns
 * `{ ticket: null }` and `assertHumanTicket` accepts anything.
 */
import * as Effect from 'effect/Effect'
import { v } from 'convex/values'
import { action, internalMutation, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import { FetchLive } from './lib/effectHttp'
import { runEffect } from './lib/effect'
import { sha256Hex, toBase64 } from './lib/crypto'
import { userError } from './lib/errors'
import {
  HUMAN_GRANT_MAX_USES,
  HUMAN_GRANT_TTL_MS,
  HUMAN_PURPOSES,
  HUMAN_TICKET_TTL_MS,
  allowedHostnames,
  siteverify,
  turnstileSecret,
  turnstileRequired,
  type HumanPurpose,
} from './lib/turnstile'

export const humanPurpose = v.union(...HUMAN_PURPOSES.map((p) => v.literal(p)))

function newTicket(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const ticketHash = (ticket: string) => sha256Hex(`human-ticket:${ticket}`)

/** Exchange a Turnstile token for a ticket the protected call will consume. */
export const verify = action({
  args: { token: v.string(), purpose: humanPurpose },
  returns: v.object({ ticket: v.union(v.string(), v.null()) }),
  handler: async (ctx, { token, purpose }) => {
    const secret = turnstileSecret()
    if (!secret) return { ticket: null }
    const ticket = newTicket()
    const hash = await ticketHash(ticket)
    await runEffect(
      siteverify({
        secret,
        token,
        expectedAction: purpose,
        allowedHostnames: allowedHostnames(),
        idempotencyKey: crypto.randomUUID(),
      }).pipe(Effect.provide(FetchLive)),
      {
        toUserError: (e) => userError('RATE_LIMITED', 'The human check is unavailable right now. Try again shortly.', {
          reason: 'TURNSTILE_UNAVAILABLE',
          detail: e.message,
        }),
      },
    )
    await ctx.runMutation(internal.humanVerification.storeTicket, { ticketHash: hash, purpose })
    return { ticket }
  },
})

export const storeTicket = internalMutation({
  args: { ticketHash: v.string(), purpose: humanPurpose },
  returns: v.null(),
  handler: async (ctx, { ticketHash, purpose }) => {
    const now = Date.now()
    // Opportunistic prune of tickets nobody used.
    const stale = await ctx.db
      .query('humanTickets')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(50)
    for (const row of stale) await ctx.db.delete(row._id)
    await ctx.db.insert('humanTickets', { ticketHash, purpose, expiresAt: now + HUMAN_TICKET_TTL_MS })
    return null
  },
})

/**
 * Refuse unless `ticket` is a live, unused ticket for `purpose`, and use it
 * up. No-op when Turnstile is not configured.
 *
 * `grantEmail` (sign-up): using the ticket also opens a short grant bound to
 * that email, so if the sign-up then fails (validation, weak password) the
 * browser can resend the same ticket for the same email instead of solving
 * the widget again (HUMAN_GRANT_TTL_MS, at most HUMAN_GRANT_MAX_USES).
 */
export async function assertHumanTicket(
  ctx: MutationCtx,
  ticket: string | undefined | null,
  purpose: HumanPurpose,
  opts: { grantEmail?: string } = {},
): Promise<void> {
  if (!turnstileRequired()) return
  const refuse = () =>
    userError('FORBIDDEN', 'Please complete the human check and try again.', { reason: 'HUMAN_CHECK_REQUIRED' })
  if (!ticket || ticket.length > 200) throw refuse()
  const hash = await ticketHash(ticket)
  const row = await ctx.db
    .query('humanTickets')
    .withIndex('by_ticketHash', (q) => q.eq('ticketHash', hash))
    .unique()
  const now = Date.now()
  if (!row || row.purpose !== purpose) throw refuse()
  const grantEmail = opts.grantEmail?.trim().toLowerCase() || undefined
  if (row.usedAt === undefined && row.expiresAt > now) {
    if (!grantEmail) {
      await ctx.db.patch(row._id, { usedAt: now })
      return
    }
    const grantExpiresAt = now + HUMAN_GRANT_TTL_MS
    // expiresAt follows the grant so the opportunistic prune keeps the row.
    await ctx.db.patch(row._id, { usedAt: now, grantEmail, grantExpiresAt, grantUses: 0, expiresAt: grantExpiresAt })
    return
  }
  if (
    grantEmail &&
    row.grantEmail === grantEmail &&
    (row.grantExpiresAt ?? 0) > now &&
    (row.grantUses ?? 0) < HUMAN_GRANT_MAX_USES
  ) {
    await ctx.db.patch(row._id, { grantUses: (row.grantUses ?? 0) + 1 })
    return
  }
  throw refuse()
}

/** Used by the Password provider (an action ctx) for sign-up and reset. */
export const consumeTicket = internalMutation({
  args: { ticket: v.optional(v.string()), purpose: humanPurpose, email: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { ticket, purpose, email }) => {
    await assertHumanTicket(ctx, ticket, purpose, { grantEmail: purpose === 'signup' ? email : undefined })
    return null
  },
})
