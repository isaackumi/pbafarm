/**
 * Organizations a user belongs to (D-002, ORG-001..ORG-003).
 *
 * - listMine / switchActive: the organization switcher.
 * - listMembers / setRole / suspend / reactivate / remove: company admins.
 * - inviteInfo / acceptInvite / declineInvite / listInvites / revokeInvite:
 *   single-use, expiring invite links issued by users.invite.
 */
import { v } from 'convex/values'
import { userError } from './lib/errors'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { revokeUserSessions } from './lib/authz'
import { logAudit } from './lib/tenancy'
import {
  activateMembership,
  activeMembership,
  getMembership,
  isRoleKey,
  leaveActiveCompany,
  otherActiveMemberships,
  roleKeyFromLegacy,
  upsertMembership,
} from './lib/memberships'
import { sha256Hex } from './lib/tokens'
import { requireAccount, requireMember } from './lib/permissions'

const ADMIN_KEYS = new Set(['owner', 'admin'])

/** Membership rows of the user, plus the legacy users.companyId one if it has no row yet. */
async function myMemberships(ctx: QueryCtx | MutationCtx, me: Doc<'users'>) {
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_userId', (q) => q.eq('userId', me._id))
    .take(50)
  const out: Array<Doc<'memberships'> | (Doc<'memberships'> & { synthesized?: true })> = [...rows]
  if (me.companyId && !rows.some((m) => m.companyId === me.companyId)) {
    const legacy = await activeMembership(ctx, me)
    if (legacy) out.push(legacy)
  }
  return out
}

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireAccount(ctx)
    const rows = await myMemberships(ctx, me)
    const out = []
    for (const m of rows) {
      if (m.status !== 'active') continue
      const company = await ctx.db.get(m.companyId)
      if (!company) continue
      out.push({
        companyId: m.companyId,
        name: company.name,
        code: company.code,
        companyStatus: company.status,
        roleKey: m.roleKey,
        isActive: me.companyId === m.companyId,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

/** Make another organization (where I have an active membership) my active one. */
export const switchActive = mutation({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const me = await requireAccount(ctx)
    if (me.companyId === companyId) return { companyId }
    const membership = await getMembership(ctx, me._id, companyId)
    if (!membership || membership.status !== 'active') {
      throw userError('FORBIDDEN', 'You are not a member of that organization')
    }
    const company = await ctx.db.get(companyId)
    if (!company || company.status !== 'approved') {
      throw userError('CONFLICT', 'That organization is not active')
    }
    const previous = me.companyId
    await activateMembership(ctx, me, membership)
    await ctx.db.insert('auditLogs', {
      userId: me._id,
      companyId,
      actionType: 'switch_organization',
      tableName: 'memberships',
      recordId: membership._id,
      previousValues: { companyId: previous },
      newValues: { companyId },
    })
    return { companyId }
  },
})

// ─── Company admin ───────────────────────────────────────────────────────────

async function requireCompanyAdmin(ctx: QueryCtx | MutationCtx) {
  const m = await requireMember(ctx, { permission: 'org.members.manage' })
  const me = m.user
  if (!me.companyId) throw userError('VALIDATION', 'No company linked')
  return { me, companyId: me.companyId, member: m }
}

export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireCompanyAdmin(ctx)
    const rows = await ctx.db
      .query('memberships')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(1000)
    const seen = new Set(rows.map((m) => m.userId))
    const out = []
    for (const m of rows) {
      if (m.status === 'removed') continue
      const u = await ctx.db.get(m.userId)
      if (!u) continue
      out.push({
        membershipId: m._id as string,
        userId: u._id,
        name: u.name ?? null,
        email: u.email ?? null,
        roleKey: m.roleKey,
        status: m.status,
        allLocations: m.allLocations,
        locationIds: m.locationIds ?? [],
        isActiveOrg: u.companyId === companyId,
        legacy: false,
      })
    }
    // Members not backfilled yet (M2): shown from users.companyId.
    const legacyUsers = await ctx.db
      .query('users')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(1000)
    for (const u of legacyUsers) {
      if (seen.has(u._id)) continue
      out.push({
        membershipId: null,
        userId: u._id,
        name: u.name ?? null,
        email: u.email ?? null,
        roleKey: roleKeyFromLegacy(u.role),
        status: u.active === false ? 'suspended' : 'active',
        allLocations: !(u.locationIds && u.locationIds.length > 0),
        locationIds: u.locationIds ?? [],
        isActiveOrg: true,
        legacy: true,
      })
    }
    return out
  },
})

