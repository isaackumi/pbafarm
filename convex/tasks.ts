import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { logAudit } from './lib/tenancy'
import { can, memberContext, requireAccount, requireMember } from './lib/permissions'

/**
 * Simple tasks (AUTO-005): title, assignee, due date, optional cage, status.
 * Automation rules create them (`create_task` action); admins can assign one
 * by hand; assignees close their own.
 */

const statusV = v.union(v.literal('open'), v.literal('done'), v.literal('cancelled'))

/** The caller's tasks: open ones first by due date, then recently closed. */
export const mine = query({
  args: { includeClosed: v.optional(v.boolean()) },
  handler: async (ctx, { includeClosed }) => {
    const user = await requireAccount(ctx)
    const open = await ctx.db
      .query('tasks')
      .withIndex('by_assignee_and_status', (q) => q.eq('assigneeUserId', user._id).eq('status', 'open'))
      .take(200)
    open.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt - b.createdAt)
    const closed = includeClosed
      ? await ctx.db
          .query('tasks')
          .withIndex('by_assignee_and_status', (q) => q.eq('assigneeUserId', user._id).eq('status', 'done'))
          .order('desc')
          .take(30)
      : []
    const cageNames = new Map<string, string>()
    for (const t of [...open, ...closed]) {
      if (t.cageId && !cageNames.has(String(t.cageId))) {
        const cage = await ctx.db.get(t.cageId)
        cageNames.set(String(t.cageId), cage?.companyId === t.companyId ? cage.name : '')
      }
    }
    const shape = (t: (typeof open)[number]) => ({
      ...t,
      cageName: t.cageId ? cageNames.get(String(t.cageId)) || undefined : undefined,
    })
    return { open: open.map(shape), closed: closed.map(shape) }
  },
})

/** Open task count for the caller (nav badge). */
export const openCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_assignee_and_status', (q) => q.eq('assigneeUserId', user._id).eq('status', 'open'))
      .take(100)
    return rows.length
  },
})

export const setStatus = mutation({
  args: { taskId: v.id('tasks'), status: statusV },
  returns: v.null(),
  handler: async (ctx, { taskId, status }) => {
    const user = await requireAccount(ctx)
    const task = await ctx.db.get(taskId)
    if (!task || task.companyId !== user.companyId) throw new Error('Task not found')
    const isAdmin = can(await memberContext(ctx, user), 'automation.manage')
    if (task.assigneeUserId !== user._id && !isAdmin) throw new Error('Only the assignee or an admin can update this task')
    const now = Date.now()
    await ctx.db.patch(taskId, {
      status,
      completedBy: status === 'done' ? user._id : undefined,
      completedAt: status === 'done' ? now : undefined,
      updatedAt: now,
    })
    return null
  },
})

/** Admins assign a task by hand. */
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    assigneeUserId: v.id('users'),
    dueDate: v.optional(v.string()),
    cageId: v.optional(v.id('cages')),
  },
  returns: v.id('tasks'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'automation.manage' })
    if (!user.companyId) throw new Error('Your account is not linked to a company')
    const title = args.title.trim()
    if (!title || title.length > 200) throw new Error('Title is required (up to 200 characters)')
    if (args.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) throw new Error('Due date must be YYYY-MM-DD')
    const assignee = await ctx.db.get(args.assigneeUserId)
    if (!assignee || assignee.companyId !== user.companyId) throw new Error('Assignee must be a member of your company')
    if (args.cageId) {
      const cage = await ctx.db.get(args.cageId)
      if (!cage || cage.companyId !== user.companyId) throw new Error('Cage not found')
    }
    const now = Date.now()
    const id = await ctx.db.insert('tasks', {
      companyId: user.companyId,
      title,
      description: args.description?.trim() || undefined,
      assigneeUserId: args.assigneeUserId,
      dueDate: args.dueDate || undefined,
      cageId: args.cageId,
      status: 'open',
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('notifications', {
      userId: args.assigneeUserId,
      title: 'New task',
      message: title,
      type: 'info',
      read: false,
      link: '/tasks',
      companyId: user.companyId,
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'tasks', recordId: id, newValues: { title } })
    return id
  },
})
