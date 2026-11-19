/** Platform admins (super_admins) management (PLAT-112). */
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireConsoleAdmin } from './access'
import { userError } from '../lib/errors'
import { getMembership } from '../lib/memberships'
import { recordPlatformEvent } from '../billing/ops'

const USER_SCAN_CAP = 8000

async function superAdmins(ctx: QueryCtx): Promise<{ admins: Doc<'users'>[]; truncated: boolean }> {
  const admins: Doc<'users'>[] = []
  let scanned = 0
  for await (const u of ctx.db.query('users')) {
    if (u.role === 'super_admin') admins.push(u)
    if (++scanned >= USER_SCAN_CAP) return { admins, truncated: true }
  }
  return { admins, truncated: false }
}

export const list = query({
  args: {},
  returns: v.object({
    admins: v.array(
      v.object({
        userId: v.id('users'),
        name: v.union(v.string(), v.null()),
        email: v.union(v.string(), v.null()),
        active: v.boolean(),
        authenticatorApp: v.boolean(),
        isYou: v.boolean(),
      }),
    ),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const me = await requireConsoleAdmin(ctx)
    const { admins, truncated } = await superAdmins(ctx)
    return {
      admins: admins.map((u) => ({
        userId: u._id,
        name: u.name ?? null,
        email: u.email ?? null,
        active: u.active !== false,
        authenticatorApp: u.totpEnabledAt !== undefined,
        isYou: u._id === me._id,
      })),
      truncated,
    }
  },
})

/** Make an existing account a platform admin. They must pass two-step verification at their next sign-in. */
export const promote = mutation({
  args: { email: v.string() },
  returns: v.id('users'),
  handler: async (ctx, { email }) => {
    const admin = await requireConsoleAdmin(ctx)
    const normalized = email.trim().toLowerCase()
    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', normalized))
      .unique()
    if (!user) throw userError('NOT_FOUND', 'No account with that email. They must sign up first.', { field: 'email' })
    if (user.role === 'super_admin') throw userError('CONFLICT', 'Already a platform admin')
    if (user.active === false) throw userError('CONFLICT', 'That account is deactivated')
    await ctx.db.patch(user._id, { role: 'super_admin' })
    await recordPlatformEvent(
      ctx,
      { actorId: admin._id, action: 'admin.promoted', targetTable: 'users', targetId: user._id, details: { email: normalized, previousRole: user.role ?? 'user' } },
      { orgAudit: false },
    )
    return user._id
  },
})

/** Remove platform admin rights: back to the role their organization membership gives. */
export const demote = mutation({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const admin = await requireConsoleAdmin(ctx)
    if (userId === admin._id) throw userError('CONFLICT', 'You cannot remove your own platform access')
    const user = await ctx.db.get(userId)
    if (!user || user.role !== 'super_admin') throw userError('NOT_FOUND', 'Not a platform admin')
    const { admins } = await superAdmins(ctx)
    if (admins.filter((a) => a.active !== false).length <= 1) throw userError('CONFLICT', 'Keep at least one platform admin')
    const membership = user.companyId ? await getMembership(ctx, user._id, user.companyId) : null
    const role = membership && (membership.roleKey === 'owner' || membership.roleKey === 'admin') ? 'admin' : 'user'
    await ctx.db.patch(userId, { role })
    await recordPlatformEvent(
      ctx,
      { actorId: admin._id, action: 'admin.demoted', targetTable: 'users', targetId: userId, details: { email: user.email ?? null, newRole: role } },
      { orgAudit: false },
    )
    return null
  },
})
