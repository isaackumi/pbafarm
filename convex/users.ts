import { getAuthUserId } from '@convex-dev/auth/server'
import { query, mutation, internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'
import { requireUser, requireRole, revokeUserSessions } from './lib/authz'
import { logAudit } from './lib/tenancy'
import { PLATFORM_SCAN_LIMIT } from './lib/scope'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/** Invite rows written before `status` existed are pending. */
function inviteStatus(invite: Doc<'userInvites'>) {
  return invite.status ?? 'pending'
}

/** Audit row for actions whose actor has no company (or no identity at all). */
async function insertAudit(
  ctx: MutationCtx,
  row: {
    userId?: Id<'users'>
    companyId?: Id<'companies'>
    actionType: string
    tableName: string
    recordId?: string
    previousValues?: unknown
    newValues?: unknown
  },
) {
  await ctx.db.insert('auditLogs', row)
}

function isActiveAdmin(u: Doc<'users'>) {
  const role = u.role ?? 'user'
  return u.active !== false && (role === 'admin' || role === 'super_admin')
}

/**
 * Refuse a change that would leave the target's company with no active admin
 * (doc 07 V6). Super_admins who belong to the company count as admins: a
 * company whose only admins are super_admins is fine.
 */
async function assertKeepsAnAdmin(ctx: MutationCtx, target: Doc<'users'>) {
  if (!target.companyId || !isActiveAdmin(target)) return
  const members = await ctx.db
    .query('users')
    .withIndex('by_companyId', (q) => q.eq('companyId', target.companyId))
    .collect()
  const others = members.filter((u) => u._id !== target._id && isActiveAdmin(u))
  if (others.length === 0) {
    throw new Error('The company must keep at least one active admin')
  }
}

/** Only a super_admin may change a super_admin account (doc 07 V6). */
function assertMayModify(me: Doc<'users'>, target: Doc<'users'>) {
  if ((target.role ?? 'user') === 'super_admin' && (me.role ?? 'user') !== 'super_admin') {
    throw new Error('Only a super_admin can change a super_admin account')
  }
}

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
    active: u.active !== false,
    mustChangePassword: u.mustChangePassword === true,
  }
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    if (!user) return null
    // Not requireUser: the client needs this even when access is refused, to
    // route to the password change, registration, or sign out with a reason.
    let companyStatus: Doc<'companies'>['status'] | 'missing' | null = null
    if (user.companyId) {
      const company = await ctx.db.get(user.companyId)
      companyStatus = company?.status ?? 'missing'
    }
    // Keep raw Convex fields for AuthContext + add client aliases
    return { ...user, ...toClient(user), role: user.role ?? 'user', companyStatus }
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
    // Company admins read their company (by_companyId); super_admins keep the
    // platform-wide user list, bounded.
    const users =
      (me.role ?? 'user') === 'super_admin'
        ? await ctx.db.query('users').take(PLATFORM_SCAN_LIMIT)
        : me.companyId
          ? await ctx.db
              .query('users')
              .withIndex('by_companyId', (q) => q.eq('companyId', me.companyId))
              .collect()
          : []
    return users.map(toClient).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
  },
})

/**
 * Lightweight company directory for supervisor pickers.
 * Any signed-in company user can load names (not admin-only).
 */
