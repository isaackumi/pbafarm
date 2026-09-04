import { requireUser } from './authz'
import { MutationCtx, QueryCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

/** Company scope for the current user (undefined for unassigned / greenfield). */
export function companyFilter(user: Doc<'users'>) {
  return user.companyId
}

/**
 * Tenant isolation:
 * - super_admin: all rows
 * - company member: only their companyId
 * - no companyId: only unscoped rows (greenfield solo) — never other companies' data
 */
export async function listForCompany<T extends { companyId?: Id<'companies'> }>(
  user: Doc<'users'>,
  rows: T[],
): Promise<T[]> {
  if ((user.role ?? 'user') === 'super_admin') return rows
  if (!user.companyId) {
    return rows.filter((r) => !r.companyId)
  }
  return rows.filter((r) => r.companyId === user.companyId)
}

/**
 * Company filter, then optional location filter.
 * When locationId is omitted, returns all company rows (admin "all sites" views).
 * Legacy rows with no locationId are included only when filtering to a location
 * if they have no locationId set — after backfill they should all have one.
 */
export async function listForCompanyAndLocation<
  T extends { companyId?: Id<'companies'>; locationId?: Id<'farmLocations'> },
>(
  user: Doc<'users'>,
  rows: T[],
  locationId?: Id<'farmLocations'> | null,
): Promise<T[]> {
  const companyRows = await listForCompany(user, rows)
  if (!locationId) return companyRows
  return companyRows.filter((r) => r.locationId === locationId)
}

export async function writeCompanyId(user: Doc<'users'>) {
  return user.companyId
}

/** Whether the user may operate on a given farm location. */
export function assertLocationAccess(
  user: Doc<'users'>,
  locationId: Id<'farmLocations'> | undefined,
) {
  if (!locationId) return
  if ((user.role ?? 'user') === 'super_admin') return
  if ((user.role ?? 'user') === 'admin') return
  const assigned = user.locationIds
  if (!assigned || assigned.length === 0) return
  if (!assigned.includes(locationId)) {
    throw new Error('Location access denied')
  }
}

/**
 * Resolve locationId for writes: explicit arg → user.activeLocationId.
 * Throws if neither is set (callers should ensureDefaultLocation first).
 */
export async function writeLocationId(
  ctx: Ctx,
  user: Doc<'users'>,
  explicitLocationId?: Id<'farmLocations'> | null,
): Promise<Id<'farmLocations'> | undefined> {
  const locationId =
    explicitLocationId || user.activeLocationId || undefined
  if (!locationId) return undefined
  assertLocationAccess(user, locationId)
  const loc = await ctx.db.get(locationId)
  if (!loc || loc.active === false) {
    throw new Error('Farm location not found or inactive')
  }
  if (
    user.companyId &&
    loc.companyId &&
    loc.companyId !== user.companyId &&
    (user.role ?? 'user') !== 'super_admin'
  ) {
    throw new Error('Location access denied')
  }
  return locationId
}

/**
 * Ensure the company (or greenfield user) has at least one active location.
 * Returns its id. Idempotent.
 */
export async function ensureDefaultLocation(
  ctx: MutationCtx,
  user: Doc<'users'>,
): Promise<Id<'farmLocations'>> {
  const companyId = user.companyId
  let existing = companyId
    ? await ctx.db
        .query('farmLocations')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .collect()
    : await ctx.db.query('farmLocations').collect()

  if (!companyId) {
    existing = existing.filter((l) => !l.companyId)
  }

  const active = existing.find((l) => l.active !== false)
  if (active) {
    if (!user.activeLocationId) {
      await ctx.db.patch(user._id, { activeLocationId: active._id })
    }
    return active._id
  }

  const id = await ctx.db.insert('farmLocations', {
    companyId,
    name: 'Main farm',
    code: 'MAIN',
    active: true,
    notes: 'Default location',
    updatedAt: Date.now(),
  })
  await ctx.db.patch(user._id, { activeLocationId: id })
  return id
}

export async function logAudit(
  ctx: MutationCtx,
  args: {
    actionType: string
    tableName: string
    recordId?: string
    previousValues?: unknown
    newValues?: unknown
    locationId?: Id<'farmLocations'>
  },
) {
  const user = await requireUser(ctx)
  await ctx.db.insert('auditLogs', {
    userId: user._id,
    actionType: args.actionType,
    tableName: args.tableName,
    recordId: args.recordId,
    previousValues: args.previousValues,
    newValues: args.newValues,
    locationId: args.locationId,
    companyId: user.companyId,
  })
}
