/**
 * Permission catalog, role templates and the member guard (D-005, PERM-001,
 * PERM-002, PERM-004).
 *
 * Every public tenant function starts with
 *   const { user } = await requireMember(ctx, { permission: '…', locationId? })
 * which runs requireUser (account, company, 2FA and membership checks), then
 * resolves the caller's permissions from their membership in the active
 * organization (a role template, or a custom `roles` row) and their site
 * scope. Platform functions use requirePlatformAdmin; self-service functions
 * (my notifications, my invites, my account) use requireAccount.
 *
 * Template mapping of today's roles (owner decision): `admin` → admin,
 * `user` → manager, which keeps exactly today's access: manager has every
 * permission except ADMIN_ONLY, and ADMIN_ONLY is what was admin-gated before.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireUser } from './authz'
import { AUTH_ERROR_MESSAGES } from './authErrors'
import { userError } from './errors'
import { activeMembership, getMembership } from './memberships'
import { actAsSessionOf } from './actAs'
import {
  PERMISSIONS,
  ROLE_TEMPLATES,
  TEMPLATE_LABELS,
  isPermission,
  isTemplateKey,
  type Permission,
} from './permissionCatalog'

type Ctx = QueryCtx | MutationCtx

export {
  ADMIN_ONLY,
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_TEMPLATES,
  TEMPLATE_LABELS,
  isPermission,
  isTemplateKey,
} from './permissionCatalog'
export type { Permission, TemplateKey } from './permissionCatalog'

export type MemberContext = {
  user: Doc<'users'>
  /** undefined only for a company-less platform admin. */
  companyId: Id<'companies'> | undefined
  membership: Doc<'memberships'> | null
  roleKey: string
  roleName: string
  permissions: ReadonlySet<Permission>
  /** 'all' or the site ids this member may touch. */
  siteScope: 'all' | ReadonlySet<Id<'farmLocations'>>
  isPlatformAdmin: boolean
}

function forbidden(permission: string): never {
  throw userError('FORBIDDEN', `Insufficient permissions: ${permission}`, { permission })
}

/** Permissions and scope of a user in their active organization. */
export async function memberContext(ctx: Ctx, user: Doc<'users'>): Promise<MemberContext> {
  // Support access (ENT-006): every permission, every site, this organization only.
  const actAs = actAsSessionOf(user)
  if (actAs) {
    return {
      user,
      companyId: actAs.companyId,
      membership: null,
      roleKey: 'owner',
      roleName: 'Platform support',
      permissions: new Set(PERMISSIONS),
      siteScope: 'all',
      isPlatformAdmin: false,
    }
  }
  if ((user.role ?? 'user') === 'super_admin') {
    return {
      user,
      companyId: user.companyId,
      membership: null,
      roleKey: 'owner',
      roleName: 'Platform admin',
      permissions: new Set(PERMISSIONS),
      siteScope: 'all',
      isPlatformAdmin: true,
    }
  }
  const m = await activeMembership(ctx, user)
  if (!m || !user.companyId) {
    return {
      user,
      companyId: undefined,
      membership: null,
      roleKey: 'none',
      roleName: 'No organization',
      permissions: new Set(),
      siteScope: new Set(),
      isPlatformAdmin: false,
    }
  }
  return fromMembership(ctx, user, m)
}

async function fromMembership(
  ctx: Ctx,
  user: Doc<'users'>,
  m: Doc<'memberships'> & { synthesized?: true },
): Promise<MemberContext> {
  let permissions: Permission[] = []
  let roleName: string = m.roleKey
  if (m.roleId) {
    const role = await ctx.db.get(m.roleId)
    if (role && role.companyId === m.companyId && !role.archived) {
      permissions = role.permissions.filter(isPermission)
      roleName = role.name
    }
  } else if (isTemplateKey(m.roleKey)) {
    permissions = [...ROLE_TEMPLATES[m.roleKey]]
    roleName = TEMPLATE_LABELS[m.roleKey]
  }
  return {
    user,
    companyId: m.companyId,
    membership: m.synthesized ? null : m,
    roleKey: m.roleKey,
    roleName,
    permissions: new Set(permissions),
    siteScope: m.allLocations ? 'all' : new Set(m.locationIds ?? []),
    isPlatformAdmin: false,
  }
}

