import { v } from 'convex/values'
import { query } from './_generated/server'
import { listForCompany } from './lib/tenancy'
import { isRealHarvest } from './lib/cycles'
import { asOfDate, daysBefore, scopedRows, scopedRowsInRange, tenantScope } from './lib/scope'
import {
  cageExpenses,
  feedCostFromLedger,
  loadPriceBook,
  splitExpenses,
  summarizeCost,
  type PriceBook,
} from './lib/costing'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  mean,
  periodGrowthPerDay,
  periodHarvestFcr,
  periodMortalityPct,
  pooledFcr,
  survivalPct,
} from './lib/kpi'
import { requireMember } from './lib/permissions'

/** A bi-weekly row as a KPI sample. */
const sampleRow = (r: Doc<'biweeklyRecords'>) => ({
  cageId: String(r.cageId),
  batchId: r.batchId ? String(r.batchId) : undefined,
  date: r.date,
  abwG: r.averageBodyWeight,
})

/** A harvest row as a KPI input. */
const harvestRow = (h: Doc<'harvestRecords'>) => ({
  cageId: String(h.cageId),
  batchId: h.batchId ? String(h.batchId) : undefined,
  harvestDate: h.harvestDate,
  totalWeight: h.totalWeight,
  fcr: h.fcr,
  fcrInputs: h.fcrInputs ?? null,
})

/** A cage's daily records with `date` in [from, to], via `by_cage_date`. */
async function cageDaily(
  ctx: QueryCtx,
  cageId: Id<'cages'>,
  from?: string | null,
  to?: string | null,
): Promise<Doc<'dailyRecords'>[]> {
  return await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => {
      const c = q.eq('cageId', cageId)
      if (from && to) return c.gte('date', from).lte('date', to)
      if (from) return c.gte('date', from)
      if (to) return c.lte('date', to)
      return c
    })
    .collect()
}

export const dashboardSummary = query({
  args: {
    dateRange: v.optional(v.number()), // Days to look back
    locationId: v.optional(v.id('farmLocations')),
    /** Client's today (YYYY-MM-DD); the period ends here. */
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const daysBack = args.dateRange || 30
    const cutoffDateStr = daysBefore(asOfDate(args.asOf), daysBack)

    // Get cage counts by status (scoped to active farm location when provided)
    const cages = await scopedRows(ctx, user, 'cages', { locationId: args.locationId })
    
    const cagesByStatus = {
      total: cages.length,
      active: cages.filter((c) => c.status === 'active').length,
      maintenance: cages.filter((c) => c.status === 'maintenance').length,
      empty: cages.filter((c) => c.status === 'empty').length,
      harvested: cages.filter((c) => c.status === 'harvested').length,
      harvesting: cages.filter((c) => c.status === 'harvesting').length,
      fallow: cages.filter((c) => c.status === 'fallow').length,
    }

    // Recent daily records only: company + date range, not the full history.
    const dailyRecords = await scopedRowsInRange(ctx, user, 'dailyRecords', {
      from: cutoffDateStr,
      locationId: args.locationId,
    })
    const recentMortality = dailyRecords
      .filter((r) => r.date >= cutoffDateStr)
      .reduce((sum, r) => sum + r.mortality, 0)

    // Get recent feed usage sum
    const recentFeedUsage = dailyRecords
      .filter((r) => r.date >= cutoffDateStr)
      .reduce((sum, r) => sum + r.feedAmount, 0)

    // Get recent feed cost sum
    const recentFeedCost = dailyRecords
      .filter((r) => r.date >= cutoffDateStr)
      .reduce((sum, r) => sum + r.feedCost, 0)

    // Get harvest count in period
    const harvestRecords = (
      await scopedRowsInRange(ctx, user, 'harvestRecords', {
        from: cutoffDateStr,
        locationId: args.locationId,
      })
    ).filter(isRealHarvest)
    const recentHarvestCount = harvestRecords
      .filter((h) => h.harvestDate >= cutoffDateStr).length

    // Get total harvest weight in period
    const recentHarvestWeight = harvestRecords
      .filter((h) => h.harvestDate >= cutoffDateStr)
      .reduce((sum, h) => sum + h.totalWeight, 0)

    // Get active fish count (sum of current counts from active cages)
    const activeFishCount = cages
      .filter((c) => c.status === 'active')
      .reduce((sum, c) => sum + (c.currentCount || 0), 0)

    // Get low stock alerts count (company-wide feed types)
    const feedTypes = await scopedRows(ctx, user, 'feedTypes')
    const lowStockAlerts = feedTypes.filter(
      (f) =>
        f.active &&
        !f.deletedAt &&
        (f.minimumStock ?? 0) > 0 &&
        f.currentStock <= f.minimumStock,
    ).length

    return {
      period_days: daysBack,
      cages: cagesByStatus,
      recent_mortality: recentMortality,
      recent_feed_usage_kg: recentFeedUsage,
      recent_feed_cost: recentFeedCost,
      recent_harvest_count: recentHarvestCount,
      recent_harvest_weight_kg: recentHarvestWeight,
      active_fish_count: activeFishCount,
      low_stock_alerts: lowStockAlerts,
    }
  },
})

