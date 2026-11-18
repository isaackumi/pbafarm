import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import type { PaginationOptions, PaginationResult } from 'convex/server'

/**
 * Company-scoped reads (PLAT-001).
 *
 * Every tenant list reads through a `by_company…` index, so a company's
 * results and cost depend only on its own rows: another tenant's data is
 * never scanned, never truncates this tenant's window, and never re-runs
 * this tenant's subscriptions.
 *
 * Scope of the caller:
 * - a member (any role, super_admin included) with a company → that company;
 * - a company-less super_admin → the explicit platform view: a bounded scan
 *   of at most PLATFORM_SCAN_LIMIT rows across all companies;
 * - anyone else without a company → nothing (SEC-001).
 */

type Ctx = QueryCtx | MutationCtx

/** Hard cap on rows read by a company-less super_admin's cross-company view. */
export const PLATFORM_SCAN_LIMIT = 2000

export type TenantScope =
  | { kind: 'none' }
  | { kind: 'platform' }
  | { kind: 'company'; companyId: Id<'companies'> }

export function tenantScope(user: Doc<'users'>): TenantScope {
  if (user.companyId) return { kind: 'company', companyId: user.companyId }
  if ((user.role ?? 'user') === 'super_admin') return { kind: 'platform' }
  return { kind: 'none' }
}

/**
 * Site scope (PERM-004): a member limited to some sites has them mirrored in
 * users.locationIds for the active organization (lib/memberships). Rows tied
 * to a site outside that list are dropped; rows tied to no site (feed types,
 * customers, company-level records) stay visible. Transfers count when either
 * end is in scope. null = every site.
 */
export function siteScopeOf(user: Doc<'users'>): ReadonlySet<string> | null {
  if ((user.role ?? 'user') === 'super_admin') return null
  const ids = user.locationIds
  return ids && ids.length > 0 ? new Set(ids) : null
}

export function rowInSiteScope(scope: ReadonlySet<string> | null, row: any): boolean {
  if (!scope || !row) return true
  const sites = [row.locationId, row.sourceLocationId, row.destinationLocationId].filter(Boolean)
  return sites.length === 0 || sites.some((id: string) => scope.has(id))
}

export function inSiteScope<T>(user: Doc<'users'>, rows: T[]): T[] {
  const scope = siteScopeOf(user)
  return scope ? rows.filter((r) => rowInSiteScope(scope, r)) : rows
}

/** Tables with a `by_company` index on `companyId`. */
export type CompanyTable =
  | 'cages'
  | 'farmLocations'
  | 'feedSuppliers'
  | 'feedTypes'
  | 'feedPurchases'
  | 'feedUsage'
  | 'dailyRecords'
  | 'biweeklyRecords'
  | 'harvestRecords'
  | 'harvestSampling'
  | 'feedInventory'
  | 'feedInventoryTransactions'
  | 'stockingHistory'
  | 'topupHistory'
  | 'fishTransfers'
  | 'auditLogs'
  | 'customers'
  | 'sales'
  | 'healthTreatments'

/** Tables with a `by_company_location` index on `[companyId, locationId]`. */
const COMPANY_LOCATION_INDEX = new Set<string>([
  'cages',
  'feedPurchases',
  'feedUsage',
  'dailyRecords',
  'biweeklyRecords',
  'harvestRecords',
  'feedInventory',
  'feedInventoryTransactions',
  'stockingHistory',
  'sales',
  'healthTreatments',
])

function byLocation<T extends { locationId?: Id<'farmLocations'> }>(
  rows: T[],
  locationId?: Id<'farmLocations'> | null,
) {
  return locationId ? rows.filter((r) => r.locationId === locationId) : rows
}

/**
 * All of the caller's company rows of a table (optionally one site), read
 * through `by_company` / `by_company_location`.
 */
export async function scopedRows<T extends CompanyTable>(
  ctx: Ctx,
  user: Doc<'users'>,
  table: T,
  opts: { locationId?: Id<'farmLocations'> | null } = {},
): Promise<Doc<T>[]> {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return []
  // The table name is a union, so the index builders are typed per table; the
  // index names used here exist on every member of CompanyTable.
  const q = ctx.db.query(table) as any
  let rows: Doc<T>[]
  if (scope.kind === 'platform') {
    rows = await q.take(PLATFORM_SCAN_LIMIT)
  } else if (opts.locationId && COMPANY_LOCATION_INDEX.has(table)) {
    return inSiteScope(
      user,
      await q
        .withIndex('by_company_location', (ix: any) =>
          ix.eq('companyId', scope.companyId).eq('locationId', opts.locationId),
        )
        .collect(),
    )
  } else {
    rows = await q
      .withIndex('by_company', (ix: any) => ix.eq('companyId', scope.companyId))
      .collect()
  }
  return inSiteScope(user, byLocation(rows as any[], opts.locationId)) as Doc<T>[]
}

