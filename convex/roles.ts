/**
 * Roles (PERM-001, PERM-002): the caller's permissions, the role list (code
 * templates plus the organization's custom roles) and custom role editing.
 * Assigning roles and sites to members lives in memberships.ts.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import {
  PERMISSION_GROUPS,
  ROLE_TEMPLATES,
  TEMPLATE_LABELS,
  isPermission,
  isTemplateKey,
  memberContext,
  requireAccount,
  requireMember,
} from './lib/permissions'

/** What I may do in my active organization; drives the UI (usePermission). */
export const myPermissions = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    const m = await memberContext(ctx, user)
    return {
      companyId: m.companyId ?? null,
      roleKey: m.roleKey,
      roleName: m.roleName,
      permissions: [...m.permissions].sort(),
      allSites: m.siteScope === 'all',
      siteIds: m.siteScope === 'all' ? [] : [...m.siteScope],
      isPlatformAdmin: m.isPlatformAdmin,
    }
  },
})

/** Templates and this organization's custom roles, with the permission catalog. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.view' })
    const custom = companyId
      ? await ctx.db
          .query('roles')
          .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId))
          .take(200)
      : []
    return {
      catalog: Object.entries(PERMISSION_GROUPS).map(([group, perms]) => ({
        group,
        permissions: Object.entries(perms).map(([key, label]) => ({ key, label })),
      })),
      templates: (Object.keys(ROLE_TEMPLATES) as Array<keyof typeof ROLE_TEMPLATES>).map((key) => ({
        key,
        name: TEMPLATE_LABELS[key],
        permissions: [...ROLE_TEMPLATES[key]],
      })),
      custom: custom
        .filter((r) => !r.archived)
        .map((r) => ({
          id: r._id,
          key: r.key,
          name: r.name,
          description: r.description ?? null,
          basedOn: r.basedOn ?? null,
          permissions: r.permissions,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  },
})

function cleanPermissions(permissions: string[]) {
  const unknown = permissions.filter((p) => !isPermission(p))
  if (unknown.length) {
    throw userError('VALIDATION', `Unknown permissions: ${unknown.join(', ')}`)
  }
  return [...new Set(permissions)].sort()
}

function cleanName(name: string) {
  const n = name.trim()
  if (!n) throw userError('VALIDATION', 'Role name is required')
  if (n.length > 60) throw userError('VALIDATION', 'Role name is too long')
  return n
}

async function loadCustomRole(
  ctx: Parameters<typeof requireAccount>[0],
  companyId: Id<'companies'> | undefined,
  roleId: Id<'roles'>,
): Promise<Doc<'roles'>> {
  const role = await ctx.db.get(roleId)
  if (!role || role.companyId !== companyId || role.archived) {
    throw userError('NOT_FOUND', 'Role not found')
  }
  return role
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    basedOn: v.optional(v.string()),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.roles.manage' })
    if (!companyId) throw userError('VALIDATION', 'No company linked')
    const name = cleanName(args.name)
    const permissions = cleanPermissions(args.permissions)
    if (args.basedOn !== undefined && !isTemplateKey(args.basedOn)) {
      throw userError('VALIDATION', `Unknown template: ${args.basedOn}`)
    }
    const base = `c_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'role'}`
    let key = base
    for (let i = 2; ; i++) {
      const taken = await ctx.db
        .query('roles')
        .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId).eq('key', key))
        .first()
      if (!taken) break
      key = `${base}_${i}`
    }
    const id = await ctx.db.insert('roles', {
      companyId,
      key,
      name,
      description: args.description?.trim() || undefined,
      basedOn: args.basedOn,
      permissions,
      isTemplate: false,
      archived: false,
      updatedAt: Date.now(),
      updatedBy: user._id,
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'roles',
      recordId: id,
      newValues: { key, name, permissions },
    })
    return id
  },
})

export const update = mutation({
  args: {
    roleId: v.id('roles'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    permissions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.roles.manage' })
    const role = await loadCustomRole(ctx, companyId, args.roleId)
    const patch: Partial<Doc<'roles'>> = { updatedAt: Date.now(), updatedBy: user._id }
    if (args.name !== undefined) patch.name = cleanName(args.name)
    if (args.description !== undefined) patch.description = args.description.trim() || undefined
    if (args.permissions !== undefined) patch.permissions = cleanPermissions(args.permissions)
    await ctx.db.patch(role._id, patch)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'roles',
      recordId: role._id,
      previousValues: { name: role.name, permissions: role.permissions },
      newValues: patch,
    })
    return role._id
  },
})

/** Archive a custom role; refused while members still hold it. */
export const archive = mutation({
  args: { roleId: v.id('roles') },
  handler: async (ctx, { roleId }) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.roles.manage' })
    const role = await loadCustomRole(ctx, companyId, roleId)
    const members = await ctx.db
      .query('memberships')
      .withIndex('by_companyId', (q) => q.eq('companyId', role.companyId))
      .take(1000)
    const holders = members.filter((m) => m.roleId === roleId && m.status !== 'removed')
    if (holders.length) {
      throw userError(
        'CONFLICT',
        `${holders.length} member${holders.length === 1 ? '' : 's'} still have this role. Give them another role first.`,
      )
    }
    await ctx.db.patch(roleId, { archived: true, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'archive',
      tableName: 'roles',
      recordId: roleId,
      previousValues: { name: role.name },
    })
    return roleId
  },
})
