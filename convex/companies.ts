import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { logAudit } from './lib/tenancy'

function toClient(c: any) {
  return {
    id: c._id,
    _id: c._id,
    name: c.name,
    code: c.code,
    address: c.address,
    contact_email: c.contactEmail,
    status: c.status,
    rejection_reason: c.rejectionReason,
    created_at: c.createdAt,
    approved_at: c.approvedAt,
    approved_by: c.approvedBy,
  }
}

export const register = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    
    // Check if company code already exists
    const existingByCode = await ctx.db
      .query('companies')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .first()
    if (existingByCode) {
      throw new Error('Company code already exists')
    }

    // User should not already belong to a company
    if (user.companyId) {
      throw new Error('User already belongs to a company')
    }

    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: args.name,
      code: args.code,
      address: args.address,
      contactEmail: args.contactEmail || user.email,
      status: 'pending',
      createdAt: now,
    })

    // Note: We don't set user.companyId yet - that happens on approval
    // Store the requesting user's email in contactEmail if not provided
    if (!args.contactEmail && user.email) {
      await ctx.db.patch(companyId, {
        contactEmail: user.email,
      })
    }

    await logAudit(ctx, {
      actionType: 'register',
      tableName: 'companies',
      recordId: companyId,
      newValues: { ...args, requestedByUserId: user._id },
    })

    return companyId
  },
})

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    const pending = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .collect()
    
    return pending.map(toClient).sort((a, b) => b.created_at - a.created_at)
  },
})

export const approve = mutation({
  args: {
    companyId: v.id('companies'),
    userId: v.id('users'), // User to promote to admin
  },
  handler: async (ctx, { companyId, userId }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')
    
    if (company.status !== 'pending') {
      throw new Error('Company is not pending approval')
    }

    const targetUser = await ctx.db.get(userId)
    if (!targetUser) throw new Error('User not found')
    
    if (targetUser.companyId) {
      throw new Error('User already belongs to a company')
    }

    const now = Date.now()

    // Approve the company
    await ctx.db.patch(companyId, {
      status: 'approved',
      approvedAt: now,
      approvedBy: user._id,
    })

    // Set user as admin of the company
    await ctx.db.patch(userId, {
      companyId: companyId,
      role: 'admin',
    })

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'companies',
      recordId: companyId,
      newValues: { 
        status: 'approved',
        promotedUserId: userId,
      },
    })

    return { companyId, userId }
  },
})

export const reject = mutation({
  args: {
    companyId: v.id('companies'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, reason }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')
    
    if (company.status !== 'pending') {
      throw new Error('Company is not pending approval')
    }

    await ctx.db.patch(companyId, {
      status: 'rejected',
      rejectionReason: reason,
      approvedAt: Date.now(),
      approvedBy: user._id,
    })

    await logAudit(ctx, {
      actionType: 'reject',
      tableName: 'companies',
      recordId: companyId,
      newValues: { 
        status: 'rejected',
        reason,
      },
    })
  },
})

export const list = query({
  args: { status: v.optional(v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'))) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    let companies = await ctx.db.query('companies').collect()
    
    if (args.status) {
      companies = companies.filter((c) => c.status === args.status)
    }
    
    return companies.map(toClient).sort((a, b) => b.created_at - a.created_at)
  },
})

export const get = query({
  args: { id: v.id('companies') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const company = await ctx.db.get(id)
    if (!company) return null
    
    // Super admins can see all, others can only see their own company
    if (user.role !== 'super_admin' && user.companyId !== id) {
      throw new Error('Access denied')
    }
    
    return toClient(company)
  },
})

export const updateSettings = mutation({
  args: {
    id: v.id('companies'),
    patch: v.object({
      name: v.optional(v.string()),
      address: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const company = await ctx.db.get(id)
    if (!company) throw new Error('Company not found')
    
    // Only super admins or company admins can update
    if (user.role !== 'super_admin' && (user.companyId !== id || user.role !== 'admin')) {
      throw new Error('Access denied')
    }
    
    const existing = { ...company }
    await ctx.db.patch(id, patch)
    
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'companies',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    
    return id
  },
})

export const getCurrentCompany = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if (!user.companyId) return null
    
    const company = await ctx.db.get(user.companyId)
    if (!company) return null
    
    return toClient(company)
  },
})