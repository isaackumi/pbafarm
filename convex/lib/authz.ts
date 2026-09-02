import { getAuthUserId } from '@convex-dev/auth/server'
import { QueryCtx, MutationCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

export async function requireUser(ctx: Ctx): Promise<Doc<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    throw new Error('Not authenticated')
  }
  const user = await ctx.db.get(userId)
  if (!user) {
    throw new Error('User not found')
  }
  return user
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
