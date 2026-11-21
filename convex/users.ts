import { insertAuditLog } from './lib/auditChain'
import { getAuthUserId } from '@convex-dev/auth/server'
import { query, mutation, internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'
import { mfaPolicyApplies, requireUser, revokeUserSessions, sessionMfaVerified } from './lib/authz'
import { logAudit } from './lib/tenancy'
import { PLATFORM_SCAN_LIMIT } from './lib/scope'
import { actingUser, liveActAsSession } from './lib/actAs'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { maskPhone, normalizePhone } from './lib/phone'
import { messagingPrefs } from './messaging/channels'
import { channelAvailable } from './messaging/deliver'
import { securityPolicy } from './messaging/policy'
import { internal } from './_generated/api'
import {
  getMembership,
  isRoleKey,
  legacyRoleFromKey,
  leaveActiveCompany,
  otherActiveMemberships,
  roleKeyFromLegacy,
  upsertMembership,
} from './lib/memberships'
import { randomToken, sha256Hex } from './lib/tokens'
import { siteUrl } from './lib/email'
import { emailContext, inviteEmail } from './lib/emailTemplates'
import { TEMPLATE_LABELS, isTemplateKey } from './lib/permissionCatalog'
import { userError } from './lib/errors'
import { SUPPORTED_UI_LOCALES } from './lib/orgProfile'

/** Invite links stay valid for 7 days. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
import type { Doc, Id } from './_generated/dataModel'
import { isPermission, requireAccount, requireMember } from './lib/permissions'
import { onApprovalDecided, onApprovalRequested } from './approvalAlerts'
import { assertAdminChange } from './memberships'
import { assertPlanLimit } from './lib/planLimits'
import { revokeWhatsAppNotMatching } from './bot/bindings'

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
  await insertAuditLog(ctx, row)
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

/** Refuse a phone number another account already uses (phone sign-in needs one owner). */
export async function assertPhoneFree(
  ctx: QueryCtx | MutationCtx,
  phone: string,
  userId: Id<'users'>,
) {
  const others = await ctx.db
    .query('users')
    .withIndex('phone', (q) => q.eq('phone', phone))
    .take(2)
  if (others.some((u) => u._id !== userId)) {
    throw new Error('This phone number is already registered to another account.')
  }
}

/**
 * The phone is an account-wide sign-in identifier (phone sign-in, 2FA codes).
 * An admin may not change it for someone who also belongs to another
 * organization (ORG-002): that would hand the admin a way into the other
 * organization. People change their own number; super_admins are exempt.
 */
async function assertMayChangePhone(ctx: MutationCtx, me: Doc<'users'>, target: Doc<'users'>) {
  if (me._id === target._id || (me.role ?? 'user') === 'super_admin') return
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_userId', (q) => q.eq('userId', target._id))
    .take(50)
  if (rows.some((m) => m.companyId !== me.companyId && m.status !== 'removed')) {
    throw userError(
      'FORBIDDEN',
      'This person also belongs to another organization, so only they can change their phone number.',
    )
  }
}

/**
 * Codes pending for a number that is no longer the account's die with it:
 * phone sign-in codes, phone confirmations, and unverified two-step codes
 * (so a later code can only have gone to the current number).
 */
async function dropPendingPhoneCodes(ctx: MutationCtx, userId: Id<'users'>, oldPhone: string | undefined) {
  if (oldPhone) {
    const codes = await ctx.db
      .query('phoneLoginCodes')
      .withIndex('by_phone', (q) => q.eq('phone', oldPhone))
      .collect()
    for (const c of codes) await ctx.db.delete(c._id)
  }
  const confirms = await ctx.db
    .query('phoneConfirmCodes')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .take(10)
  for (const c of confirms) await ctx.db.delete(c._id)
  const pending = await ctx.db
    .query('mfaSessions')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .take(50)
  for (const row of pending) {
    if (row.verifiedAt === undefined && row.codeHash !== undefined) {
      await ctx.db.patch(row._id, { codeHash: undefined, expiresAt: undefined })
    }
  }
}

/** E.164 form of a phone typed by an admin, using the target's company country. */
async function normalizeForCompany(
  ctx: MutationCtx,
  raw: string,
  companyId: Id<'companies'> | undefined,
): Promise<string> {
  const company = companyId ? await ctx.db.get(companyId) : null
  const phone = normalizePhone(raw, messagingPrefs(company).defaultCountryCode)
  if (!phone) throw new Error('Enter a valid phone number, for example 024 412 3456 or +233244123456')
  return phone
}

/** Two-step state of the current session, for users.current. */
async function mfaState(ctx: QueryCtx, user: Doc<'users'>) {
  // An authenticator app (ENT-003) counts as a way to verify on its own.
  const mfaTotp = user.totpEnabledAt !== undefined
  const none = {
    mfaPolicy: false,
    mfaRequired: false,
    mfaChannels: [] as string[],
    mfaDefaultChannel: null as string | null,
    mfaTotp,
  }
  const company = user.companyId ? await ctx.db.get(user.companyId) : null
  // Same rule as requireUser: super_admins always verify (app or phone code).
  if (!mfaPolicyApplies(user, company)) return none
  const policy = securityPolicy(company)
  const verified = await sessionMfaVerified(ctx, user)
  const mfaChannels: string[] = []
  if (!verified && policy.require2fa && user.companyId) {
    for (const c of ['sms', 'whatsapp'] as const) {
      if (await channelAvailable(ctx, user.companyId, c)) mfaChannels.push(c)
    }
  }
  return {
    // Every session of this account must verify (offline restore checks it too).
    mfaPolicy: true,
    mfaRequired: !verified,
    mfaChannels,
    mfaDefaultChannel: policy.require2fa ? (policy.twoFactorChannel as string | null) : null,
    mfaTotp,
  }
}

function toClient(u: Doc<'users'>) {
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

const realRoleValues = v.union(v.literal('user'), v.literal('admin'), v.literal('super_admin'))

const userRow = v.object({
  id: v.id('users'),
  _id: v.id('users'),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  role: realRoleValues,
  companyId: v.optional(v.id('companies')),
  company_id: v.optional(v.id('companies')),
  phone: v.optional(v.string()),
  image: v.optional(v.string()),
  active: v.boolean(),
  mustChangePassword: v.boolean(),
})

export const current = query({
  args: {},
  returns: v.union(
    v.object({
      realRole: realRoleValues,
      actingAs: v.union(
        v.object({
          sessionId: v.id('actAsSessions'),
          companyId: v.id('companies'),
          allowWrites: v.boolean(),
          expiresAt: v.number(),
        }),
        v.null(),
      ),
      hasPhone: v.boolean(),
      maskedPhone: v.union(v.string(), v.null()),
      mfaPolicy: v.boolean(),
      mfaRequired: v.boolean(),
      mfaChannels: v.array(v.string()),
      mfaDefaultChannel: v.union(v.string(), v.null()),
      mfaTotp: v.boolean(),
      role: realRoleValues,
      companyStatus: v.union(
        v.literal('pending'),
        v.literal('rejected'),
        v.literal('approved'),
        v.literal('missing'),
        v.null(),
      ),
      /** Organization suspended by the platform or billing (PLAT-104): only /suspended and /billing open. */
      companySuspended: v.boolean(),
      id: v.id('users'),
      _id: v.id('users'),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      companyId: v.optional(v.id('companies')),
      company_id: v.optional(v.id('companies')),
      phone: v.optional(v.string()),
      image: v.optional(v.string()),
      active: v.boolean(),
      mustChangePassword: v.boolean(),
      _creationTime: v.number(),
      locationIds: v.optional(v.array(v.id('farmLocations'))),
      emailVerificationTime: v.optional(v.number()),
      phoneVerificationTime: v.optional(v.number()),
      totpEnabledAt: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      activeLocationId: v.optional(v.id('farmLocations')),
      deletedAt: v.optional(v.number()),
      locale: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const realUser = await ctx.db.get(userId)
    if (!realUser) return null
    // Support access (ENT-006): the app shows the organization being acted as,
    // as its admin; `actingAs` drives the banner and `realRole` stays visible.
    const actAs =
      (realUser.role ?? 'user') === 'super_admin' ? await liveActAsSession(ctx, realUser._id, Date.now()) : null
    const user = actAs ? await actingUser(ctx, realUser, actAs) : realUser
    // Not requireUser: the client needs this even when access is refused, to
    // route to the password change, registration, or sign out with a reason.
    let companyStatus: Doc<'companies'>['status'] | 'missing' | null = null
    let companySuspended = false
    if (user.companyId) {
      const company = await ctx.db.get(user.companyId)
      companyStatus = company?.status ?? 'missing'
      companySuspended = company?.suspendedAt !== undefined
    }
    // Two-step verification for this session (SEC-007); the client routes
    // to /verify while mfaRequired is true.
    const mfa = await mfaState(ctx, realUser)
    // Keep raw Convex fields for AuthContext + add client aliases
    return {
      ...user,
      ...toClient(user),
      role: user.role ?? 'user',
      companyStatus,
      companySuspended,
      ...mfa,
      realRole: realUser.role ?? 'user',
      actingAs: actAs
        ? { sessionId: actAs._id, companyId: actAs.companyId, allowWrites: actAs.allowWrites, expiresAt: actAs.expiresAt }
        : null,
      hasPhone: !!user.phone,
      maskedPhone: user.phone ? maskPhone(user.phone) : null,
    }
  },
})

/**
 * The caller's interface language (I18N-002). Only languages with a committed
 * catalog are accepted; null clears it so the organization's default applies.
 * Allowed before two-step verification so /verify can switch language.
 */
export const setLocale = mutation({
  args: { locale: v.union(v.string(), v.null()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { locale }) => {
    const user = await requireAccount(ctx, { allowPendingMfa: true })
    if (locale !== null && !(SUPPORTED_UI_LOCALES as readonly string[]).includes(locale)) {
      throw userError('VALIDATION', `Language ${locale} is not available`, { field: 'locale' })
    }
    await ctx.db.patch(user._id, { locale: locale ?? undefined })
    return locale
  },
})

export const get = query({
  args: { id: v.id('users') },
  returns: v.union(userRow, v.null()),
  handler: async (ctx, { id }) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
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
  returns: v.array(userRow),
  handler: async (ctx) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
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
  returns: v.array(v.object({ id: v.id('users'), name: v.string(), email: v.string() })),
  handler: async (ctx) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.view' })
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
  returns: v.union(
    v.object({ exists: v.boolean(), userId: v.id('users') }),
    v.object({ exists: v.boolean() }),
  ),
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
  returns: v.id('users'),
  handler: async (ctx, { id, patch }) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
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

    const next: Partial<Doc<'users'>> = { ...patch }
    let phoneChanged = false
    if (patch.phone !== undefined) {
      // Phones are E.164 and unique: phone sign-in looks accounts up by them.
      if (patch.phone.trim()) {
        next.phone = await normalizeForCompany(ctx, patch.phone, target.companyId)
        await assertPhoneFree(ctx, next.phone, id)
      } else {
        next.phone = undefined
      }
      phoneChanged = next.phone !== target.phone
      if (phoneChanged) {
        await assertMayChangePhone(ctx, me, target)
        // A number set by someone else is unverified until its owner confirms it.
        next.phoneVerificationTime = undefined
      } else {
        delete next.phone
      }
    }

    // Dual-write the role to the membership of the caller's company (M2).
    const roleCompany = ((me.role ?? 'user') === 'super_admin' ? target.companyId : me.companyId)
    let roleWrite: { m: Doc<'memberships'> | null; roleKey: string } | null = null
    if (patch.role && patch.role !== 'super_admin' && roleCompany) {
      const m = await getMembership(ctx, id, roleCompany)
      if (m || target.companyId === roleCompany) {
        // Keep owner/admin when the legacy role is still admin; otherwise map.
        const keep = m && legacyRoleFromKey(m.roleKey) === patch.role
        const roleKey = keep ? m.roleKey : roleKeyFromLegacy(patch.role)
        // Same owner rule as memberships.setRole: only an owner changes an owner.
        if (m && roleKey !== m.roleKey) await assertAdminChange(ctx, me, roleCompany, m, { roleKey })
        roleWrite = { m, roleKey }
      }
    }

    await ctx.db.patch(id, next)
    if (phoneChanged) {
      await dropPendingPhoneCodes(ctx, id, target.phone)
      await revokeWhatsAppNotMatching(ctx, id, undefined, false)
    }
    if (roleWrite && roleCompany) {
      const { m, roleKey } = roleWrite
      await upsertMembership(ctx, {
        userId: id,
        companyId: roleCompany,
        roleKey,
        actorId: me._id,
        ...(m ? {} : { status: target.active === false ? ('suspended' as const) : ('active' as const) }),
      })
    }
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'users',
      recordId: id,
      previousValues: {
        role: target.role,
        name: target.name,
        ...(patch.phone !== undefined ? { phone: target.phone ? maskPhone(target.phone) : null } : {}),
      },
      newValues: {
        ...patch,
        ...(patch.phone !== undefined ? { phone: next.phone ? maskPhone(next.phone) : null } : {}),
      },
    })
    return id
  },
})

/**
 * Admin: set or clear a member's mobile number (SEC-006). Stored in E.164
 * using the company's default country; unique across accounts; audited.
 * Refused for members of other organizations too; the number stays
 * unverified (no phone sign-in) until the member confirms it.
 */
export const setPhone = mutation({
  args: { id: v.id('users'), phone: v.union(v.string(), v.null()) },
  returns: v.object({ phone: v.union(v.string(), v.null()) }),
  handler: async (ctx, { id, phone }) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
    const target = await ctx.db.get(id)
    if (!target) throw new Error('User not found')
    if ((me.role ?? 'user') !== 'super_admin') {
      if (!me.companyId || target.companyId !== me.companyId) {
        throw new Error('Access denied')
      }
    }
    assertMayModify(me, target)
    let next: string | undefined
    if (phone !== null && phone.trim()) {
      next = await normalizeForCompany(ctx, phone, target.companyId)
      await assertPhoneFree(ctx, next, id)
    }
    if (next === target.phone) return { phone: next ?? null }
    await assertMayChangePhone(ctx, me, target)
    // A number set by an admin is unverified: phone sign-in refuses it until
    // its owner confirms it with a code (phoneAuth, mfa).
    await ctx.db.patch(id, { phone: next, phoneVerificationTime: undefined })
    await dropPendingPhoneCodes(ctx, id, target.phone)
    await revokeWhatsAppNotMatching(ctx, id, undefined, false)
    await logAudit(ctx, {
      actionType: next ? 'set_phone' : 'clear_phone',
      tableName: 'users',
      recordId: id,
      previousValues: { phone: target.phone ? maskPhone(target.phone) : null },
      newValues: { phone: next ? maskPhone(next) : null },
    })
    return { phone: next ?? null }
  },
})

/**
 * Sign-up "Phone (for field codes)" (Paper 60): the new account saves its own
 * number once, unverified. Phone sign-in and codes ignore it until the owner
 * confirms it with a code (mfa.startPhoneConfirmation), so typing someone
 * else's number gains nothing. Only while the account has no number: changing
 * a number goes through the confirmation flow.
 */
export const setMyPhone = mutation({
  args: { phone: v.string() },
  returns: v.object({ phone: v.string() }),
  handler: async (ctx, { phone }) => {
    const me = await requireAccount(ctx)
    if (me.phone) throw userError('CONFLICT', 'This account already has a phone number. Change it from your profile.')
    const next = await normalizeForCompany(ctx, phone, me.companyId)
    await assertPhoneFree(ctx, next, me._id)
    await ctx.db.patch(me._id, { phone: next, phoneVerificationTime: undefined })
    await logAudit(ctx, {
      actionType: 'set_phone',
      tableName: 'users',
      recordId: me._id,
      previousValues: { phone: null },
      newValues: { phone: maskPhone(next) },
    })
    return { phone: next }
  },
})

/**
 * Invite by email into the caller's company (ORG-003). Never changes an
 * existing account: it records a pending invite with a single-use link that
 * expires in 7 days, emails the link, and returns it so the admin can share it
 * directly. The invitee accepts at /invite/<token> after verifying their email
 * (memberships.acceptInvite). People who already belong to another
 * organization can be invited too: they gain a second membership.
 * Super_admin accounts cannot be invited.
 */
export const invite = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal('user'), v.literal('admin'))),
    /** Role template (admin | manager | field_staff | viewer); overrides `role`. */
    roleKey: v.optional(v.string()),
    /** Sites the membership will cover (Paper 61); omitted or empty = every site. */
    locationIds: v.optional(v.array(v.id('farmLocations'))),
  },
  returns: v.object({ status: v.union(v.literal('invited'), v.literal('pending_signup')), inviteUrl: v.string(), expiresAt: v.number(), message: v.string() }),
  handler: async (ctx, args) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
    if (!me.companyId) throw new Error('No company linked')
    const companyId = me.companyId
    // Early, friendly refusal; accepting the invite checks again (lib/memberships).
    await assertPlanLimit(ctx, companyId, 'users')
    const email = args.email.trim().toLowerCase()
    if (!email) throw new Error('Email is required')
    if (args.roleKey !== undefined && !isRoleKey(args.roleKey)) {
      throw new Error(`Unknown role: ${args.roleKey}`)
    }
    if (args.roleKey === 'owner') throw new Error('Invite as admin, then make them an owner')
    const roleKey = args.roleKey ?? roleKeyFromLegacy(args.role || 'user')
    const role = legacyRoleFromKey(roleKey)
    const locationIds = [...new Set(args.locationIds ?? [])]
    if (locationIds.length > 100) throw userError('VALIDATION', 'Choose at most 100 sites')
    for (const id of locationIds) {
      const site = await ctx.db.get(id)
      if (!site || site.companyId !== companyId) throw userError('NOT_FOUND', 'Site not found')
    }

    const existing = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .unique()

    if (existing) {
      if ((existing.role ?? 'user') === 'super_admin') {
        throw new Error('This account cannot be invited')
      }
      const membership = await getMembership(ctx, existing._id, companyId)
      if (
        membership?.status === 'active' ||
        (!membership && existing.companyId === companyId)
      ) {
        throw new Error('This person is already a member of your company')
      }
    }

    const now = Date.now()
    const token = randomToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = now + INVITE_TTL_MS
    const prior = await ctx.db
      .query('userInvites')
      .withIndex('by_company_and_email', (q) =>
        q.eq('companyId', companyId).eq('email', email),
      )
      .first()
    const fields = {
      role,
      roleKey,
      invitedBy: me._id,
      createdAt: now,
      status: 'pending' as const,
      tokenHash,
      expiresAt,
      locationIds: locationIds.length > 0 ? locationIds : undefined,
    }
    let inviteId: Id<'userInvites'>
    if (prior) {
      inviteId = prior._id
      await ctx.db.patch(prior._id, {
        ...fields,
        requestedByUserId: undefined,
        requestedAt: undefined,
        decidedBy: undefined,
        decidedAt: undefined,
        acceptedBy: undefined,
        acceptedAt: undefined,
      })
    } else {
      inviteId = await ctx.db.insert('userInvites', { email, companyId, ...fields })
    }

    const company = await ctx.db.get(companyId)
    const inviteUrl = `${siteUrl()}/invite/${token}`
    const mail = inviteEmail(emailContext(existing?.locale ?? me.locale), {
      inviterName: me.name || me.email || '',
      orgName: company?.name ?? '',
      roleKey,
      roleLabel: isTemplateKey(roleKey) ? TEMPLATE_LABELS[roleKey] : roleKey,
      email,
      token,
      expiresAt,
    })
    await ctx.scheduler.runAfter(0, internal.emails.send, {
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })

    await logAudit(ctx, {
      actionType: 'invite',
      tableName: 'userInvites',
      recordId: inviteId,
      newValues: { email, role, roleKey, companyId, existingUser: !!existing, expiresAt },
    })
    return {
      status: existing ? ('invited' as const) : ('pending_signup' as const),
      inviteUrl,
      expiresAt,
      message: existing
        ? 'Invite sent. They accept it from the link in the email, or share the link below.'
        : 'Invite sent. They sign up with this email, then open the link to join.',
    }
  },
})

