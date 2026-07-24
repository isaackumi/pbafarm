import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { listForCompany } from './lib/tenancy'

function toClient(a: any) {
  return {
    id: a._id,
    _id: a._id,
    user_id: a.userId,
    action_type: a.actionType,
    table_name: a.tableName,
    record_id: a.recordId,
    previous_values: a.previousValues,
    new_values: a.newValues,
    company_id: a.companyId,
    created_at: a._creationTime,
  }
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
    requireRole(user, 'admin') // Only admins and super_admins can view audit logs
    
    let auditLogs = await ctx.db.query('auditLogs').collect()
    auditLogs = await listForCompany(user, auditLogs)
    
    // Apply filters
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
    
    // Sort by creation time descending (newest first)
    auditLogs = auditLogs.sort((a, b) => b._creationTime - a._creationTime)
    
    // Apply limit
    if (args.limit) {
      auditLogs = auditLogs.slice(0, args.limit)
    }
    
    return auditLogs.map(toClient)
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
    
    let auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_table', (q) => q.eq('tableName', args.tableName))
      .collect()
    
    auditLogs = await listForCompany(user, auditLogs)
    
    if (args.recordId) {
      auditLogs = auditLogs.filter((log) => log.recordId === args.recordId)
    }
    
    // Sort by creation time descending
    auditLogs = auditLogs.sort((a, b) => b._creationTime - a._creationTime)
    
    if (args.limit) {
      auditLogs = auditLogs.slice(0, args.limit)
    }
    
    return auditLogs.map(toClient)
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
    
    let auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect()
    
    auditLogs = await listForCompany(user, auditLogs)
    
    // Sort by creation time descending
    auditLogs = auditLogs.sort((a, b) => b._creationTime - a._creationTime)
    
    if (args.limit) {
      auditLogs = auditLogs.slice(0, args.limit)
    }
    
    return auditLogs.map(toClient)
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
    
    let auditLogs = await ctx.db.query('auditLogs').collect()
    auditLogs = await listForCompany(user, auditLogs)
    
    // Apply date filters
    if (args.dateFrom) {
      auditLogs = auditLogs.filter((log) => log._creationTime >= args.dateFrom!)
    }
    
    if (args.dateTo) {
      auditLogs = auditLogs.filter((log) => log._creationTime <= args.dateTo!)
    }
    
    // Group by action type
    const actionTypeCounts: Record<string, number> = {}
    auditLogs.forEach((log) => {
      actionTypeCounts[log.actionType] = (actionTypeCounts[log.actionType] || 0) + 1
    })
    
    // Group by table name
    const tableNameCounts: Record<string, number> = {}
    auditLogs.forEach((log) => {
      tableNameCounts[log.tableName] = (tableNameCounts[log.tableName] || 0) + 1
    })
    
    // Group by user
    const userCounts: Record<string, number> = {}
    auditLogs.forEach((log) => {
      if (log.userId) {
        userCounts[log.userId] = (userCounts[log.userId] || 0) + 1
      }
    })
    
    // Get most active users (top 5)
    const topUsers = Object.entries(userCounts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    
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