/** The target's membership in my company, creating it from legacy fields if needed. */
async function loadTarget(ctx: MutationCtx, companyId: Id<'companies'>, userId: Id<'users'>) {
  const user = await ctx.db.get(userId)
  if (!user) throw userError('NOT_FOUND', 'Member not found')
  let membership = await getMembership(ctx, userId, companyId)
  if (!membership) {
    if (user.companyId !== companyId) throw userError('NOT_FOUND', 'Member not found')
    const id = await upsertMembership(ctx, {
      userId,
      companyId,
      roleKey: roleKeyFromLegacy(user.role),
      status: user.active === false ? 'suspended' : 'active',
      allLocations: !(user.locationIds && user.locationIds.length > 0),
      locationIds: user.locationIds,
      legacy: true,
    })
    membership = (await ctx.db.get(id))!
  }
  if ((user.role ?? 'user') === 'super_admin') {
    throw userError('FORBIDDEN', 'Only a super_admin can change a super_admin account')
  }
  return { user, membership }
}

/** Refuse a change that leaves the company with no active owner/admin, or touches an owner as a non-owner. */
async function assertAdminChange(
  ctx: MutationCtx,
  me: Doc<'users'>,
  companyId: Id<'companies'>,
  membership: Doc<'memberships'>,
  next: { roleKey?: string; status?: Doc<'memberships'>['status'] },
) {
  if (membership.roleKey === 'owner' && (me.role ?? 'user') !== 'super_admin') {
    const mine = await getMembership(ctx, me._id, companyId)
    if (mine?.roleKey !== 'owner') throw userError('FORBIDDEN', 'Only an owner can change an owner')
  }
  const wasAdmin = ADMIN_KEYS.has(membership.roleKey) && membership.status === 'active'
  const staysAdmin =
    ADMIN_KEYS.has(next.roleKey ?? membership.roleKey) &&
    (next.status ?? membership.status) === 'active'
  if (!wasAdmin || staysAdmin) return
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(1000)
  const others = rows.filter(
    (m) => m._id !== membership._id && m.status === 'active' && ADMIN_KEYS.has(m.roleKey),
  )
  if (others.length > 0) return
  // Legacy admins not backfilled yet still count.
  const legacy = await ctx.db
    .query('users')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(1000)
  const rowUsers = new Set(rows.map((m) => m.userId))
  const legacyAdmins = legacy.filter(
    (u) =>
      u._id !== membership.userId &&
      !rowUsers.has(u._id) &&
      u.active !== false &&
      (u.role === 'admin' || u.role === 'super_admin'),
  )
  if (legacyAdmins.length === 0) {
    throw userError('CONFLICT', 'The company must keep at least one active admin')
  }
}

export const setRole = mutation({
  args: { userId: v.id('users'), roleKey: v.string() },
  handler: async (ctx, { userId, roleKey }) => {
    const { me, companyId } = await requireCompanyAdmin(ctx)
    if (!isRoleKey(roleKey)) throw userError('VALIDATION', `Unknown role: ${roleKey}`)
    const { membership } = await loadTarget(ctx, companyId, userId)
    if (roleKey === 'owner' && (me.role ?? 'user') !== 'super_admin') {
      const mine = await getMembership(ctx, me._id, companyId)
      if (mine?.roleKey !== 'owner') throw userError('FORBIDDEN', 'Only an owner can make someone an owner')
    }
    await assertAdminChange(ctx, me, companyId, membership, { roleKey })
    await upsertMembership(ctx, { userId, companyId, roleKey, actorId: me._id })
    await logAudit(ctx, {
      actionType: 'membership_role',
      tableName: 'memberships',
      recordId: membership._id,
      previousValues: { roleKey: membership.roleKey },
      newValues: { roleKey, userId },
    })
    return { roleKey }
  },
})

async function changeStatus(
  ctx: MutationCtx,
  userId: Id<'users'>,
  status: 'active' | 'suspended' | 'removed',
) {
  const { me, companyId } = await requireCompanyAdmin(ctx)
  if (userId === me._id && status !== 'active') {
    throw userError('FORBIDDEN', 'You cannot suspend or remove yourself')
  }
  const { user, membership } = await loadTarget(ctx, companyId, userId)
  await assertAdminChange(ctx, me, companyId, membership, { status })
  await upsertMembership(ctx, { userId, companyId, status, actorId: me._id })
  let sessionsRevoked = 0
  if (status !== 'active') {
    await leaveActiveCompany(ctx, userId, companyId)
    // Account with no other organization: end its sessions now.
    if ((await otherActiveMemberships(ctx, userId, companyId)).length === 0) {
      sessionsRevoked = await revokeUserSessions(ctx, userId)
    }
  } else if (!user.companyId) {
    const fresh = (await ctx.db.get(userId))!
    await activateMembership(ctx, fresh, membership)
  }
  await logAudit(ctx, {
    actionType: `membership_${status}`,
    tableName: 'memberships',
    recordId: membership._id,
    previousValues: { status: membership.status },
    newValues: { status, userId, sessionsRevoked },
  })
  return { status }
}

export const suspend = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => changeStatus(ctx, userId, 'suspended'),
})

export const reactivate = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => changeStatus(ctx, userId, 'active'),
})

export const remove = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => changeStatus(ctx, userId, 'removed'),
})

// ─── Invites ─────────────────────────────────────────────────────────────────

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

async function inviteByToken(ctx: QueryCtx | MutationCtx, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const tokenHash = await sha256Hex(token)
  return await ctx.db
    .query('userInvites')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .unique()
}