/** Compact KPIs for the main dashboard (FCR, mortality %, growth). */
export const dashboardKpis = query({
  args: {
    dateRange: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
    /** Client's today (YYYY-MM-DD); the period ends here. */
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const daysBack = args.dateRange || 30
    const cutoffDateStr = daysBefore(asOfDate(args.asOf), daysBack)

    const cages = await scopedRows(ctx, user, 'cages', { locationId: args.locationId })
    const activeFish = cages
      .filter((c) => c.status === 'active')
      .reduce((s, c) => s + (c.currentCount || 0), 0)

    const daily = await scopedRowsInRange(ctx, user, 'dailyRecords', {
      from: cutoffDateStr,
      locationId: args.locationId,
    })
    const recentMortality = daily.reduce((s, r) => s + r.mortality, 0)
    const recentFeedCost = daily.reduce((s, r) => s + r.feedCost, 0)

    const biweekly = await scopedRowsInRange(ctx, user, 'biweeklyRecords', {
      from: cutoffDateStr,
      locationId: args.locationId,
    })
    // One definition each (convex/lib/kpi.ts, PROD-008).
    const avgGrowth = periodGrowthPerDay(biweekly.map(sampleRow))

    const periodHarvests = (
      await scopedRowsInRange(ctx, user, 'harvestRecords', {
        from: cutoffDateStr,
        locationId: args.locationId,
      })
    ).filter(isRealHarvest)
    const avgFcr = periodHarvestFcr(periodHarvests.map(harvestRow))
    const harvestWeight = periodHarvests.reduce((s, h) => s + h.totalWeight, 0)

    // Deaths and the live fish they are compared with come from the same cages.
    const liveFish = cages.reduce((s, c) => s + Math.max(0, c.currentCount || 0), 0)
    const mortalityPct = periodMortalityPct(recentMortality, liveFish) ?? 0

    return {
      period_days: daysBack,
      active_cages: cages.filter((c) => c.status === 'active').length,
      active_fish_count: activeFish,
      recent_mortality: recentMortality,
      mortality_rate_pct: mortalityPct,
      avg_fcr: avgFcr,
      avg_daily_growth_g: avgGrowth,
      recent_feed_cost: recentFeedCost,
      harvest_weight_kg: harvestWeight,
      feed_cost_per_kg_harvested:
        harvestWeight > 0 ? recentFeedCost / harvestWeight : null,
    }
  },
})

