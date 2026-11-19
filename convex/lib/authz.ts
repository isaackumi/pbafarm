import { getAuthSessionId, getAuthUserId } from '@convex-dev/auth/server'
import { QueryCtx, MutationCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'
import { AUTH_ERROR_MESSAGES } from './authErrors'
import { getMembership } from './memberships'
import { actingUser, isMutationCtx, liveActAsSession, markAudited } from './actAs'
import { insertAuditLog } from './auditChain'
import { userError } from './errors'
import { phoneLoginOffered, securityPolicy } from '../messaging/policy'

export {
  AUTH_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  SIGN_OUT_CODES,
  authErrorCode,
} from './authErrors'

type Ctx = QueryCtx | MutationCtx

/**
 * The signed-in user, refused when they may not use tenant APIs:
 * - deactivated (`active === false`)                  → USER_INACTIVE
 * - temporary password not yet changed                → PASSWORD_CHANGE_REQUIRED
 *   (users.current and userAccounts.changePassword do not call this)
 * - member of a company that is not approved
 *   (pending, rejected, removed or missing); super_admin excepted
 *                                                     → COMPANY_NOT_APPROVED
 * - membership row for the active company not active   → NOT_A_MEMBER
 * - company suspended by the platform or by billing
 *   (companies.suspendedAt, PLAT-104); super_admin
 *   excepted; `allowSuspended` lets the billing page
 *   and users.current through                          → TENANT_SUSPENDED
 * - company requires two-step verification, the user
 *   turned on an authenticator app (ENT-003), or the
 *   user is a super_admin (with or without a company),
 *   and this session is not verified                   → MFA_REQUIRED
 *   (users.current, the mfa.* functions and sign-out pass `allowPendingMfa`)
 * Company-less users pass here; the tenancy helpers give them no data.
 *
 * Support access (ENT-006, lib/actAs.ts): a super_admin with a live act-as
 * session gets back a tenant-admin view of themselves in that organization.
 * A read-only session refuses every mutation (ACT_AS_READ_ONLY) unless the
 * caller passes `allowActAsReadOnly` (read-like mutations: download links);
 * a write session audits each mutation once under the organization.
 * `ignoreActAs` returns the real account (the actAs.* functions).
 */
export async function requireUser(
  ctx: Ctx,
  opts: {
    allowPendingMfa?: boolean
    allowActAsReadOnly?: boolean
    ignoreActAs?: boolean
    allowSuspended?: boolean
  } = {},
): Promise<Doc<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    throw new Error('Not authenticated')
  }
  const user = await ctx.db.get(userId)
  if (!user) {
    throw new Error('User not found')
  }
  if (user.active === false) {
    throw new Error(AUTH_ERROR_MESSAGES.USER_INACTIVE)
  }
  if (user.mustChangePassword === true) {
    throw new Error(AUTH_ERROR_MESSAGES.PASSWORD_CHANGE_REQUIRED)
  }
  let company: Doc<'companies'> | null = null
  if (user.companyId) {
    company = await ctx.db.get(user.companyId)
    if ((user.role ?? 'user') !== 'super_admin' && (!company || company.status !== 'approved')) {
      throw new Error(AUTH_ERROR_MESSAGES.COMPANY_NOT_APPROVED)
    }
    if ((user.role ?? 'user') !== 'super_admin' && company?.suspendedAt !== undefined && !opts.allowSuspended) {
      throw new Error(AUTH_ERROR_MESSAGES.TENANT_SUSPENDED)
    }
    // Membership dual-read (M2): a row for the active organization must be
    // active; without a row, users.companyId + users.role still decide.
    if ((user.role ?? 'user') !== 'super_admin') {
      const membership = await getMembership(ctx, user._id, user.companyId)
      if (membership && membership.status !== 'active') {
        throw new Error(AUTH_ERROR_MESSAGES.NOT_A_MEMBER)
      }
    }
  }
  if (!opts.allowPendingMfa && mfaPolicyApplies(user, company) && !(await sessionMfaVerified(ctx, user))) {
    throw new Error(AUTH_ERROR_MESSAGES.MFA_REQUIRED)
  }
  if ((user.role ?? 'user') === 'super_admin' && !opts.ignoreActAs) {
    const session = await liveActAsSession(ctx, user._id, Date.now())
    if (session) {
      if (isMutationCtx(ctx)) {
        if (!session.allowWrites && !opts.allowActAsReadOnly) {
          throw userError('FORBIDDEN', 'Support access is read-only. Start a new session with changes allowed.', {
            reason: 'ACT_AS_READ_ONLY',
          })
        }
        if (session.allowWrites && markAudited(ctx)) {
          await insertAuditLog(ctx, {
            userId: user._id,
            companyId: session.companyId,
            actAsSessionId: session._id,
            actionType: 'act_as_mutation',
            tableName: 'actAsSessions',
            recordId: session._id,
          })
        }
      }
      return await actingUser(ctx, user, session)
    }
  }
  return user
}