export const deactivate = mutation({
  args: { id: v.id('users') },
  returns: v.id('users'),
  handler: async (ctx, { id }) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
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
    // A member of other organizations keeps their account: only this
    // company's membership is suspended (ORG-002). Otherwise the account is
    // deactivated as before.
    const companyId = ((me.role ?? 'user') === 'super_admin' ? target.companyId : me.companyId)
    const others = companyId ? await otherActiveMemberships(ctx, id, companyId) : []
    if (companyId) {
      await upsertMembership(ctx, {
        userId: id,
        companyId,
        status: 'suspended',
        actorId: me._id,
        ...((await getMembership(ctx, id, companyId))
          ? {}
          : { roleKey: roleKeyFromLegacy(target.role) }),
      })
    }
    let sessionsRevoked = 0
    if (others.length > 0 && (me.role ?? 'user') !== 'super_admin' && companyId) {
      await leaveActiveCompany(ctx, id, companyId)
    } else {
      await ctx.db.patch(id, { active: false })
      // Sign them out everywhere now, not when their sessions expire.
      sessionsRevoked = await revokeUserSessions(ctx, id)
    }
    await logAudit(ctx, {
      actionType: 'deactivate',
      tableName: 'users',
      recordId: id,
      newValues: { active: false, sessionsRevoked, membershipOnly: others.length > 0 },
    })
    return id
  },
})