export const exportBundle = query({
  args: {
    dateFrom: v.string(),
    dateTo: v.string(),
    cageId: v.optional(v.id('cages')),
    /** Only this site's records (FARM-003). */
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.export' })

    const range = { from: args.dateFrom, to: args.dateTo, order: 'asc' as const }
    const atSite = <T extends { locationId?: Id<'farmLocations'> }>(rows: T[]) =>
      args.locationId ? rows.filter((r) => r.locationId === args.locationId) : rows

    // Get daily records
    let dailyRecords = args.cageId
      ? await cageDaily(ctx, args.cageId, args.dateFrom, args.dateTo)
      : await scopedRowsInRange(ctx, user, 'dailyRecords', range)
    dailyRecords = atSite(await listForCompany(user, dailyRecords))

    // Get biweekly records
    let biweeklyRecords = args.cageId
      ? await ctx.db
          .query('biweeklyRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRowsInRange(ctx, user, 'biweeklyRecords', range)

    biweeklyRecords = atSite(await listForCompany(user, biweeklyRecords))
    biweeklyRecords = biweeklyRecords.filter(
      (r) => r.date >= args.dateFrom && r.date <= args.dateTo
    )

    // Get harvest records
    let harvestRecords = args.cageId
      ? await ctx.db
          .query('harvestRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRowsInRange(ctx, user, 'harvestRecords', range)

    harvestRecords = atSite(await listForCompany(user, harvestRecords))
    harvestRecords = harvestRecords.filter(
      (h) => h.harvestDate >= args.dateFrom && h.harvestDate <= args.dateTo
    )

    // Transform to client format
    const transformDailyRecord = (r: any) => ({
      id: r._id,
      cage_id: r.cageId,
      date: r.date,
      feed_amount: r.feedAmount,
      feed_type_id: r.feedTypeId,
      feed_type: r.feedType,
      feed_price: r.feedPrice,
      feed_cost: r.feedCost,
      mortality: r.mortality,
      notes: r.notes,
      created_by: r.createdBy,
      created_at: r._creationTime,
      custom: r.custom ?? {},
    })

    const transformBiweeklyRecord = (r: any) => ({
      id: r._id,
      cage_id: r.cageId,
      date: r.date,
      batch_code: r.batchCode,
      average_body_weight: r.averageBodyWeight,
      total_fish_count: r.totalFishCount,
      total_weight: r.totalWeight,
      created_by: r.createdBy,
      updated_by: r.updatedBy,
      updated_at: r.updatedAt,
      created_at: r._creationTime,
      custom: r.custom ?? {},
    })

    const transformHarvestRecord = (r: any) => ({
      id: r._id,
      cage_id: r.cageId,
      harvest_date: r.harvestDate,
      average_body_weight: r.averageBodyWeight,
      total_weight: r.totalWeight,
      estimated_count: r.estimatedCount,
      fcr: r.fcr,
      fcr_inputs: r.fcrInputs ?? null,
      batch_id: r.batchId ?? null,
      size_breakdown: r.sizeBreakdown,
      notes: r.notes,
      harvest_type: r.harvestType,
      status: r.status,
      created_by: r.createdBy,
      created_at: r._creationTime,
      custom: r.custom ?? {},
    })

    return {
      date_range: {
        from: args.dateFrom,
        to: args.dateTo,
      },
      cage_filter: args.cageId || null,
      daily_records: dailyRecords.map(transformDailyRecord),
      biweekly_records: biweeklyRecords.map(transformBiweeklyRecord),
      harvest_records: harvestRecords.map(transformHarvestRecord),
      totals: {
        daily_records_count: dailyRecords.length,
        biweekly_records_count: biweeklyRecords.length,
        // Pre-harvest samples (PROD-000g) are listed but are not harvests.
        harvest_records_count: harvestRecords.filter(isRealHarvest).length,
        total_mortality: dailyRecords.reduce((sum, r) => sum + r.mortality, 0),
        total_feed_usage: dailyRecords.reduce((sum, r) => sum + r.feedAmount, 0),
        total_feed_cost: dailyRecords.reduce((sum, r) => sum + r.feedCost, 0),
        total_harvest_weight: harvestRecords.filter(isRealHarvest).reduce((sum, r) => sum + r.totalWeight, 0),
        // Same definitions as the dashboard and report (convex/lib/kpi.ts).
        fcr: periodHarvestFcr(harvestRecords.filter(isRealHarvest).map(harvestRow)),
        growth_g_day: periodGrowthPerDay(biweeklyRecords.map(sampleRow)),
      },
    }
  },
})

export const getProductionMetrics = query({
  args: {
    cageId: v.optional(v.id('cages')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.view' })

    // Get cages for context
    let cages: Doc<'cages'>[]
    if (args.cageId) {
      const cage = await ctx.db.get(args.cageId)
      cages = cage ? await listForCompany(user, [cage]) : []
    } else {
      cages = await scopedRows(ctx, user, 'cages')
    }

    // Calculate metrics per cage
    const cageMetrics = []
    for (const cage of cages) {
      // Get daily records for this cage
      const dailyRecords = await cageDaily(ctx, cage._id, args.dateFrom, args.dateTo)

      // Get biweekly records for growth tracking
      let biweeklyRecords = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
        .collect()

      if (args.dateFrom) biweeklyRecords = biweeklyRecords.filter((r) => r.date >= args.dateFrom!)
      if (args.dateTo) biweeklyRecords = biweeklyRecords.filter((r) => r.date <= args.dateTo!)

      const totalFeed = dailyRecords.reduce((sum, r) => sum + r.feedAmount, 0)
      const totalMortality = dailyRecords.reduce((sum, r) => sum + r.mortality, 0)
      const totalFeedCost = dailyRecords.reduce((sum, r) => sum + r.feedCost, 0)

      // Calculate growth rate from biweekly records
      let growthRate = 0
      if (biweeklyRecords.length >= 2) {
        const sorted = biweeklyRecords.sort((a, b) => a.date.localeCompare(b.date))
        const first = sorted[0]
        const last = sorted[sorted.length - 1]
        const weightGain = last.averageBodyWeight - first.averageBodyWeight
        const daysDiff = Math.ceil((new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24))
        growthRate = daysDiff > 0 ? (weightGain / daysDiff) : 0
      }

      cageMetrics.push({
        cage_id: cage._id,
        cage_name: cage.name,
        status: cage.status,
        current_count: cage.currentCount || 0,
        total_feed_kg: totalFeed,
        total_mortality: totalMortality,
        total_feed_cost: totalFeedCost,
        mortality_rate: cage.currentCount ? (totalMortality / (cage.currentCount + totalMortality)) * 100 : 0,
        feed_per_fish: cage.currentCount ? totalFeed / cage.currentCount : 0,
        cost_per_fish: cage.currentCount ? totalFeedCost / cage.currentCount : 0,
        growth_rate_per_day: growthRate,
        days_of_data: dailyRecords.length,
        biweekly_samples: biweeklyRecords.length,
      })
    }

    return cageMetrics
  },
})

/** Full report used by /report — filters by cage IDs + date range + type. */
export const productionReport = query({
  args: {
    reportType: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    cageIds: v.array(v.id('cages')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const idSet = new Set(args.cageIds.map(String))

    // Only the selected cages the caller owns, in the order they were chosen.
    const cages: Doc<'cages'>[] = []
    for (const id of new Set(args.cageIds)) {
      const cage = await ctx.db.get(id)
      if (cage) cages.push(...(await listForCompany(user, [cage])))
    }

    // Company + date range reads, then the cage selection.
    const range = { from: args.startDate, to: args.endDate, order: 'asc' as const }
    const daily = (await scopedRowsInRange(ctx, user, 'dailyRecords', range)).filter(
      (r) => idSet.has(String(r.cageId)),
    )
    const biweekly = (
      await scopedRowsInRange(ctx, user, 'biweeklyRecords', range)
    ).filter((r) => idSet.has(String(r.cageId)))
    const harvests = (
      await scopedRowsInRange(ctx, user, 'harvestRecords', range)
    ).filter((h) => isRealHarvest(h) && idSet.has(String(h.cageId)))

    const cageName = Object.fromEntries(cages.map((c) => [String(c._id), c.name]))

    const summary = {
      cages_selected: cages.length,
      total_feed_kg: daily.reduce((s, r) => s + r.feedAmount, 0),
      total_feed_cost: daily.reduce((s, r) => s + r.feedCost, 0),
      total_mortality: daily.reduce((s, r) => s + r.mortality, 0),
      biweekly_samples: biweekly.length,
      harvest_events: harvests.length,
      harvest_weight_kg: harvests.reduce((s, h) => s + h.totalWeight, 0),
      avg_fcr: periodHarvestFcr(harvests.map(harvestRow)),
      avg_growth_g_day: periodGrowthPerDay(biweekly.map(sampleRow)),
    }

    const byCage = cages.map((c) => {
      const d = daily.filter((r) => String(r.cageId) === String(c._id))
      const b = biweekly.filter((r) => String(r.cageId) === String(c._id))
      const h = harvests.filter((r) => String(r.cageId) === String(c._id))
      const latestAbw = [...b].sort((a, x) => x.date.localeCompare(a.date))[0]
      return {
        cage_id: c._id,
        cage_name: c.name,
        status: c.status,
        current_count: c.currentCount ?? 0,
        feed_kg: d.reduce((s, r) => s + r.feedAmount, 0),
        feed_cost: d.reduce((s, r) => s + r.feedCost, 0),
        mortality: d.reduce((s, r) => s + r.mortality, 0),
        latest_abw: latestAbw?.averageBodyWeight ?? null,
        harvest_weight_kg: h.reduce((s, r) => s + r.totalWeight, 0),
      }
    })

    return {
      report_type: args.reportType,
      date_range: { start: args.startDate, end: args.endDate },
      summary,
      by_cage: byCage,
      daily_rows: daily.map((r) => ({
        date: r.date,
        cage: cageName[String(r.cageId)] || String(r.cageId),
        feed_kg: r.feedAmount,
        feed_cost: r.feedCost,
        mortality: r.mortality,
        notes: r.notes ?? '',
      })),
      growth_rows: biweekly.map((r) => ({
        date: r.date,
        cage: cageName[String(r.cageId)] || String(r.cageId),
        batch_code: r.batchCode,
        abw: r.averageBodyWeight,
        fish_count: r.totalFishCount,
        total_weight: r.totalWeight,
      })),
      mortality_rows: daily
        .filter((r) => r.mortality > 0)
        .map((r) => ({
          date: r.date,
          cage: cageName[String(r.cageId)] || String(r.cageId),
          mortality: r.mortality,
          notes: r.notes ?? '',
        })),
      financial_rows: daily.map((r) => ({
        date: r.date,
        cage: cageName[String(r.cageId)] || String(r.cageId),
        feed_kg: r.feedAmount,
        unit_price: r.feedPrice,
        feed_cost: r.feedCost,
      })),
      harvest_rows: harvests.map((h) => ({
        date: h.harvestDate,
        cage: cageName[String(h.cageId)] || String(h.cageId),
        weight_kg: h.totalWeight,
        abw: h.averageBodyWeight,
        count: h.estimatedCount,
        fcr: h.fcr,
      })),
    }
  },
})

/** Compact farm snapshot for the AI assistant. */
export const farmContextForAi = query({
  args: {
    /** Client's today (YYYY-MM-DD); "last 30 days" ends here. */
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'ai.use' })

    const role = user.role ?? 'user'
    if (role !== 'super_admin' || user.companyId) {
      if (!user.companyId) {
        throw new Error('AI assistant is disabled (no company)')
      }
      const company = await ctx.db.get(user.companyId)
      if (company?.settings?.aiAssistantEnabled !== true) {
        throw new Error('AI assistant is disabled by admin')
      }
    }

    // Bounded to the company and the last 30 days.
    const cages = await scopedRows(ctx, user, 'cages')
    const recent = await scopedRowsInRange(ctx, user, 'dailyRecords', {
      from: daysBefore(asOfDate(args.asOf), 30),
    })
    const feedTypes = await scopedRows(ctx, user, 'feedTypes')

    return {
      user: { email: user.email, role: user.role ?? 'user', name: user.name },
      cages: cages.map((c) => ({
        name: c.name,
        status: c.status,
        current_count: c.currentCount ?? 0,
        stocking_date: c.stockingDate,
      })),
      last_30_days: {
        feed_kg: recent.reduce((s, r) => s + r.feedAmount, 0),
        feed_cost: recent.reduce((s, r) => s + r.feedCost, 0),
        mortality: recent.reduce((s, r) => s + r.mortality, 0),
        daily_entries: recent.length,
      },
      feed_stock: feedTypes
        .filter((f) => f.active && !f.deletedAt)
        .map((f) => ({
          name: f.name,
          stock_kg: f.currentStock,
          min_kg: f.minimumStock,
          low: f.currentStock <= f.minimumStock,
        })),
    }
  },
})

const inDateRange = (date: string, from?: string | null, to?: string | null) =>
  (!from || date >= from) && (!to || date <= to)

/** A cage's real harvests dated in [from, to]. */
async function cageHarvests(
  ctx: QueryCtx,
  cageId: Id<'cages'>,
  from?: string | null,
  to?: string | null,
) {
  return (
    await ctx.db
      .query('harvestRecords')
      .withIndex('by_cage', (q) => q.eq('cageId', cageId))
      .collect()
  ).filter((h) => isRealHarvest(h) && inDateRange(h.harvestDate, from, to))
}

/**
 * Costs and margins for one cost centre (a cage, or one cycle of a cage):
 * feed at purchase prices (lib/costing), fingerling and other expenses,
 * revenue from sales. Field names extend the original P&L rows.
 */
function costRow(args: {
  daily: Doc<'dailyRecords'>[]
  expenses: Doc<'expenses'>[]
  sales: Doc<'sales'>[]
  harvests: Doc<'harvestRecords'>[]
  book: PriceBook
}) {
  const feed = feedCostFromLedger(args.daily, args.book)
  const split = splitExpenses(args.expenses)
  const harvestKg = args.harvests.reduce((s, r) => s + r.totalWeight, 0)
  const soldKg = args.sales.reduce((s, r) => s + r.weightKg, 0)
  const revenue = args.sales.reduce((s, r) => s + r.totalAmount, 0)
  const grossMargin = revenue - feed.cost
  return {
    feed_kg: feed.kg,
    /** At purchase prices (list price before INV-008). */
    feed_cost: feed.cost,
    feed_cost_list: feed.listCost,
    feed_list_priced_kg: feed.listPricedKg,
    fingerling_cost: split.fingerlings,
    other_expenses: split.other,
    expenses_by_category: split.byCategory,
    mortality: args.daily.reduce((s, r) => s + r.mortality, 0),
    harvest_kg: harvestKg,
    sold_kg: soldKg,
    revenue,
    /** Revenue minus feed cost. */
    gross_margin: grossMargin,
    margin_pct: revenue > 0 ? (grossMargin / revenue) * 100 : null,
    ...summarizeCost({
      feedCost: feed.cost,
      fingerlingCost: split.fingerlings,
      otherExpenses: split.other,
      revenue,
      harvestKg,
      soldKg,
    }),
  }
}

/**
 * Per-cage P&L: feed (at purchase prices), fingerlings and other expenses
 * against sales revenue, with cost per kg.
 */
export const getCagePnL = query({
  args: {
    cageId: v.id('cages'),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const cage = await ctx.db.get(args.cageId)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null

    const daily = await cageDaily(ctx, args.cageId, args.dateFrom, args.dateTo)
    const harvests = await cageHarvests(ctx, args.cageId, args.dateFrom, args.dateTo)
    const sales = (
      await ctx.db
        .query('sales')
        .withIndex('by_company_and_cage', (q) =>
          q.eq('companyId', cage.companyId).eq('cageId', args.cageId),
        )
        .collect()
    ).filter((s) => inDateRange(s.saleDate, args.dateFrom, args.dateTo))
    const expenses = await cageExpenses(ctx, cage, args.dateFrom, args.dateTo)
    const book = await loadPriceBook(ctx, user)

    const mortalityByCause: Record<string, number> = {}
    for (const r of daily) {
      if (!(r.mortality > 0)) continue
      const cause = r.mortalityCause || 'unknown'
      mortalityByCause[cause] = (mortalityByCause[cause] || 0) + r.mortality
    }

    return {
      cage_id: cage._id,
      cage_name: cage.name,
      species: cage.species || null,
      status: cage.status,
      ...costRow({ daily, expenses, sales, harvests, book }),
      mortality_by_cause: mortalityByCause,
      sale_count: sales.length,
      expense_count: expenses.length,
      daily_entries: daily.length,
    }
  },
})

/** P&L rollup for cages at a location (or company). */
export const listCagePnL = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const cages = await scopedRows(ctx, user, 'cages', { locationId: args.locationId })
    const book = await loadPriceBook(ctx, user)

    // The company's sales in the period, read once and grouped by cage
    // (was one full sales-table scan per cage).
    const salesByCage = new Map<string, Doc<'sales'>[]>()
    for (const s of await scopedRowsInRange(ctx, user, 'sales', {
      from: args.dateFrom,
      to: args.dateTo,
    })) {
      if (!s.cageId) continue
      const key = String(s.cageId)
      salesByCage.set(key, [...(salesByCage.get(key) ?? []), s])
    }

    const rows = []
    for (const cage of cages) {
      const daily = await cageDaily(ctx, cage._id, args.dateFrom, args.dateTo)
      const sales = salesByCage.get(String(cage._id)) ?? []
      const harvests = await cageHarvests(ctx, cage._id, args.dateFrom, args.dateTo)
      const expenses = await cageExpenses(ctx, cage, args.dateFrom, args.dateTo)
      if (
        daily.length === 0 &&
        sales.length === 0 &&
        harvests.length === 0 &&
        expenses.length === 0
      ) {
        continue
      }
      rows.push({
        cage_id: cage._id,
        cage_name: cage.name,
        species: cage.species || null,
        status: cage.status,
        ...costRow({ daily, expenses, sales, harvests, book }),
      })
    }

    return rows.sort((a, b) => b.net_margin - a.net_margin)
  },
})

