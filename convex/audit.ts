import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { listForCompany } from './lib/tenancy'

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
    const user = await requireUser(ctx)
    requireRole(user, 'admin')

    const maxRows = Math.min(args.limit ?? 200, 500)

    let auditLogs =
      user.companyId && user.role !== 'super_admin'
        ? await ctx.db
            .query('auditLogs')
            .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
            .order('desc')
            .take(maxRows * 3)
        : await ctx.db.query('auditLogs').order('desc').take(maxRows * 3)

    auditLogs = await listForCompany(user, auditLogs)

    if (args.tableName) {
      auditLogs = auditLogs.filter((log) => log.tableName === args.tableName)
    }
    if (args.userId) {
      auditLogs = auditLogs.filter((log) => log.userId === args.userId)
    }
    if (args.actionType) {
      auditLogs = auditLogs.filter((log) => log.actionType === args.actionType)
    }
    if (args.dateFrom) {
      auditLogs = auditLogs.filter((log) => log._creationTime >= args.dateFrom!)
    }
    if (args.dateTo) {
      auditLogs = auditLogs.filter((log) => log._creationTime <= args.dateTo!)
    }

    auditLogs = auditLogs
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, maxRows)

    const out = []
    for (const log of auditLogs) {
      out.push(toClient(log, await labelForUser(ctx, log.userId)))
    }
    return out
  },
})

export const getByTable = query({
  args: {
    tableName: v.string(),
    recordId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')

    const maxRows = Math.min(args.limit ?? 100, 300)
    let auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_table', (q) => q.eq('tableName', args.tableName))
      .order('desc')
      .take(maxRows * 2)

    auditLogs = await listForCompany(user, auditLogs)

    if (args.recordId) {
      auditLogs = auditLogs.filter((log) => log.recordId === args.recordId)
    }

    auditLogs = auditLogs
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, maxRows)

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
    const user = await requireUser(ctx)
    requireRole(user, 'admin')

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
    const user = await requireUser(ctx)
    requireRole(user, 'admin')

    let auditLogs =
      user.companyId && user.role !== 'super_admin'
        ? await ctx.db
            .query('auditLogs')
            .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
            .order('desc')
            .take(2000)
        : await ctx.db.query('auditLogs').order('desc').take(2000)

    auditLogs = await listForCompany(user, auditLogs)

    if (args.dateFrom) {
      auditLogs = auditLogs.filter((log) => log._creationTime >= args.dateFrom!)
    }
    if (args.dateTo) {
      auditLogs = auditLogs.filter((log) => log._creationTime <= args.dateTo!)
    }

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
