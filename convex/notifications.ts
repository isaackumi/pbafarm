import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser } from './lib/authz'
import { writeCompanyId, logAudit } from './lib/tenancy'

function toClient(n: any) {
  return {
    id: n._id,
    _id: n._id,
    user_id: n.userId,
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    link: n.link,
    company_id: n.companyId,
    created_at: n._creationTime,
  }
}

export const listForCurrentUser = query({
  args: {
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    
    let notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    if (args.unreadOnly) {
      notifications = notifications.filter((n) => !n.read)
    }

    // Sort by creation time descending (newest first)
    notifications = notifications.sort((a, b) => b._creationTime - a._creationTime)

    if (args.limit) {
      notifications = notifications.slice(0, args.limit)
    }

    return notifications.map(toClient)
  },
})

export const getUnreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    
    const unreadNotifications = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', user._id).eq('read', false))
      .collect()

    return unreadNotifications.length
  },
})

export const markRead = mutation({
  args: { id: v.id('notifications') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const notification = await ctx.db.get(id)
    
    if (!notification) throw new Error('Notification not found')
    if (notification.userId !== user._id) throw new Error('Access denied')
    
    if (!notification.read) {
      await ctx.db.patch(id, { read: true })
    }
    
    return id
  },
})

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    
    const unreadNotifications = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', user._id).eq('read', false))
      .collect()

    const updatePromises = unreadNotifications.map((notification) =>
      ctx.db.patch(notification._id, { read: true })
    )
    
    await Promise.all(updatePromises)
    
    return unreadNotifications.length
  },
})

export const create = mutation({
  args: {
    userId: v.id('users'),
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    
    // Get the target user to inherit their company context
    const targetUser = await ctx.db.get(args.userId)
    if (!targetUser) throw new Error('Target user not found')
    
    const id = await ctx.db.insert('notifications', {
      userId: args.userId,
      title: args.title,
      message: args.message,
      type: args.type || 'info',
      read: false,
      link: args.link,
      companyId: targetUser.companyId,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'notifications',
      recordId: id,
      newValues: args,
    })

    return id
  },
})

export const createBulk = mutation({
  args: {
    userIds: v.array(v.id('users')),
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const notificationIds = []
    
    for (const userId of args.userIds) {
      // Get the target user to inherit their company context
      const targetUser = await ctx.db.get(userId)
      if (!targetUser) continue // Skip invalid users
      
      const id = await ctx.db.insert('notifications', {
        userId: userId,
        title: args.title,
        message: args.message,
        type: args.type || 'info',
        read: false,
        link: args.link,
        companyId: targetUser.companyId,
      })
      
      notificationIds.push(id)
    }

    await logAudit(ctx, {
      actionType: 'create_bulk',
      tableName: 'notifications',
      newValues: { ...args, createdCount: notificationIds.length },
    })

    return notificationIds
  },
})

export const deleteNotification = mutation({
  args: { id: v.id('notifications') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const notification = await ctx.db.get(id)
    
    if (!notification) throw new Error('Notification not found')
    if (notification.userId !== user._id) throw new Error('Access denied')
    
    await ctx.db.delete(id)
    
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'notifications',
      recordId: id,
      previousValues: notification,
    })
  },
})