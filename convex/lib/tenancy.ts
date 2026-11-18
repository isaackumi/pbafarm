import { requireUser } from './authz'
import { AUTH_ERROR_MESSAGES } from './authErrors'
import { MutationCtx, QueryCtx } from '../_generated/server'
import { Doc, Id } from '../_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

/** Company scope for the current user (undefined for company-less users). */
export function companyFilter(user: Doc<'users'>) {
  return user.companyId
}

/**
 * Tenant isolation:
 * - super_admin: all rows
 * - company member: only their companyId
 * - no companyId: nothing. There is no shared pool of unscoped rows (SEC-001);
 *   a user must belong to an approved company to see tenant data.
 */
export async function listForCompany<T extends { companyId?: Id<'companies'> }>(
  user: Doc<'users'>,
  rows: T[],
): Promise<T[]> {
  if ((user.role ?? 'user') === 'super_admin') return rows
  if (!user.companyId) return []
  return rows.filter((r) => r.companyId === user.companyId)
}

/**
 * Throw unless the user may write to this tenant-scoped document.
 * Same rules as listForCompany: super_admin sees all, members only their
 * company, company-less users nothing.
 */
export function assertOwns<T extends { companyId?: Id<'companies'> }>(
  user: Doc<'users'>,
  doc: T | null | undefined,
  label = 'Record',
): asserts doc is T {
  if (!doc) throw new Error(`${label} not found`)
  if ((user.role ?? 'user') === 'super_admin') return
  const ok = !!user.companyId && doc.companyId === user.companyId
  if (!ok) throw new Error(`${label} not found`)
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

/**
 * companyId for a new tenant row: the caller's company. Company-less callers
 * (super_admins included: they use platform functions) cannot write tenant data.
 */
export async function writeCompanyId(user: Doc<'users'>): Promise<Id<'companies'>> {
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
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
  // Only the caller's own company's locations (SEC-002, V14): a company-less
  // caller or a location with no company is refused too.
  if (
    (user.role ?? 'user') !== 'super_admin' &&
    (!user.companyId || loc.companyId !== user.companyId)
  ) {
    throw new Error('Location access denied')
  }
  return locationId
}

/**
 * Ensure the company has at least one active location. Returns its id.
 * Idempotent. Creates nothing for a company-less caller and throws NO_COMPANY.
 */
export async function ensureDefaultLocation(
  ctx: MutationCtx,
  user: Doc<'users'>,
): Promise<Id<'farmLocations'>> {
  const companyId = user.companyId
  if (!companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  const existing = await ctx.db
    .query('farmLocations')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .collect()

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