export const listDirectory = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx)
    let users
    if ((me.role ?? 'user') === 'super_admin') {
      users = await ctx.db.query('users').take(PLATFORM_SCAN_LIMIT)
    } else {
      if (!me.companyId) return []
      users = await ctx.db
        .query('users')
        .withIndex('by_companyId', (q) => q.eq('companyId', me.companyId))
        .collect()
    }
    return users

      .filter((u) => u.active !== false)
      .map((u) => ({
        id: u._id,
        name: (u.name || '').trim() || u.email || 'User',
        email: u.email || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

/** Internal: email collision check for admin create-with-password. */
export const emailExists = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email.trim().toLowerCase()))
      .unique()
    return existing ? { exists: true, userId: existing._id } : { exists: false }
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
    assertMayModify(me, target)
    const nextRole = patch.role ?? target.role ?? 'user'
    if (nextRole === 'user') await assertKeepsAnAdmin(ctx, target)

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

/**
 * Invite by email into the caller's company. Never changes an existing
 * account: it only records a pending invite (one per company + email). The
 * invitee asks to join (claimInvite) and a company admin approves the request
 * (approveJoinRequest). Super_admin accounts cannot be invited.
 */
export const invite = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal('user'), v.literal('admin'))),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    if (!me.companyId) throw new Error('No company linked')
    const companyId = me.companyId
    const email = args.email.trim().toLowerCase()
    if (!email) throw new Error('Email is required')
    const role = args.role || 'user'

    const existing = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .unique()

    if (existing) {
      if ((existing.role ?? 'user') === 'super_admin') {
        throw new Error('This account cannot be invited')
      }
      if (existing.companyId === companyId) {
        throw new Error('This person is already a member of your company')
      }
      if (existing.companyId) {
        throw new Error('User already belongs to another company')
      }
    }

    const now = Date.now()
    const prior = await ctx.db
      .query('userInvites')
      .withIndex('by_company_and_email', (q) =>
        q.eq('companyId', companyId).eq('email', email),
      )
      .first()
    let inviteId: Id<'userInvites'>
    if (prior) {
      inviteId = prior._id
      await ctx.db.patch(prior._id, {
        role,
        invitedBy: me._id,
        createdAt: now,
        status: 'pending',
        requestedByUserId: undefined,
        requestedAt: undefined,
        decidedBy: undefined,
        decidedAt: undefined,
      })
    } else {
      inviteId = await ctx.db.insert('userInvites', {
        email,
        role,
        companyId,
        invitedBy: me._id,
        createdAt: now,
        status: 'pending',
      })
    }
    await logAudit(ctx, {
      actionType: 'invite',
      tableName: 'userInvites',
      recordId: inviteId,
      newValues: { email, role, companyId, existingUser: !!existing },
    })
    return existing
      ? {
          status: 'invited' as const,
          message:
            'Invite saved. They will see it after signing in and can ask to join. Approve it under Pending join requests.',
        }
      : {
          status: 'pending_signup' as const,
          message:
            'Invite saved. Once they sign up with this email they can ask to join. Approve it under Pending join requests.',
        }
  },
})

export const deactivate = mutation({
  args: { id: v.id('users') },
  handler: async (ctx, { id }) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    const target = await ctx.db.get(id)
    if (!target) throw new Error('User not found')
    if ((me.role ?? 'user') !== 'super_admin') {
      if (!me.companyId || target.companyId !== me.companyId) {
        throw new Error('Access denied')
      }
    }
    if (target._id === me._id) throw new Error('Cannot deactivate yourself')
    assertMayModify(me, target)
    await assertKeepsAnAdmin(ctx, target)
    await ctx.db.patch(id, { active: false })
    // Sign them out everywhere now, not when their sessions expire.
    const sessionsRevoked = await revokeUserSessions(ctx, id)
    await logAudit(ctx, {
      actionType: 'deactivate',
      tableName: 'users',
      recordId: id,
      newValues: { active: false, sessionsRevoked },
    })
    return id
  },
})

export const reactivate = mutation({
  args: { id: v.id('users') },
  handler: async (ctx, { id }) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    const target = await ctx.db.get(id)
    if (!target) throw new Error('User not found')
    if ((me.role ?? 'user') !== 'super_admin') {
      if (!me.companyId || target.companyId !== me.companyId) {
        throw new Error('Access denied')
      }
    }
    assertMayModify(me, target)
    await ctx.db.patch(id, { active: true })
    await logAudit(ctx, {
      actionType: 'reactivate',
      tableName: 'users',
      recordId: id,
      previousValues: { active: target.active },
      newValues: { active: true },
    })
    return id
  },
})