function inviteState(invite: Doc<'userInvites'>, now: number) {
  const status = invite.status ?? 'pending'
  if (status === 'pending' && invite.expiresAt !== undefined && invite.expiresAt < now) {
    return 'expired' as const
  }
  return status
}

/** Public: what an invite link is for. Works signed out (shows the organization name). */
export const inviteInfo = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await inviteByToken(ctx, token)
    if (!invite) return null
    const company = await ctx.db.get(invite.companyId)
    return {
      companyName: company?.name ?? 'Unknown organization',
      email: invite.email,
      roleKey: invite.roleKey ?? roleKeyFromLegacy(invite.role),
      state: inviteState(invite, Date.now()),
      expiresAt: invite.expiresAt ?? null,
    }
  },
})

/**
 * Accept an invite link: the signed-in account's email must match the invite
 * and be verified. Single use; expired links fail.
 */
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireAccount(ctx)
    const invite = await inviteByToken(ctx, token)
    if (!invite) throw userError('NOT_FOUND', 'This invite link is not valid')
    const state = inviteState(invite, Date.now())
    if (state === 'expired') throw userError('CONFLICT', 'This invite has expired. Ask for a new one.')
    if (state !== 'pending') throw userError('CONFLICT', 'This invite has already been used or withdrawn')
    if ((me.role ?? 'user') === 'super_admin') throw userError('FORBIDDEN', 'This account cannot be invited')
    if ((me.email ?? '').toLowerCase() !== invite.email) {
      throw userError('FORBIDDEN', `This invite is for ${invite.email}. Sign in with that email to accept it.`)
    }
    if (!me.emailVerificationTime) {
      throw userError('FORBIDDEN', 'Verify your email address before accepting the invite.', { reason: 'EMAIL_NOT_VERIFIED' })
    }
    const company = await ctx.db.get(invite.companyId)
    if (!company || company.status !== 'approved') {
      throw userError('CONFLICT', 'That organization is not active')
    }
    const roleKey = invite.roleKey ?? roleKeyFromLegacy(invite.role)
    const existing = await getMembership(ctx, me._id, invite.companyId)
    const membershipId = await upsertMembership(ctx, {
      userId: me._id,
      companyId: invite.companyId,
      roleKey: existing?.status === 'active' ? undefined : roleKey,
      status: 'active',
      actorId: invite.invitedBy,
    })
    const now = Date.now()
    await ctx.db.patch(invite._id, {
      status: 'accepted',
      acceptedBy: me._id,
      acceptedAt: now,
      decidedAt: now,
    })
    if (!me.companyId) {
      const membership = (await ctx.db.get(membershipId))!
      await activateMembership(ctx, me, membership)
    }
    await ctx.db.insert('auditLogs', {
      userId: me._id,
      companyId: invite.companyId,
      actionType: 'accept_invite',
      tableName: 'memberships',
      recordId: membershipId,
      newValues: { email: invite.email, roleKey, inviteId: invite._id },
    })
    return { companyId: invite.companyId, activated: !me.companyId }
  },
})

export const declineInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireAccount(ctx)
    const invite = await inviteByToken(ctx, token)
    if (!invite || (me.email ?? '').toLowerCase() !== invite.email) {
      throw userError('NOT_FOUND', 'This invite link is not valid')
    }
    if (inviteState(invite, Date.now()) !== 'pending') return { declined: false }
    await ctx.db.patch(invite._id, { status: 'declined', decidedAt: Date.now() })
    await ctx.db.insert('auditLogs', {
      userId: me._id,
      companyId: invite.companyId,
      actionType: 'decline_invite',
      tableName: 'userInvites',
      recordId: invite._id,
      newValues: { email: invite.email },
    })
    return { declined: true }
  },
})

/** Company admin: open invites (pending, including expired ones not yet re-sent). */
export const listInvites = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireCompanyAdmin(ctx)
    const invites = await ctx.db
      .query('userInvites')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
    const now = Date.now()
    return invites
      .filter((i) => (i.status ?? 'pending') === 'pending')
      .map((i) => ({
        id: i._id,
        email: i.email,
        roleKey: i.roleKey ?? roleKeyFromLegacy(i.role),
        state: inviteState(i, now),
        expiresAt: i.expiresAt ?? null,
        createdAt: i.createdAt,
      }))
  },
})

export const revokeInvite = mutation({
  args: { inviteId: v.id('userInvites') },
  handler: async (ctx, { inviteId }) => {
    const { me, companyId } = await requireCompanyAdmin(ctx)
    const invite = await ctx.db.get(inviteId)
    if (!invite || invite.companyId !== companyId) throw userError('NOT_FOUND', 'Invite not found')
    await ctx.db.patch(inviteId, {
      status: 'revoked',
      decidedBy: me._id,
      decidedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'revoke_invite',
      tableName: 'userInvites',
      recordId: inviteId,
      newValues: { email: invite.email },
    })
    return inviteId
  },
})