/**
 * P&L per production cycle: each approved stocking of a cage, from its
 * stocking date to its close (or the day before the next stocking, or open).
 * Expenses tagged to the cycle count, plus the cage's untagged expenses in
 * the cycle's dates.
 */
export const listCyclePnL = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    cageId: v.optional(v.id('cages')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    let cages = await scopedRows(ctx, user, 'cages', { locationId: args.locationId })
    if (args.cageId) cages = cages.filter((c) => c._id === args.cageId)
    const book = await loadPriceBook(ctx, user)

    const rows = []
    for (const cage of cages) {
      const stockings = (
        await ctx.db
          .query('stockingHistory')
          .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
          .collect()
      )
        .filter((s) => s.status === 'approved' && !s.deletedAt)
        .sort((a, b) => a.stockingDate.localeCompare(b.stockingDate))
      if (stockings.length === 0) continue

      const allExpenses = await cageExpenses(ctx, cage)
      const allSales = await ctx.db
        .query('sales')
        .withIndex('by_company_and_cage', (q) =>
          q.eq('companyId', cage.companyId).eq('cageId', cage._id),
        )
        .collect()
      const allHarvests = await cageHarvests(ctx, cage._id)

      for (let i = 0; i < stockings.length; i++) {
        const s = stockings[i]
        const next = stockings[i + 1]
        const from = s.stockingDate
        const to = s.closedAt ?? (next ? daysBefore(next.stockingDate, 1) : null)
        const daily = await cageDaily(ctx, cage._id, from, to)
        const expenses = allExpenses.filter((e) =>
          e.stockingId ? e.stockingId === s._id : inDateRange(e.date, from, to),
        )
        rows.push({
          cycle_id: s._id,
          batch_number: s.batchNumber,
          cage_id: cage._id,
          cage_name: cage.name,
          species: s.species || cage.species || null,
          start_date: from,
          end_date: to,
          open: !s.closedAt && !next,
          fish_stocked: s.fishCount,
          ...costRow({
            daily,
            expenses,
            sales: allSales.filter((x) => inDateRange(x.saleDate, from, to)),
            harvests: allHarvests.filter((h) => inDateRange(h.harvestDate, from, to)),
            book,
          }),
        })
      }
    }
    return rows.sort((a, b) => b.start_date.localeCompare(a.start_date))
  },
})