/** Company-less user: invites addressed to my email that I can ask to accept. */
export const myInvites = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx)
    if (me.companyId || !me.email) return []
    const invites = await ctx.db
      .query('userInvites')
      .withIndex('by_email', (q) => q.eq('email', me.email!.toLowerCase()))
      .take(20)
    const out = []
    for (const invite of invites) {
      const status = inviteStatus(invite)
      if (status !== 'pending' && status !== 'requested') continue
      if (status === 'requested' && invite.requestedByUserId !== me._id) continue
      const company = await ctx.db.get(invite.companyId)
      if (!company || company.status !== 'approved') continue
      out.push({
        id: invite._id,
        companyId: invite.companyId,
        companyName: company.name,
        role: invite.role,
        status,
      })
    }
    return out
  },
})

/**
 * Ask to join the company that invited my email. Does not change my account:
 * it turns the invite into a join request that a company admin must approve
 * (email ownership is not verified yet, so a matching email alone is not proof).
 * The return keeps `claimed` for older clients; it is always false now.
 */
export const claimInvite = mutation({
  args: { inviteId: v.optional(v.id('userInvites')) },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx)
    if (!me.email) return { claimed: false, requested: false }
    if (me.companyId) {
      return { claimed: false, requested: false, reason: 'already_in_company' }
    }
    if ((me.role ?? 'user') === 'super_admin') {
      return { claimed: false, requested: false, reason: 'super_admin' }
    }
    const email = me.email.toLowerCase()
    let invite: Doc<'userInvites'> | null = null
    if (args.inviteId) {
      invite = await ctx.db.get(args.inviteId)
      if (!invite || invite.email !== email) throw new Error('Invite not found')
    } else {
      const invites = await ctx.db
        .query('userInvites')
        .withIndex('by_email', (q) => q.eq('email', email))
        .take(20)
      invite = invites.find((i) => inviteStatus(i) === 'pending') ?? null
    }
    if (!invite) return { claimed: false, requested: false }
    if (inviteStatus(invite) === 'requested' && invite.requestedByUserId === me._id) {
      return { claimed: false, requested: true, companyId: invite.companyId }
    }
    if (inviteStatus(invite) !== 'pending') {
      throw new Error('This invite is no longer open')
    }
    await ctx.db.patch(invite._id, {
      status: 'requested',
      requestedByUserId: me._id,
      requestedAt: Date.now(),
    })
    // The requester has no company yet; file the entry under the inviting one.
    await insertAudit(ctx, {
      userId: me._id,
      companyId: invite.companyId,
      actionType: 'join_request',
      tableName: 'userInvites',
      recordId: invite._id,
      newValues: { email, role: invite.role, status: 'requested' },
    })
    return { claimed: false, requested: true, companyId: invite.companyId }
  },
})

/** Company admin: people who asked to join through an invite. */
export const listJoinRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    if (!me.companyId) return []
    const companyId = me.companyId
    const invites = await ctx.db
      .query('userInvites')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
    const out = []
    for (const invite of invites) {
      if (inviteStatus(invite) !== 'requested' || !invite.requestedByUserId) continue
      const requester = await ctx.db.get(invite.requestedByUserId)
      out.push({
        id: invite._id,
        email: invite.email,
        role: invite.role,
        name: requester?.name ?? null,
        requestedAt: invite.requestedAt ?? null,
      })
    }
    return out
  },
})

async function loadJoinRequest(
  ctx: MutationCtx,
  me: Doc<'users'>,
  inviteId: Id<'userInvites'>,
) {
  const invite = await ctx.db.get(inviteId)
  if (!invite || !me.companyId || invite.companyId !== me.companyId) {
    throw new Error('Join request not found')
  }
  if (inviteStatus(invite) !== 'requested' || !invite.requestedByUserId) {
    throw new Error('This join request is no longer pending')
  }
  return invite as Doc<'userInvites'> & { requestedByUserId: Id<'users'> }
}

