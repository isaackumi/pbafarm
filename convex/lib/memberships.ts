/**
 * Memberships (D-002, ORG-001): a user's role in one organization.
 *
 * users.companyId is the active-organization pointer and users.role mirrors the
 * active membership's role in the legacy two-value form ('admin' | 'user'), so
 * every guard that still reads users.role keeps working. Every write path that
 * changes a member's role or status goes through here (dual-write).
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

export const ROLE_KEYS = ['owner', 'admin', 'manager', 'field_staff', 'viewer'] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value)
}

/** Legacy users.role → template (owner decision: user → manager keeps today's access). */
export function roleKeyFromLegacy(role: Doc<'users'>['role']): RoleKey {
  return role === 'admin' || role === 'super_admin' ? 'admin' : 'manager'
}

/** Template → legacy users.role for the active organization. */
export function legacyRoleFromKey(roleKey: string): 'admin' | 'user' {
  return roleKey === 'owner' || roleKey === 'admin' ? 'admin' : 'user'
}

export const MAX_SCOPED_LOCATIONS = 100

export async function getMembership(
  ctx: Ctx,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
): Promise<Doc<'memberships'> | null> {
  return await ctx.db
    .query('memberships')
    .withIndex('by_companyId_and_userId', (q) =>
      q.eq('companyId', companyId).eq('userId', userId),
    )
    .unique()
}

/**
 * The membership for the user's active organization, or a synthesized one
 * from users.companyId + users.role when no row exists yet (M2 dual-read
 * fallback). null when the user has no active organization.
 */
export async function activeMembership(
  ctx: Ctx,
  user: Doc<'users'>,
): Promise<(Doc<'memberships'> & { synthesized?: true }) | null> {
  if (!user.companyId) return null
  const row = await getMembership(ctx, user._id, user.companyId)
  if (row) return row
  return {
    _id: 'synthesized' as Id<'memberships'>,
    _creationTime: 0,
    userId: user._id,
    companyId: user.companyId,
    roleKey: roleKeyFromLegacy(user.role),
    allLocations: !(user.locationIds && user.locationIds.length > 0),
    locationIds: user.locationIds,
    status: user.active === false ? 'suspended' : 'active',
    legacy: true,
    updatedAt: 0,
    synthesized: true,
  }
}

/**
 * Create or update the membership of a user in a company (dual-write).
 * When the company is the user's active one, users.role follows the role
 * (super_admin accounts keep their platform role).
 */
export async function upsertMembership(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>
    companyId: Id<'companies'>
    roleKey?: string
    status?: Doc<'memberships'>['status']
    allLocations?: boolean
    locationIds?: Id<'farmLocations'>[]
    actorId?: Id<'users'>
    legacy?: boolean
  },
): Promise<Id<'memberships'>> {
  const now = Date.now()
  const existing = await getMembership(ctx, args.userId, args.companyId)
  let id: Id<'memberships'>
  if (existing) {
    const patch: Partial<Doc<'memberships'>> = { updatedAt: now }
    if (args.roleKey !== undefined) patch.roleKey = args.roleKey
    if (args.allLocations !== undefined) patch.allLocations = args.allLocations
    if (args.locationIds !== undefined) patch.locationIds = args.locationIds
    if (args.status !== undefined && args.status !== existing.status) {
      patch.status = args.status
      patch.statusChangedAt = now
      patch.statusChangedBy = args.actorId
      if (args.status === 'active' && !existing.joinedAt) patch.joinedAt = now
    }
    await ctx.db.patch(existing._id, patch)
    id = existing._id
  } else {
    const status = args.status ?? 'active'
    id = await ctx.db.insert('memberships', {
      userId: args.userId,
      companyId: args.companyId,
      roleKey: args.roleKey ?? 'manager',
      allLocations: args.allLocations ?? true,
      locationIds: args.locationIds,
      status,
      invitedBy: args.actorId,
      joinedAt: status === 'active' ? now : undefined,
      statusChangedAt: now,
      statusChangedBy: args.actorId,
      legacy: args.legacy,
      updatedAt: now,
    })
  }
  const user = await ctx.db.get(args.userId)
  if (user && user.companyId === args.companyId && args.roleKey !== undefined) {
    await syncLegacyRole(ctx, user, args.roleKey)
  }
  return id
}

async function syncLegacyRole(ctx: MutationCtx, user: Doc<'users'>, roleKey: string) {
  if ((user.role ?? 'user') === 'super_admin') return
  const role = legacyRoleFromKey(roleKey)
  if ((user.role ?? 'user') !== role) await ctx.db.patch(user._id, { role })
}

/**
 * Make `companyId` the user's active organization: users.companyId, the
 * mirrored users.role, and a site of that company as activeLocationId.
 * The caller has checked the membership is active.
 */
export async function activateMembership(
  ctx: MutationCtx,
  user: Doc<'users'>,
  membership: Pick<Doc<'memberships'>, 'companyId' | 'roleKey' | 'allLocations' | 'locationIds'>,
) {
  // Leaving a company the user only belongs to through users.companyId (not
  // backfilled yet): write its membership first so they can switch back.
  if (user.companyId && user.companyId !== membership.companyId) {
    const legacy = await activeMembership(ctx, user)
    if (legacy?.synthesized) {
      const { _id, _creationTime, synthesized, ...row } = legacy
      void _id
      void _creationTime
      void synthesized
      await ctx.db.insert('memberships', { ...row, updatedAt: Date.now() })
    }
  }
  const patch: Partial<Doc<'users'>> = { companyId: membership.companyId }
  if ((user.role ?? 'user') !== 'super_admin') {
    patch.role = legacyRoleFromKey(membership.roleKey)
  }
  patch.locationIds = membership.allLocations ? undefined : membership.locationIds
  const sites = await ctx.db
    .query('farmLocations')
    .withIndex('by_company', (q) => q.eq('companyId', membership.companyId))
    .take(200)
  const allowed = sites.filter(
    (s) =>
      s.active !== false &&
      (membership.allLocations || (membership.locationIds ?? []).includes(s._id)),
  )
  const keep = allowed.find((s) => s._id === user.activeLocationId)
  patch.activeLocationId = keep?._id ?? allowed[0]?._id
  await ctx.db.patch(user._id, patch)
}

/**
 * The user's membership in `companyId` stopped being active: if it was their
 * active organization, move them to another active one, or clear the pointer
 * (they land on the organization picker / registration page).
 */
export async function leaveActiveCompany(
  ctx: MutationCtx,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
) {
  const user = await ctx.db.get(userId)
  if (!user || user.companyId !== companyId) return
  const others = await ctx.db
    .query('memberships')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(50)
  for (const m of others) {
    if (m.companyId === companyId || m.status !== 'active') continue
    const company = await ctx.db.get(m.companyId)
    if (company?.status !== 'approved') continue
    await activateMembership(ctx, user, m)
    return
  }
  const patch: Partial<Doc<'users'>> = {
    companyId: undefined,
    activeLocationId: undefined,
    locationIds: undefined,
  }
  if ((user.role ?? 'user') !== 'super_admin') patch.role = 'user'
  await ctx.db.patch(userId, patch)
}

/** Active memberships of a user that are not `exceptCompanyId`. */
export async function otherActiveMemberships(
  ctx: Ctx,
  userId: Id<'users'>,
  exceptCompanyId: Id<'companies'>,
) {
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(50)
  return rows.filter((m) => m.companyId !== exceptCompanyId && m.status === 'active')
}