/**
 * Expenses in the period not tied to a cage (site or company overheads), so
 * the farm P&L adds up: cage rows + overheads = all costs.
 */
export const pnlOverheads = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const scope = tenantScope(user)
    if (scope.kind !== 'company') return { total: 0, by_category: {} }
    const rows = (
      await ctx.db
        .query('expenses')
        .withIndex('by_company_and_date', (q) => {
          const c = q.eq('companyId', scope.companyId)
          if (args.dateFrom && args.dateTo) return c.gte('date', args.dateFrom).lte('date', args.dateTo)
          if (args.dateFrom) return c.gte('date', args.dateFrom)
          if (args.dateTo) return c.lte('date', args.dateTo)
          return c
        })
        .collect()
    ).filter((e) => !e.cageId && (!args.locationId || e.locationId === args.locationId))
    const split = splitExpenses(rows)
    return { total: split.total, by_category: split.byCategory }
  },
})

// ---------------------------------------------------------------------------
// Rollup reads (PLAT-002): one row per occupancy or per unit-day.
// ---------------------------------------------------------------------------

/** Open occupancies of the caller's company (one batchStats row each). */
async function openOccupancies(
  ctx: QueryCtx,
  user: Doc<'users'>,
  locationId?: Id<'farmLocations'> | null,
) {
  const scope = tenantScope(user)
  if (scope.kind !== 'company') return []
  const rows = await ctx.db
    .query('batchStats')
    .withIndex('by_companyId_and_open', (q) => q.eq('companyId', scope.companyId).eq('open', true))
    .take(2000)
  return locationId ? rows.filter((r) => r.locationId === locationId) : rows
}