/** Date-indexed tables: company index, platform index and the date field. */
const DATE_INDEX = {
  dailyRecords: { company: 'by_company_and_date', platform: 'by_date', field: 'date' },
  biweeklyRecords: { company: 'by_company_and_date', platform: 'by_date', field: 'date' },
  harvestRecords: {
    company: 'by_company_and_harvestDate',
    platform: 'by_date',
    field: 'harvestDate',
  },
  sales: { company: 'by_company_and_saleDate', platform: 'by_date', field: 'saleDate' },
  healthTreatments: { company: 'by_company_and_date', platform: 'by_date', field: 'date' },
} as const

export type DatedTable = keyof typeof DATE_INDEX

/**
 * The caller's company rows with the date field in [from, to] (either end
 * optional, `YYYY-MM-DD`), newest first, read through
 * `by_company_and_<date>`. `limit` caps the rows read.
 */
export async function scopedRowsInRange<T extends DatedTable>(
  ctx: Ctx,
  user: Doc<'users'>,
  table: T,
  opts: {
    from?: string | null
    to?: string | null
    locationId?: Id<'farmLocations'> | null
    limit?: number
    order?: 'asc' | 'desc'
  } = {},
): Promise<Doc<T>[]> {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return []
  const { company, platform, field } = DATE_INDEX[table]
  const range = (ix: any) => {
    let r = ix
    if (opts.from) r = r.gte(field, opts.from)
    if (opts.to) r = r.lte(field, opts.to)
    return r
  }
  const q = ctx.db.query(table) as any
  const order = opts.order ?? 'desc'
  const ordered =
    scope.kind === 'platform'
      ? q.withIndex(platform, range).order(order)
      : q
          .withIndex(company, (ix: any) => range(ix.eq('companyId', scope.companyId)))
          .order(order)
  const cap =
    scope.kind === 'platform'
      ? Math.min(opts.limit ?? PLATFORM_SCAN_LIMIT, PLATFORM_SCAN_LIMIT)
      : opts.limit
  const rows: Doc<T>[] = cap ? await ordered.take(cap) : await ordered.collect()
  return inSiteScope(user, byLocation(rows as any[], opts.locationId)) as Doc<T>[]
}

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' }

/**
 * One page of the caller's company rows with the date field in [from, to],
 * newest first (`by_company_and_<date>`). For `usePaginatedQuery` endpoints.
 */
export async function scopedPageInRange<T extends DatedTable>(
  ctx: Ctx,
  user: Doc<'users'>,
  table: T,
  paginationOpts: PaginationOptions,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<PaginationResult<Doc<T>>> {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return EMPTY_PAGE
  const { company, platform, field } = DATE_INDEX[table]
  const range = (ix: any) => {
    let r = ix
    if (opts.from) r = r.gte(field, opts.from)
    if (opts.to) r = r.lte(field, opts.to)
    return r
  }
  const q = ctx.db.query(table) as any
  const indexed =
    scope.kind === 'platform'
      ? q.withIndex(platform, range)
      : q.withIndex(company, (ix: any) => range(ix.eq('companyId', scope.companyId)))
  const page = await indexed.order('desc').paginate(paginationOpts)
  return { ...page, page: inSiteScope(user, page.page) }
}

/** One page of the caller's company rows, newest first (`by_company`). */
export async function scopedPage<T extends CompanyTable>(
  ctx: Ctx,
  user: Doc<'users'>,
  table: T,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<Doc<T>>> {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return EMPTY_PAGE
  const q = ctx.db.query(table) as any
  const indexed =
    scope.kind === 'platform'
      ? q
      : q.withIndex('by_company', (ix: any) => ix.eq('companyId', scope.companyId))
  const page = await indexed.order('desc').paginate(paginationOpts)
  return { ...page, page: inSiteScope(user, page.page) }
}

/** Tables with a `by_company_and_status` index. */
export type StatusTable = 'stockingHistory' | 'topupHistory' | 'fishTransfers'

/** The caller's company rows in one status, via `by_company_and_status`. */
export async function scopedRowsByStatus<T extends StatusTable>(
  ctx: Ctx,
  user: Doc<'users'>,
  table: T,
  status: Doc<T>['status'],
): Promise<Doc<T>[]> {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return []
  const q = ctx.db.query(table) as any
  if (scope.kind === 'platform') {
    return await q
      .withIndex('by_status', (ix: any) => ix.eq('status', status))
      .take(PLATFORM_SCAN_LIMIT)
  }
  return inSiteScope(
    user,
    await q
      .withIndex('by_company_and_status', (ix: any) =>
        ix.eq('companyId', scope.companyId).eq('status', status),
      )
      .collect(),
  )
}

/**
 * Today's date (`YYYY-MM-DD`, UTC) unless the client passed `asOf`. Queries
 * should get `asOf` from the client (doc 04 F18): a query's cache does not
 * expire at midnight, so a server-side clock read goes stale. The clock
 * fallback keeps older clients working.
 */
export function asOfDate(asOf?: string | null): string {
  return asOf || new Date().toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` `days` days before `asOf` (a `YYYY-MM-DD` date), in UTC. */
export function daysBefore(asOf: string, days: number): string {
  const d = new Date(`${asOf}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}