/** Company admin: let the requester join with the invited role. */
export const approveJoinRequest = mutation({
  args: { inviteId: v.id('userInvites') },
  handler: async (ctx, { inviteId }) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    const invite = await loadJoinRequest(ctx, me, inviteId)
    const target = await ctx.db.get(invite.requestedByUserId)
    if (!target) throw new Error('User not found')
    if ((target.role ?? 'user') === 'super_admin') {
      throw new Error('This account cannot be invited')
    }
    if (target.companyId) throw new Error('User already belongs to a company')
    if ((target.email ?? '').toLowerCase() !== invite.email) {
      throw new Error('Join request does not match the invited email')
    }
    await ctx.db.patch(target._id, { companyId: invite.companyId, role: invite.role })
    await ctx.db.patch(invite._id, {
      status: 'accepted',
      decidedBy: me._id,
      decidedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'approve_join_request',
      tableName: 'users',
      recordId: target._id,
      previousValues: { companyId: target.companyId, role: target.role },
      newValues: { companyId: invite.companyId, role: invite.role, inviteId },
    })
    return { userId: target._id }
  },
})

/** Company admin: refuse a join request. */
export const declineJoinRequest = mutation({
  args: { inviteId: v.id('userInvites') },
  handler: async (ctx, { inviteId }) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    const invite = await loadJoinRequest(ctx, me, inviteId)
    await ctx.db.patch(invite._id, {
      status: 'declined',
      decidedBy: me._id,
      decidedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'decline_join_request',
      tableName: 'userInvites',
      recordId: invite._id,
      newValues: { email: invite.email, requestedByUserId: invite.requestedByUserId },
    })
    return invite._id
  },
})

/** For actions: the caller, with the same refusals as requireUser. */
export const authorizedCaller = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx)
    return { _id: me._id, role: me.role ?? 'user', companyId: me.companyId }
  },
})

/**
 * Bootstrap only: promote a user to super_admin by email.
 * Internal so it can only be run from the CLI/dashboard:
 *   npx convex run users:promoteToSuperAdmin '{"email":"you@example.com"}'
 */
export const promoteToSuperAdmin = internalMutation({
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
    // Run from the CLI, so there is no signed-in actor to record.
    await insertAudit(ctx, {
      companyId: user.companyId,
      actionType: 'promote_super_admin',
      tableName: 'users',
      recordId: user._id,
      previousValues: { role: user.role ?? 'user' },
      newValues: { role: 'super_admin', email },
    })
    return user._id
  },
})

/** After admin createAccount: attach company, role, and force password change. */
export const finalizeCreatedUser = internalMutation({
  args: {
    userId: v.id('users'),
    companyId: v.id('companies'),
    role: v.union(v.literal('user'), v.literal('admin')),
    name: v.optional(v.string()),
    actorId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) throw new Error('Created user not found')
    await ctx.db.patch(args.userId, {
      companyId: args.companyId,
      role: args.role,
      active: true,
      mustChangePassword: true,
      ...(args.name ? { name: args.name } : {}),
    })
    // Clear this company's invite for the email (other companies' invites stay)
    if (user.email) {
      const invite = await ctx.db
        .query('userInvites')
        .withIndex('by_company_and_email', (q) =>
          q.eq('companyId', args.companyId).eq('email', user.email!.toLowerCase()),
        )
        .first()
      if (invite) await ctx.db.delete(invite._id)
    }
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'users',
      recordId: args.userId,
      newValues: {
        email: user.email,
        role: args.role,
        companyId: args.companyId,
        createdBy: args.actorId,
        mustChangePassword: true,
      },
    })
    return args.userId
  },
})

export const clearMustChangePassword = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')
    await ctx.db.patch(userId, { mustChangePassword: false })
    return userId
  },
})