export const reactivate = mutation({
  args: { id: v.id('users') },
  returns: v.id('users'),
  handler: async (ctx, { id }) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
    const target = await ctx.db.get(id)
    if (!target) throw new Error('User not found')
    if ((me.role ?? 'user') !== 'super_admin') {
      if (!me.companyId || target.companyId !== me.companyId) {
        throw new Error('Access denied')
      }
    }
    assertMayModify(me, target)
    await ctx.db.patch(id, { active: true })
    const companyId = ((me.role ?? 'user') === 'super_admin' ? target.companyId : me.companyId)
    if (companyId) {
      const m = await getMembership(ctx, id, companyId)
      if (m || target.companyId === companyId) {
        await upsertMembership(ctx, {
          userId: id,
          companyId,
          status: 'active',
          actorId: me._id,
          ...(m ? {} : { roleKey: roleKeyFromLegacy(target.role) }),
        })
      }
    }
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
  returns: v.array(
    v.object({
      id: v.id('userInvites'),
      companyId: v.id('companies'),
      companyName: v.string(),
      role: v.union(v.literal('user'), v.literal('admin')),
      status: v.union(v.literal('pending'), v.literal('requested')),
    }),
  ),
  handler: async (ctx) => {
    const me = await requireAccount(ctx)
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
  returns: v.union(
    v.object({ claimed: v.boolean(), requested: v.boolean() }),
    v.object({ claimed: v.boolean(), requested: v.boolean(), reason: v.string() }),
    v.object({ claimed: v.boolean(), requested: v.boolean(), companyId: v.id('companies') }),
  ),
  handler: async (ctx, args) => {
    const me = await requireAccount(ctx)
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
    await onApprovalRequested(ctx, 'join_request', invite._id)
    return { claimed: false, requested: true, companyId: invite.companyId }
  },
})

/** Company admin: people who asked to join through an invite. */
export const listJoinRequests = query({
  args: {},
  returns: v.array(v.object({ id: v.id('userInvites'), email: v.string(), role: v.union(v.literal('user'), v.literal('admin')), name: v.union(v.string(), v.null()), requestedAt: v.union(v.number(), v.null()) })),
  handler: async (ctx) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
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
  returns: v.object({ userId: v.id('users') }),
  handler: async (ctx, { inviteId }) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
    const invite = await loadJoinRequest(ctx, me, inviteId)
    const target = await ctx.db.get(invite.requestedByUserId)
    if (!target) throw new Error('User not found')
    if ((target.role ?? 'user') === 'super_admin') {
      throw new Error('This account cannot be invited')
    }
    if ((target.email ?? '').toLowerCase() !== invite.email) {
      throw new Error('Join request does not match the invited email')
    }
    await upsertMembership(ctx, {
      userId: target._id,
      companyId: invite.companyId,
      roleKey: invite.roleKey ?? roleKeyFromLegacy(invite.role),
      status: 'active',
      actorId: me._id,
    })
    // Becomes their active organization only if they have none yet.
    if (!target.companyId) {
      await ctx.db.patch(target._id, { companyId: invite.companyId, role: invite.role })
    }
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
    await onApprovalDecided(ctx, 'join_request', invite._id, 'approved', me._id)
    return { userId: target._id }
  },
})

