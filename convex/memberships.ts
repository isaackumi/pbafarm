/**
 * Organizations a user belongs to (D-002, ORG-001..ORG-003).
 *
 * - listMine / switchActive: the organization switcher.
 * - listMembers / setRole / suspend / reactivate / remove: company admins.
 * - inviteInfo / acceptInvite / declineInvite / listInvites / revokeInvite:
 *   single-use, expiring invite links issued by users.invite.
 */
import { insertAuditLog } from './lib/auditChain'
import { v } from 'convex/values'
import { userError } from './lib/errors'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { revokeUserSessions } from './lib/authz'
import { revokeBindingsForUser } from './bot/bindings'
import { logAudit } from './lib/tenancy'
import {
  activateMembership,
  activeMembership,
  getMembership,
  MAX_SCOPED_LOCATIONS,
  isRoleKey,
  leaveActiveCompany,
  otherActiveMemberships,
  roleKeyFromLegacy,
  upsertMembership,
} from './lib/memberships'
import { sha256Hex } from './lib/tokens'
import { isTemplateKey, requireAccount, requireMember, TEMPLATE_LABELS } from './lib/permissions'
import { assertHumanTicket } from './humanVerification'
import { companyUsable } from './lib/tenantStatus'

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

/** Display name of a membership's role: its custom role, its template label, else the key. */
async function roleNameOf(ctx: QueryCtx, m: Doc<'memberships'>) {
  if (m.roleId) {
    const role = await ctx.db.get(m.roleId)
    if (role && role.companyId === m.companyId && !role.archived) return role.name
  }
  return isTemplateKey(m.roleKey) ? TEMPLATE_LABELS[m.roleKey] : m.roleKey
}

/** A signed URL for a stored logo, or null when absent or no longer stored. */
async function logoUrlOf(ctx: QueryCtx, storageId: Id<'_storage'> | undefined) {
  if (!storageId) return null
  try {
    return await ctx.storage.getUrl(storageId)
  } catch {
    return null
  }
}

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      companyId: v.id('companies'),
      name: v.string(),
      code: v.string(),
      companyStatus: v.union(v.literal('pending'), v.literal('rejected'), v.literal('approved')),
      roleKey: v.string(),
      roleName: v.string(),
      logoUrl: v.union(v.string(), v.null()),
      isActive: v.boolean(),
    }),
  ),
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
        roleName: await roleNameOf(ctx, m),
        logoUrl: await logoUrlOf(ctx, company.logoStorageId),
        isActive: me.companyId === m.companyId,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

/** Sites and cages read per organization for farmCounts. */
const COUNT_SITE_CAP = 500
const COUNT_CAGE_CAP = 5000

/**
 * Choose your farm (Paper 70 "Farm manager · 4 sites · 38 cages"): per
 * organization I belong to, the active sites I can see and the cages in
 * them (archived ones left out). Only approved organizations; my own
 * memberships only, so nothing of an organization I am not in is counted.
 */
export const farmCounts = query({
  args: {},
  returns: v.array(v.object({ companyId: v.id('companies'), sites: v.number(), cages: v.number() })),
  handler: async (ctx) => {
    const me = await requireAccount(ctx)
    const out = []
    for (const m of await myMemberships(ctx, me)) {
      if (m.status !== 'active') continue
      const company = await ctx.db.get(m.companyId)
      if (!company || company.status !== 'approved') continue
      const sites = (
        await ctx.db
          .query('farmLocations')
          .withIndex('by_company', (q) => q.eq('companyId', m.companyId))
          .take(COUNT_SITE_CAP)
      ).filter((l) => l.active)
      const scoped = m.allLocations ? null : new Set((m.locationIds ?? []).map(String))
      const mySites = scoped ? sites.filter((l) => scoped.has(String(l._id))) : sites
      const cages = (
        await ctx.db
          .query('cages')
          .withIndex('by_company', (q) => q.eq('companyId', m.companyId))
          .take(COUNT_CAGE_CAP)
      ).filter((c) => !c.archivedAt && (!scoped || (!!c.locationId && scoped.has(String(c.locationId)))))
      out.push({ companyId: m.companyId, sites: mySites.length, cages: cages.length })
    }
    return out
  },
})

