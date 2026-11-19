/**
 * Super-admin support access ("act as", ENT-006, doc 07 §3.8, doc 10).
 *
 * A super-admin starts a session for one organization with a reason, a
 * duration (at most ACT_AS_MAX_MINUTES) and an explicit write flag
 * (convex/actAs.ts). While it is live, requireUser returns the admin as a
 * tenant admin of that organization: every tenant helper (companyId filters,
 * assertOwns, writeCompanyId, requireMember) then works on that organization
 * only, and platform-wide super_admin shortcuts are off, so isolation between
 * organizations still holds. Read-only sessions refuse every mutation.
 * Writes are audited under the organization with the real admin's userId and
 * the session id.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

export const ACT_AS_DEFAULT_MINUTES = 30
export const ACT_AS_MAX_MINUTES = 120
export const ACT_AS_MIN_REASON = 10

/** Effective user objects returned during act-as → their session. */
const sessions = new WeakMap<object, Doc<'actAsSessions'>>()

/** The act-as session behind an effective user returned by requireUser, if any. */
export function actAsSessionOf(user: Doc<'users'>): Doc<'actAsSessions'> | undefined {
  return sessions.get(user)
}

/** The admin's live session (not ended, not expired), or null. */
export async function liveActAsSession(
  ctx: Ctx,
  adminUserId: Id<'users'>,
  now: number,
): Promise<Doc<'actAsSessions'> | null> {
  const row = await ctx.db
    .query('actAsSessions')
    .withIndex('by_adminUserId_and_endedAt', (q) => q.eq('adminUserId', adminUserId).eq('endedAt', undefined))
    .order('desc')
    .first()
  if (!row || row.expiresAt <= now) return null
  return row
}

/** Mutations have a scheduler; queries do not. */
export function isMutationCtx(ctx: Ctx): ctx is MutationCtx {
  return 'scheduler' in ctx && !!(ctx as MutationCtx).scheduler
}

/**
 * The admin as a tenant admin of the session's organization. Site defaults to
 * the organization's first active site (the admin's own activeLocationId
 * belongs to another organization).
 */
export async function actingUser(
  ctx: Ctx,
  user: Doc<'users'>,
  session: Doc<'actAsSessions'>,
): Promise<Doc<'users'>> {
  const site = await ctx.db
    .query('farmLocations')
    .withIndex('by_company', (q) => q.eq('companyId', session.companyId))
    .filter((q) => q.neq(q.field('active'), false))
    .first()
  const effective: Doc<'users'> = {
    ...user,
    companyId: session.companyId,
    role: 'admin',
    locationIds: undefined,
    activeLocationId: site?._id,
  }
  sessions.set(effective, session)
  return effective
}

/** Transactions (by db object) already audited as an act-as write. */
const auditedTransactions = new WeakSet<object>()

export function markAudited(ctx: MutationCtx): boolean {
  if (auditedTransactions.has(ctx.db)) return false
  auditedTransactions.add(ctx.db)
  return true
}