/**
 * Whether every sign-in session of this user must pass two-step verification:
 * the active company requires it, the user turned on an authenticator app, or
 * the user is a super_admin (platform access always needs a second factor; a
 * super_admin without one is sent to /verify to set up an authenticator app).
 */
export function mfaPolicyApplies(
  user: Pick<Doc<'users'>, 'role' | 'totpEnabledAt'>,
  company: Pick<Doc<'companies'>, 'settings'> | null,
): boolean {
  return (
    (user.role ?? 'user') === 'super_admin' ||
    user.totpEnabledAt !== undefined ||
    company?.settings?.security?.require2fa === true
  )
}

/**
 * Whether a verified mfaSessions row counts for the given organization.
 * The row is bound to the organization whose policy accepted it (ORG-002):
 * - same organization (or both platform scope:
 *   no organization)                         → counts
 * - totp / recovery_code / otp (a code from the
 *   user's own app or own phone)             → counts anywhere
 * - phone_login                              → only where that organization
 *   also offers phone sign-in as the second step (never for platform scope)
 * - policy_enable (or no method)             → never elsewhere
 */
export async function mfaRowCountsFor(
  ctx: Ctx,
  row: Pick<Doc<'mfaSessions'>, 'companyId' | 'method' | 'verifiedAt'>,
  companyId: Id<'companies'> | undefined,
): Promise<boolean> {
  if (row.verifiedAt === undefined) return false
  if (row.companyId === companyId) return true
  switch (row.method) {
    case 'totp':
    case 'recovery_code':
    case 'otp':
      return true
    case 'phone_login': {
      if (!companyId) return false
      const policy = securityPolicy(await ctx.db.get(companyId))
      return phoneLoginOffered(policy) && policy.phoneLoginSatisfies2fa
    }
    default:
      return false
  }
}

/**
 * Whether the caller's current sign-in session passed two-step verification
 * in a way the user's active organization accepts (see mfaRowCountsFor).
 */
export async function sessionMfaVerified(
  ctx: Ctx,
  user: Pick<Doc<'users'>, '_id' | 'companyId'>,
): Promise<boolean> {
  const sessionId = await getAuthSessionId(ctx)
  if (!sessionId) return false
  const row = await ctx.db
    .query('mfaSessions')
    .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
    .first()
  if (!row || row.userId !== user._id) return false
  return await mfaRowCountsFor(ctx, row, user.companyId)
}

/** Delete every session (and its refresh tokens) of a user, signing them out everywhere. */
export async function revokeUserSessions(
  ctx: MutationCtx,
  userId: Id<'users'>,
): Promise<number> {
  const sessions = await ctx.db
    .query('authSessions')
    .withIndex('userId', (q) => q.eq('userId', userId))
    .collect()
  for (const session of sessions) {
    const tokens = await ctx.db
      .query('authRefreshTokens')
      .withIndex('sessionId', (q) => q.eq('sessionId', session._id))
      .collect()
    for (const token of tokens) {
      await ctx.db.delete(token._id)
    }
    await ctx.db.delete(session._id)
  }
  // Signing out everywhere also unlinks chat bots, which act without a web session.
  const bindings = await ctx.db
    .query('channelBindings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(50)
  for (const b of bindings) {
    if (!b.revokedAt) {
      await ctx.db.patch(b._id, { revokedAt: Date.now(), revokedReason: 'sessions_revoked', reminderEnabled: false })
    }
  }
  return sessions.length
}

export function requireRole(
  user: Doc<'users'>,
  role: 'user' | 'admin' | 'super_admin',
) {
  const current = user.role ?? 'user'
  if (current === 'super_admin') return
  if (current === 'admin' && role !== 'super_admin') return
  if (current === role) return
  throw new Error('Insufficient permissions')
}

export function assertCompanyAccess(
  user: Doc<'users'>,
  companyId: Id<'companies'> | undefined,
) {
  if ((user.role ?? 'user') === 'super_admin') return
  if (!companyId || user.companyId !== companyId) {
    throw new Error('Company access denied')
  }
}
