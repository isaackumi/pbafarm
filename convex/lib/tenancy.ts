import { requireUser } from './authz'
import { MutationCtx, QueryCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

/** Users without companyId (greenfield solo farms) see all unscoped rows + their own. */
export function companyFilter(user: Doc<'users'>) {
  return user.companyId
}

export async function listForCompany<T extends { companyId?: Id<'companies'> }>(
  user: Doc<'users'>,
  rows: T[],
): Promise<T[]> {
  if ((user.role ?? 'user') === 'super_admin') return rows
  if (!user.companyId) {
    return rows.filter((r) => !r.companyId)
  }
  return rows.filter((r) => r.companyId === user.companyId)
}

export async function writeCompanyId(user: Doc<'users'>) {
  return user.companyId
}

export async function logAudit(
  ctx: MutationCtx,
  args: {
    actionType: string
    tableName: string
    recordId?: string
    previousValues?: unknown
    newValues?: unknown
  },
) {
  const user = await requireUser(ctx)
  await ctx.db.insert('auditLogs', {
    userId: user._id,
    actionType: args.actionType,
    tableName: args.tableName,
    recordId: args.recordId,
    previousValues: args.previousValues,
    newValues: args.newValues,
    companyId: user.companyId,
  })
}
