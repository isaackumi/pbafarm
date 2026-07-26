import { getAuthUserId } from '@convex-dev/auth/server'
import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import { requireUser, requireRole } from './lib/authz'
import { logAudit } from './lib/tenancy'

function toClient(u: any) {
  return {
    id: u._id,
    _id: u._id,
    name: u.name,
    email: u.email,
    role: u.role ?? 'user',
    companyId: u.companyId,
    company_id: u.companyId,
    phone: u.phone,
    image: u.image,
  }
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    if (!user) return null
    // Keep raw Convex fields for AuthContext + add client aliases
    return { ...user, ...toClient(user), role: user.role ?? 'user' }
  },
})

export const get = query({
  args: { id: v.id('users') },
  handler: async (ctx, { id }) => {
    const me = await requireUser(ctx)
    const user = await ctx.db.get(id)
    if (!user) return null
    if ((me.role ?? 'user') === 'super_admin') return toClient(user)
    if (me.companyId && user.companyId === me.companyId) return toClient(user)
    if (me._id === id) return toClient(user)
    throw new Error('Access denied')
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    let users = await ctx.db.query('users').collect()
    if ((me.role ?? 'user') !== 'super_admin') {
      users = users.filter((u) => u.companyId && u.companyId === me.companyId)
    }
    return users.map(toClient).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
  },
})

export const update = mutation({
  args: {
    id: v.id('users'),
    patch: v.object({
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      role: v.optional(
        v.union(v.literal('user'), v.literal('admin'), v.literal('super_admin')),
      ),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    const target = await ctx.db.get(id)
    if (!target) throw new Error('User not found')

    if ((me.role ?? 'user') !== 'super_admin') {
      if (!me.companyId || target.companyId !== me.companyId) {
        throw new Error('Access denied')
      }
      if (patch.role === 'super_admin') {
        throw new Error('Only super_admin can grant super_admin')
      }
    }

    await ctx.db.patch(id, patch)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'users',
      recordId: id,
      previousValues: { role: target.role, name: target.name },
      newValues: patch,
    })
    return id
  },
})

/** Dev/bootstrap: promote a user to super_admin by email after first signup. */
export const promoteToSuperAdmin = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .unique()
    if (!user) {
      throw new Error(`No user found for email: ${email}`)
    }
    await ctx.db.patch(user._id, { role: 'super_admin' })
    return user._id
  },
})
