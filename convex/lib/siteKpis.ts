/**
 * Bounded per-site KPIs of one organization for a date range: sites, active
 * units, fish on hand, sales, harvest weight, expenses and overdue
 * maintenance. Used by the region report (FARM-004) and consolidated group
 * reporting (ENT-002). Every read is an index range with a cap; `truncated`
 * says a cap was hit so the UI can say the figures are partial.
 */
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { DEFAULT_CURRENCY_CODE, isCurrencyCode } from './currencies'

export const KPI_CAPS = { sites: 500, units: 2000, sales: 5000, harvests: 2000, expenses: 5000, equipment: 200 } as const

export type SiteKpis = {
  activeUnits: number
  fish: number
  salesAmount: number
  salesCount: number
  harvestKg: number
  expensesAmount: number
  overdueMaintenance: number
}

const empty = (): SiteKpis => ({
  activeUnits: 0,
  fish: 0,
  salesAmount: 0,
  salesCount: 0,
  harvestKg: 0,
  expensesAmount: 0,
  overdueMaintenance: 0,
})

export function addKpis(a: SiteKpis, b: SiteKpis): SiteKpis {
  return {
    activeUnits: a.activeUnits + b.activeUnits,
    fish: a.fish + b.fish,
    salesAmount: a.salesAmount + b.salesAmount,
    salesCount: a.salesCount + b.salesCount,
    harvestKg: a.harvestKg + b.harvestKg,
    expensesAmount: a.expensesAmount + b.expensesAmount,
    overdueMaintenance: a.overdueMaintenance + b.overdueMaintenance,
  }
}

export function companyCurrency(company: Doc<'companies'> | null): string {
  const c = company?.settings?.locale?.currency
  return isCurrencyCode(c) ? c : DEFAULT_CURRENCY_CODE
}

/**
 * KPIs per site (key = site id, '' = no site) for `from`..`to` (inclusive,
 * YYYY-MM-DD). Overdue maintenance counts equipment due before `to`.
 * `inScope` drops rows of sites the caller may not see.
 */
export async function siteKpis(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  range: { from: string; to: string },
  inScope: (siteId: Id<'farmLocations'> | undefined) => boolean = () => true,
) {
  const sites = await ctx.db
    .query('farmLocations')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(KPI_CAPS.sites)
  const units = await ctx.db
    .query('cages')
    .withIndex('by_company_status', (q) => q.eq('companyId', companyId).eq('status', 'active'))
    .take(KPI_CAPS.units)
  const sales = await ctx.db
    .query('sales')
    .withIndex('by_company_and_saleDate', (q) =>
      q.eq('companyId', companyId).gte('saleDate', range.from).lte('saleDate', range.to),
    )
    .take(KPI_CAPS.sales)
  const harvests = await ctx.db
    .query('harvestRecords')
    .withIndex('by_company_and_harvestDate', (q) =>
      q.eq('companyId', companyId).gte('harvestDate', range.from).lte('harvestDate', range.to),
    )
    .take(KPI_CAPS.harvests)
  const expenses = await ctx.db
    .query('expenses')
    .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).gte('date', range.from).lte('date', range.to))
    .take(KPI_CAPS.expenses)
  const overdue = await ctx.db
    .query('equipment')
    .withIndex('by_companyId_and_nextMaintenanceDue', (q) =>
      q.eq('companyId', companyId).gte('nextMaintenanceDue', '0000-01-01').lt('nextMaintenanceDue', range.to),
    )
    .take(KPI_CAPS.equipment)

  const truncated =
    sites.length >= KPI_CAPS.sites ||
    units.length >= KPI_CAPS.units ||
    sales.length >= KPI_CAPS.sales ||
    harvests.length >= KPI_CAPS.harvests ||
    expenses.length >= KPI_CAPS.expenses ||
    overdue.length >= KPI_CAPS.equipment

  const bySite = new Map<string, SiteKpis>()
  const row = (siteId: Id<'farmLocations'> | undefined) => {
    const key = siteId ?? ''
    let r = bySite.get(key)
    if (!r) bySite.set(key, (r = empty()))
    return r
  }
  for (const u of units) {
    if (u.archivedAt || !inScope(u.locationId)) continue
    const r = row(u.locationId)
    r.activeUnits += 1
    r.fish += Math.max(0, u.currentCount ?? 0)
  }
  for (const s of sales) {
    if (!inScope(s.locationId)) continue
    const r = row(s.locationId)
    r.salesAmount += s.totalAmount
    r.salesCount += 1
  }
  for (const h of harvests) {
    if (!inScope(h.locationId)) continue
    row(h.locationId).harvestKg += h.totalWeight
  }
  for (const e of expenses) {
    if (e.deletedAt || !inScope(e.locationId)) continue
    row(e.locationId).expensesAmount += e.amount
  }
  for (const e of overdue) {
    if (e.status === 'retired' || !inScope(e.locationId)) continue
    row(e.locationId).overdueMaintenance += 1
  }
  return { sites: sites.filter((s) => inScope(s._id)), bySite, truncated }
}

export function totalKpis(bySite: Map<string, SiteKpis>): SiteKpis {
  let t = empty()
  for (const r of bySite.values()) t = addKpis(t, r)
  return t
}

export { empty as emptyKpis }
