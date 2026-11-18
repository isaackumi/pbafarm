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
import { activeMembership } from './memberships'

type Ctx = QueryCtx | MutationCtx

export const PERMISSION_GROUPS = {
  Organization: {
    'org.view': 'See the organization, its sites and people',
    'org.settings.manage': 'Change organization settings, profile and security',
    'org.members.manage': 'Invite, suspend and remove members; set their roles and sites',
    'org.roles.manage': 'Create and edit custom roles',
    'org.sites.manage': 'Add and edit sites',
    'org.audit.view': 'Read the audit log',
    'integrations.manage': 'Configure messaging channels',
  },
  Production: {
    'production.view': 'See units, stockings, records and batches',
    'production.units.manage': 'Add and edit units',
    'production.units.delete': 'Delete units',
    'production.stock.adjust': 'Correct fish counts and unit status by hand',
    'production.daily.record': 'Record daily feed and mortality',
    'production.daily.correct': 'Edit daily records',
    'production.sampling.record': 'Record sampling',
    'production.sampling.correct': 'Edit sampling records',
    'production.stocking.request': 'Request stockings and top-ups',
    'production.stocking.approve': 'Approve, edit and reject stockings and top-ups',
    'production.transfer.request': 'Request fish transfers',
    'production.transfer.approve': 'Approve, reject and reverse transfers; grade batches',
    'production.harvest.record': 'Record harvests and harvest sampling',
    'production.harvest.correct': 'Edit harvests',
    'production.health.record': 'Record treatments',
    'production.records.delete': 'Delete production records',
    'production.import': 'Bulk-import records',
  },
  Inventory: {
    'inventory.view': 'See stock, purchases and movements',
    'inventory.issue': 'Issue feed and items',
    'inventory.purchase.record': 'Record purchases, suppliers, items and orders',
    'inventory.purchase.correct': 'Edit or void purchases and orders',
    'inventory.adjust': 'Adjust, transfer and reverse stock; override stock checks',
    'inventory.prices.manage': 'Manage feed types, item prices and suppliers',
  },
  Finance: {
    'finance.view': 'See sales, expenses and profit and loss',
    'finance.sales.record': 'Record sales',
    'finance.sales.correct': 'Edit or delete sales; manage customers',
    'finance.expenses.record': 'Record expenses',
    'finance.expenses.manage': 'Edit expenses and categories',
  },
  Reports: {
    'reports.view': 'See dashboards and reports',
    'reports.export': 'Export data',
    'ai.use': 'Use the farm assistant',
  },
} as const

type Groups = typeof PERMISSION_GROUPS
export type Permission = { [G in keyof Groups]: keyof Groups[G] }[keyof Groups]

export const PERMISSIONS = Object.values(PERMISSION_GROUPS).flatMap((g) =>
  Object.keys(g),
) as Permission[]

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as string[]).includes(value)
}

/** Admin-gated before Phase 3: managers (today's `user` role) do not get these. */
export const ADMIN_ONLY: readonly Permission[] = [
  'org.settings.manage',
  'org.members.manage',
  'org.roles.manage',
  'org.sites.manage',
  'org.audit.view',
  'integrations.manage',
  'production.units.delete',
  'production.stock.adjust',
  'production.records.delete',
  'production.import',
  'production.stocking.approve',
  'production.transfer.approve',
  'inventory.purchase.correct',
  'inventory.adjust',
  'inventory.prices.manage',
  'finance.sales.correct',
  'finance.expenses.manage',
]

export const ROLE_TEMPLATES = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !ADMIN_ONLY.includes(p)),
  field_staff: [
    'org.view',
    'production.view',
    'production.daily.record',
    'production.sampling.record',
    'production.stocking.request',
    'production.transfer.request',
    'production.harvest.record',
    'production.health.record',
    'inventory.view',
    'inventory.issue',
    'reports.view',
  ],
  viewer: ['org.view', 'production.view', 'inventory.view', 'finance.view', 'reports.view'],
} as const satisfies Record<string, readonly Permission[]>

export type TemplateKey = keyof typeof ROLE_TEMPLATES

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  field_staff: 'Field staff',
  viewer: 'Viewer',
}

export function isTemplateKey(key: string): key is TemplateKey {
  return Object.prototype.hasOwnProperty.call(ROLE_TEMPLATES, key)
}

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
    companyId: user.companyId,
    membership: m.synthesized ? null : m,
    roleKey: m.roleKey,
    roleName,
    permissions: new Set(permissions),
    siteScope: m.allLocations ? 'all' : new Set(m.locationIds ?? []),
    isPlatformAdmin: false,
  }
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
  opts: { permission: Permission; locationId?: Id<'farmLocations'> | null },
): Promise<MemberContext> {
  const user = await requireUser(ctx)
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