/** Company admin: refuse a join request. */
export const declineJoinRequest = mutation({
  args: { inviteId: v.id('userInvites') },
  returns: v.id('userInvites'),
  handler: async (ctx, { inviteId }) => {
    const { user: me } = await requireMember(ctx, { permission: 'org.members.manage' })
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
    await onApprovalDecided(ctx, 'join_request', invite._id, 'rejected', me._id)
    return invite._id
  },
})

/** For actions: the caller, refused unless they hold the permission (requireMember). */
export const authorizedMember = internalQuery({
  args: { permission: v.string() },
  returns: v.object({ _id: v.id('users'), role: v.union(v.literal('user'), v.literal('admin'), v.literal('super_admin')), companyId: v.optional(v.id('companies')) }),
  handler: async (ctx, { permission }) => {
    if (!isPermission(permission)) throw new Error(`Unknown permission: ${permission}`)
    const m = await requireMember(ctx, { permission })
    return { _id: m.user._id, role: m.user.role ?? 'user', companyId: m.user.companyId }
  },
})

/** For actions: the caller, with the same refusals as requireUser. */
export const authorizedCaller = internalQuery({
  args: {},
  returns: v.object({ _id: v.id('users'), role: v.union(v.literal('user'), v.literal('admin'), v.literal('super_admin')), companyId: v.optional(v.id('companies')) }),
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
  returns: v.id('users'),
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
  returns: v.id('users'),
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
    await upsertMembership(ctx, {
      userId: args.userId,
      companyId: args.companyId,
      roleKey: roleKeyFromLegacy(args.role),
      status: 'active',
      actorId: args.actorId,
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
  returns: v.id('users'),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')
    await ctx.db.patch(userId, { mustChangePassword: false })
    // Called after every password change (userAccounts.changePassword).
    await insertAudit(ctx, {
      userId,
      companyId: user.companyId,
      actionType: 'password_change',
      tableName: 'users',
      recordId: userId,
    })
    return userId
  },
})
