import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { listForCompany } from './lib/tenancy'
import { tenantScope } from './lib/scope'
import { requireMember } from './lib/permissions'

type AuditFilters = {
  tableName?: string
  userId?: Id<'users'>
  actionType?: string
  recordId?: string
  dateFrom?: number
  dateTo?: number
}

/** Most audit rows a single filtered read examines before it stops. */
const AUDIT_SCAN_LIMIT = 5000

/**
 * Newest-first audit query for the caller's scope, using the tightest index:
 * company + table (`by_company_and_tableName`), the user (`by_user`), or the
 * company (`by_company`). Date filters are ranges on `_creationTime`, the
 * implicit last field of every index. Returns null when the caller has no
 * scope. Company-less super_admins get the platform view (by_table / by_user /
 * creation time).
 */
function auditQuery(ctx: QueryCtx, user: Doc<'users'>, f: AuditFilters) {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return null
  const range = (q: any) => {
    let r = q
    if (f.dateFrom) r = r.gte('_creationTime', f.dateFrom)
    if (f.dateTo) r = r.lte('_creationTime', f.dateTo)
    return r
  }
  const logs = ctx.db.query('auditLogs')
  if (scope.kind === 'company') {
    if (f.tableName) {
      return logs
        .withIndex('by_company_and_tableName', (q) =>
          range(q.eq('companyId', scope.companyId).eq('tableName', f.tableName!)),
        )
        .order('desc')
    }
    if (f.userId) {
      return logs
        .withIndex('by_user', (q) => range(q.eq('userId', f.userId!)))
        .order('desc')
    }
    return logs
      .withIndex('by_company', (q) => range(q.eq('companyId', scope.companyId)))
      .order('desc')
  }
  if (f.tableName) {
    return logs
      .withIndex('by_table', (q) => range(q.eq('tableName', f.tableName!)))
      .order('desc')
  }
  if (f.userId) {
    return logs.withIndex('by_user', (q) => range(q.eq('userId', f.userId!))).order('desc')
  }
  return logs.withIndex('by_creation_time', (q) => range(q)).order('desc')
}

function matches(user: Doc<'users'>, f: AuditFilters, log: Doc<'auditLogs'>) {
  const scope = tenantScope(user)
  if (scope.kind === 'company' && log.companyId !== scope.companyId) return false
  if (f.tableName && log.tableName !== f.tableName) return false
  if (f.userId && log.userId !== f.userId) return false
  if (f.actionType && log.actionType !== f.actionType) return false
  if (f.recordId && log.recordId !== f.recordId) return false
  return true
}

/**
 * Up to `max` matching rows, newest first. Stops after AUDIT_SCAN_LIMIT
 * examined rows so a rare filter cannot read a company's whole history.
 */
async function collectAudit(
  ctx: QueryCtx,
  user: Doc<'users'>,
  f: AuditFilters,
  max: number,
) {
  const q = auditQuery(ctx, user, f)
  if (!q) return []
  const out: Doc<'auditLogs'>[] = []
  let scanned = 0
  for await (const log of q) {
    scanned += 1
    if (matches(user, f, log)) out.push(log)
    if (out.length >= max || scanned >= AUDIT_SCAN_LIMIT) break
  }
  return out
}

function toClient(a: any, userLabel?: string | null) {
  return {
    id: a._id,
    _id: a._id,
    user_id: a.userId,
    user_label: userLabel || null,
    action_type: a.actionType,
    table_name: a.tableName,
    record_id: a.recordId,
    previous_values: a.previousValues,
    new_values: a.newValues,
    company_id: a.companyId,
    created_at: a._creationTime,
  }
}

async function labelForUser(ctx: any, userId: any) {
  if (!userId) return null
  const u = await ctx.db.get(userId)
  if (!u) return String(userId)
  return u.name || u.email || String(userId)
}

export const list = query({
  args: {
    limit: v.optional(v.number()),
    tableName: v.optional(v.string()),
    userId: v.optional(v.id('users')),
    actionType: v.optional(v.string()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    const maxRows = Math.min(args.limit ?? 200, 500)
    const { limit: _limit, ...filters } = args
    const auditLogs = await collectAudit(ctx, user, filters, maxRows)

    const out = []
    for (const log of auditLogs) {
      out.push(toClient(log, await labelForUser(ctx, log.userId)))
    }
    return out
  },
})

/**
 * Paginated audit log (PLAT-001), newest first, same filters as `list`.
 * `tableName`, `userId` and the date range are index reads; `actionType`
 * filters each page, so a page can come back short.
 */
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    tableName: v.optional(v.string()),
    userId: v.optional(v.id('users')),
    actionType: v.optional(v.string()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })
    const { paginationOpts, ...filters } = args
    const q = auditQuery(ctx, user, filters)
    if (!q) return { page: [], isDone: true, continueCursor: '' }
    const result = await q.paginate(paginationOpts)
    const page = []
    for (const log of result.page) {
      if (!matches(user, filters, log)) continue
      page.push(toClient(log, await labelForUser(ctx, log.userId)))
    }
    return { ...result, page }
  },
})

export const getByTable = query({
  args: {
    tableName: v.string(),
    recordId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    const maxRows = Math.min(args.limit ?? 100, 300)
    // Company + table index: another tenant's audit volume no longer pushes
    // this company's rows out of the window.
    const auditLogs = await collectAudit(
      ctx,
      user,
      { tableName: args.tableName, recordId: args.recordId },
      maxRows,
    )

    const out = []
    for (const log of auditLogs) {
      out.push(toClient(log, await labelForUser(ctx, log.userId)))
    }
    return out
  },
})

export const getByUser = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    const maxRows = Math.min(args.limit ?? 100, 300)
    let auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(maxRows)

    auditLogs = await listForCompany(user, auditLogs)

    const label = await labelForUser(ctx, args.userId)
    return auditLogs
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, maxRows)
      .map((log) => toClient(log, label))
  },
})

export const getSummary = query({
  args: {
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    // Newest 2000 rows of the company in the date range (index range).
    const auditLogs = await collectAudit(
      ctx,
      user,
      { dateFrom: args.dateFrom, dateTo: args.dateTo },
      2000,
    )


    const actionTypeCounts: Record<string, number> = {}
    const tableNameCounts: Record<string, number> = {}
    const userCounts: Record<string, number> = {}

    auditLogs.forEach((log) => {
      actionTypeCounts[log.actionType] = (actionTypeCounts[log.actionType] || 0) + 1
      tableNameCounts[log.tableName] = (tableNameCounts[log.tableName] || 0) + 1
      if (log.userId) {
        userCounts[log.userId] = (userCounts[log.userId] || 0) + 1
      }
    })

    const topUsers = []
    for (const [userId, count] of Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)) {
      topUsers.push({
        userId,
        count,
        label: await labelForUser(ctx, userId),
      })
    }

    return {
      total_logs: auditLogs.length,
      date_range: {
        from: args.dateFrom || null,
        to: args.dateTo || null,
      },
      action_types: actionTypeCounts,
      table_names: tableNameCounts,
      top_users: topUsers,
    }
  },
})
