import { getAuthUserId } from '@convex-dev/auth/server'
import { QueryCtx, MutationCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'
import { AUTH_ERROR_MESSAGES } from './authErrors'

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
 * Company-less users pass here; the tenancy helpers give them no data.
 */
export async function requireUser(ctx: Ctx): Promise<Doc<'users'>> {
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
  if (user.companyId && (user.role ?? 'user') !== 'super_admin') {
    const company = await ctx.db.get(user.companyId)
    if (!company || company.status !== 'approved') {
      throw new Error(AUTH_ERROR_MESSAGES.COMPANY_NOT_APPROVED)
    }
  }
  return user
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