/** Make another organization (where I have an active membership) my active one. */
export const switchActive = mutation({
  args: { companyId: v.id('companies') },
  returns: v.object({ companyId: v.id('companies') }),
  handler: async (ctx, { companyId }) => {
    const me = await requireAccount(ctx)
    if (me.companyId === companyId) return { companyId }
    const membership = await getMembership(ctx, me._id, companyId)
    if (!membership || membership.status !== 'active') {
      throw userError('FORBIDDEN', 'You are not a member of that organization')
    }
    const company = await ctx.db.get(companyId)
    if (!companyUsable(company)) {
      throw userError('CONFLICT', 'That organization is not active')
    }
    const previous = me.companyId
    await activateMembership(ctx, me, membership)
    await insertAuditLog(ctx, {
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
  returns: v.array(
    v.union(
      v.object({
        membershipId: v.string(),
        userId: v.id('users'),
        name: v.union(v.string(), v.null()),
        email: v.union(v.string(), v.null()),
        roleKey: v.string(),
        roleId: v.union(v.id('roles'), v.null()),
        status: v.union(v.literal('active'), v.literal('suspended')),
        allLocations: v.boolean(),
        locationIds: v.array(v.id('farmLocations')),
        isActiveOrg: v.boolean(),
        legacy: v.boolean(),
      }),
      v.object({
        membershipId: v.null(),
        userId: v.id('users'),
        name: v.union(v.string(), v.null()),
        email: v.union(v.string(), v.null()),
        roleKey: v.union(
          v.literal('admin'),
          v.literal('owner'),
          v.literal('manager'),
          v.literal('field_staff'),
          v.literal('viewer'),
        ),
        status: v.string(),
        allLocations: v.boolean(),
        locationIds: v.array(v.id('farmLocations')),
        isActiveOrg: v.boolean(),
        legacy: v.boolean(),
      }),
    ),
  ),
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
        roleId: m.roleId ?? null,
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

/**
 * Refuse a change that leaves the company with no active owner/admin, or
 * touches an owner as a non-owner. Also used by users.update (legacy role).
 */
export async function assertAdminChange(
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

/**
 * Give a member a role template (`roleKey`) or one of the organization's
 * custom roles (`roleId`).
 */
export const setRole = mutation({
  args: { userId: v.id('users'), roleKey: v.optional(v.string()), roleId: v.optional(v.id('roles')) },
  returns: v.object({ roleKey: v.string() }),
  handler: async (ctx, args) => {
    const { me, companyId } = await requireCompanyAdmin(ctx)
    const { userId } = args
    let roleKey = args.roleKey ?? ''
    if (args.roleId) {
      const role = await ctx.db.get(args.roleId)
      if (!role || role.companyId !== companyId || role.archived) {
        throw userError('NOT_FOUND', 'Role not found')
      }
      roleKey = role.key
    } else if (!isRoleKey(roleKey)) {
      throw userError('VALIDATION', `Unknown role: ${roleKey}`)
    }
    const { membership } = await loadTarget(ctx, companyId, userId)
    if (roleKey === 'owner' && (me.role ?? 'user') !== 'super_admin') {
      const mine = await getMembership(ctx, me._id, companyId)
      if (mine?.roleKey !== 'owner') throw userError('FORBIDDEN', 'Only an owner can make someone an owner')
    }
    await assertAdminChange(ctx, me, companyId, membership, { roleKey })
    await upsertMembership(ctx, {
      userId,
      companyId,
      roleKey,
      roleId: args.roleId ?? null,
      actorId: me._id,
    })
    await logAudit(ctx, {
      actionType: 'membership_role',
      tableName: 'memberships',
      recordId: membership._id,
      previousValues: { roleKey: membership.roleKey, roleId: membership.roleId },
      newValues: { roleKey, roleId: args.roleId, userId },
    })
    return { roleKey }
  },
})

/**
 * Limit a member to some sites, or give them every site (PERM-004). The
 * scope is mirrored into users.locationIds while this is their active
 * organization, which is what reads and writes filter on.
 */
export const setSites = mutation({
  args: {
    userId: v.id('users'),
    allLocations: v.boolean(),
    locationIds: v.optional(v.array(v.id('farmLocations'))),
  },
  returns: v.object({ allLocations: v.boolean(), locationIds: v.array(v.id('farmLocations')) }),
  handler: async (ctx, args) => {
    const { me, companyId } = await requireCompanyAdmin(ctx)
    const { user, membership } = await loadTarget(ctx, companyId, args.userId)
    const ids = args.allLocations ? [] : [...new Set(args.locationIds ?? [])]
    if (!args.allLocations && ids.length === 0) {
      throw userError('VALIDATION', 'Pick at least one site, or give access to all sites')
    }
    if (ids.length > MAX_SCOPED_LOCATIONS) {
      throw userError('VALIDATION', `At most ${MAX_SCOPED_LOCATIONS} sites`)
    }
    for (const id of ids) {
      const site = await ctx.db.get(id)
      if (!site || site.companyId !== companyId) throw userError('NOT_FOUND', 'Site not found')
    }
    await upsertMembership(ctx, {
      userId: args.userId,
      companyId,
      allLocations: args.allLocations,
      locationIds: args.allLocations ? [] : ids,
      actorId: me._id,
    })
    if (user.companyId === companyId) {
      const fresh = (await ctx.db.get(user._id))!
      const scoped = args.allLocations ? undefined : ids
      const keepActive =
        !scoped || (fresh.activeLocationId && scoped.includes(fresh.activeLocationId))
      await ctx.db.patch(user._id, {
        locationIds: scoped,
        ...(keepActive ? {} : { activeLocationId: ids[0] }),
      })
    }
    await logAudit(ctx, {
      actionType: 'membership_sites',
      tableName: 'memberships',
      recordId: membership._id,
      previousValues: { allLocations: membership.allLocations, locationIds: membership.locationIds },
      newValues: { allLocations: args.allLocations, locationIds: ids, userId: args.userId },
    })
    return { allLocations: args.allLocations, locationIds: ids }
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
    await revokeBindingsForUser(ctx, userId, `membership_${status}`, { companyId })
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

const suspendItem = v.object({
  status: v.union(v.literal('active'), v.literal('suspended'), v.literal('removed')),
})

const stateValues = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('declined'),
  v.literal('requested'),
  v.literal('revoked'),
  v.literal('expired'),
)

export const suspend = mutation({
  args: { userId: v.id('users') },
  returns: suspendItem,
  handler: async (ctx, { userId }) => changeStatus(ctx, userId, 'suspended'),
})

export const reactivate = mutation({
  args: { userId: v.id('users') },
  returns: suspendItem,
  handler: async (ctx, { userId }) => changeStatus(ctx, userId, 'active'),
})

export const remove = mutation({
  args: { userId: v.id('users') },
  returns: suspendItem,
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
  returns: v.union(
    v.object({
      companyName: v.string(),
      email: v.string(),
      roleKey: v.string(),
      state: stateValues,
      expiresAt: v.union(v.number(), v.null()),
      /** Who sent it (Paper 61 "Kwame invited you"); null when unknown. */
      inviterName: v.union(v.string(), v.null()),
      /** Names of the sites it covers; null = every site. */
      sites: v.union(v.array(v.string()), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { token }) => {
    const invite = await inviteByToken(ctx, token)
    if (!invite) return null
    const company = await ctx.db.get(invite.companyId)
    const inviter = invite.invitedBy ? await ctx.db.get(invite.invitedBy) : null
    let sites: string[] | null = null
    if (invite.locationIds && invite.locationIds.length > 0) {
      sites = []
      for (const id of invite.locationIds.slice(0, 100)) {
        const site = await ctx.db.get(id)
        if (site && site.companyId === invite.companyId) sites.push(site.name)
      }
    }
    return {
      companyName: company?.name ?? 'Unknown organization',
      email: invite.email,
      roleKey: invite.roleKey ?? roleKeyFromLegacy(invite.role),
      state: inviteState(invite, Date.now()),
      expiresAt: invite.expiresAt ?? null,
      inviterName: inviter ? inviter.name || inviter.email || null : null,
      sites,
    }
  },
})

/**
 * Accept an invite link: the signed-in account's email must match the invite
 * and be verified. Single use; expired links fail.
 */
export const acceptInvite = mutation({
  args: { token: v.string(), humanTicket: v.optional(v.string()) },
  returns: v.object({ companyId: v.id('companies'), activated: v.boolean() }),
  handler: async (ctx, { token, humanTicket }) => {
    const me = await requireAccount(ctx)
    await assertHumanTicket(ctx, humanTicket, 'invite_accept')
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
    if (!companyUsable(company)) {
      throw userError('CONFLICT', 'That organization is not active')
    }
    const roleKey = invite.roleKey ?? roleKeyFromLegacy(invite.role)
    const existing = await getMembership(ctx, me._id, invite.companyId)
    const membershipId = await upsertMembership(ctx, {
      userId: me._id,
      companyId: invite.companyId,
      roleKey: existing?.status === 'active' ? undefined : roleKey,
      // The invite's sites (Paper 61) apply to a new membership, not an active one.
      ...(existing?.status === 'active'
        ? {}
        : invite.locationIds && invite.locationIds.length > 0
          ? { allLocations: false, locationIds: invite.locationIds }
          : { allLocations: true, locationIds: undefined }),
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
    await insertAuditLog(ctx, {
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
  returns: v.object({ declined: v.boolean() }),
  handler: async (ctx, { token }) => {
    const me = await requireAccount(ctx)
    const invite = await inviteByToken(ctx, token)
    if (!invite || (me.email ?? '').toLowerCase() !== invite.email) {
      throw userError('NOT_FOUND', 'This invite link is not valid')
    }
    if (inviteState(invite, Date.now()) !== 'pending') return { declined: false }
    await ctx.db.patch(invite._id, { status: 'declined', decidedAt: Date.now() })
    await insertAuditLog(ctx, {
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
  returns: v.array(
    v.object({
      id: v.id('userInvites'),
      email: v.string(),
      roleKey: v.string(),
      state: stateValues,
      expiresAt: v.union(v.number(), v.null()),
      createdAt: v.number(),
    }),
  ),
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
  returns: v.id('userInvites'),
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