/**
 * Standing production from the rollups: live fish, biomass, cycle-to-date
 * FCR, survival and SGR over the open occupancies (lib/kpi definitions).
 * `occupancies` 0 means the rollups are empty (before the backfill).
 */
export const productionOverview = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const rows = await openOccupancies(ctx, user, args.locationId)
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0)
    return {
      occupancies: rows.length,
      live_fish: sum((r) => Math.max(0, r.kpis.count)),
      biomass_kg: sum((r) => r.kpis.current_biomass_kg),
      feed_kg: sum((r) => r.kpis.feed_kg),
      feed_cost: sum((r) => r.feedCostLedger),
      efcr: pooledFcr(rows.map((r) => ({ feedKg: r.kpis.feed_kg, gainKg: r.kpis.gain_kg }))),
      survival_pct: survivalPct({
        count: sum((r) => r.kpis.count),
        harvestedCount: sum((r) => r.kpis.harvested_count),
        outCount: sum((r) => r.kpis.out_count),
        stockedCount: sum((r) => r.kpis.stocked_count),
        inCount: sum((r) => r.kpis.in_count),
      }),
      avg_sgr_pct_day: mean(rows.map((r) => r.kpis.sgr_pct_day)),
      updated_at: rows.reduce((m, r) => Math.max(m, r.updatedAt), 0) || null,
    }
  },
})

/** Feed and deaths per day across the company's units, from unitDailyStats. */
export const dailySeries = query({
  args: {
    from: v.string(),
    to: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.array(v.object({ date: v.string(), feed_kg: v.number(), feed_cost: v.number(), mortality: v.number() })),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const scope = tenantScope(user)
    if (scope.kind !== 'company') return []
    const rows = await ctx.db
      .query('unitDailyStats')
      .withIndex('by_companyId_and_date', (q) => {
        const c = q.eq('companyId', scope.companyId).gte('date', args.from)
        return args.to ? c.lte('date', args.to) : c
      })
      .take(10_000)
    const byDate = new Map<
      string,
      { date: string; feed_kg: number; feed_cost: number; mortality: number }
    >()
    for (const r of rows) {
      if (args.locationId && r.locationId !== args.locationId) continue
      const d = byDate.get(r.date) ?? { date: r.date, feed_kg: 0, feed_cost: 0, mortality: 0 }
      d.feed_kg += r.feedKg
      d.feed_cost += r.feedCostList
      d.mortality += r.mortalityRecorded
      byDate.set(r.date, d)
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  },
})