/**
 * A user's permissions in a given company, whichever organization is active
 * for them now (scheduled jobs acting for or sending to a member). null when
 * the account is inactive or not an active member of that company. Platform
 * admins get no implicit access here.
 */
export async function memberContextIn(
  ctx: Ctx,
  user: Doc<'users'>,
  companyId: Id<'companies'>,
): Promise<MemberContext | null> {
  if (user.active === false) return null
  if ((user.role ?? 'user') === 'super_admin') return null
  const m = user.companyId === companyId ? await activeMembership(ctx, user) : await getMembership(ctx, user._id, companyId)
  if (!m || m.companyId !== companyId || m.status !== 'active') return null
  return fromMembership(ctx, user, m)
}

/** Throw FORBIDDEN unless the member holds `permission`. */
export function requirePermission(m: MemberContext, permission: Permission) {
  if (!m.permissions.has(permission)) forbidden(permission)
}

export function can(m: MemberContext, permission: Permission) {
  return m.permissions.has(permission)
}

/** Throw unless the site is in the member's scope (sites of other companies are never in scope). */
export function assertSiteInScope(m: MemberContext, locationId: Id<'farmLocations'> | undefined | null) {
  if (!locationId || m.siteScope === 'all') return
  if (!m.siteScope.has(locationId)) {
    throw userError('FORBIDDEN', 'You do not have access to this site', { reason: 'SITE_FORBIDDEN' })
  }
}

/**
 * The member guard (D-005). Account checks (requireUser), an active
 * organization, the permission, and — when `locationId` is given — that the
 * site belongs to the organization and is in the member's scope.
 */
export async function requireMember(
  ctx: Ctx,
  opts: {
    permission: Permission
    locationId?: Id<'farmLocations'> | null
    /** Read-like mutation allowed during read-only support access (ENT-006). */
    allowActAsReadOnly?: boolean
  },
): Promise<MemberContext> {
  const user = await requireUser(ctx, { allowActAsReadOnly: opts.allowActAsReadOnly })
  const m = await memberContext(ctx, user)
  if (!m.isPlatformAdmin && !m.companyId) {
    throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  }
  requirePermission(m, opts.permission)
  if (opts.locationId) {
    const site = await ctx.db.get(opts.locationId)
    if (!site || (!m.isPlatformAdmin && site.companyId !== m.companyId)) {
      throw userError('NOT_FOUND', 'Site not found')
    }
    assertSiteInScope(m, opts.locationId)
  }
  return m
}

/** For code that has a user but no member context (shared libs): permission check by user. */
export async function assertUserCan(ctx: Ctx, user: Doc<'users'>, permission: Permission) {
  const m = await memberContext(ctx, user)
  requirePermission(m, permission)
}

/**
 * Self-service functions that act only on the caller's own account (their
 * notifications, invites, verification, registration). Same account checks as
 * every other function; no organization permission.
 */
export async function requireAccount(ctx: Ctx, opts?: Parameters<typeof requireUser>[1]) {
  return await requireUser(ctx, opts)
}

/** Platform functions (company approval, platform lists): super_admin only. */
export async function requirePlatformAdmin(ctx: Ctx): Promise<Doc<'users'>> {
  const user = await requireUser(ctx)
  if ((user.role ?? 'user') !== 'super_admin') forbidden('platform.admin')
  return user
}

/**
 * Segregation of duties (PERM-005): when the organization turns on
 * stockingRules.requireDifferentApprover, the person who requested a
 * stocking, top-up or transfer cannot approve it. Off by default.
 */
export async function assertDifferentApprover(
  ctx: Ctx,
  approver: Doc<'users'>,
  record: { createdBy?: Id<'users'>; companyId?: Id<'companies'> },
) {
  if (!record.createdBy || record.createdBy !== approver._id || !record.companyId) return
  const company = await ctx.db.get(record.companyId)
  if (company?.settings?.stockingRules?.requireDifferentApprover === true) {
    throw userError('FORBIDDEN', 'Someone other than the requester must approve this', {
      reason: 'SAME_APPROVER',
    })
  }
}
