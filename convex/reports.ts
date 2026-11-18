import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireUser } from './lib/authz'
import { listForCompany } from './lib/tenancy'
import { isRealHarvest } from './lib/cycles'
import { asOfDate, daysBefore, scopedRows, scopedRowsInRange } from './lib/scope'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

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
    const user = await requireUser(ctx)
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
    const user = await requireUser(ctx)
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
    let avgGrowth: number | null = null
    if (biweekly.length >= 2) {
      const byCage: Record<string, typeof biweekly> = {}
      for (const r of biweekly) {
        const key = String(r.cageId)
        if (!byCage[key]) byCage[key] = []
        byCage[key].push(r)
      }
      const rates: number[] = []
      for (const rows of Object.values(byCage)) {
        if (rows.length < 2) continue
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
        const first = sorted[0]
        const last = sorted[sorted.length - 1]
        const days = Math.max(
          1,
          Math.ceil(
            (new Date(last.date).getTime() - new Date(first.date).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
        rates.push((last.averageBodyWeight - first.averageBodyWeight) / days)
      }
      if (rates.length) {
        avgGrowth = rates.reduce((a, b) => a + b, 0) / rates.length
      }
    }

    const periodHarvests = (
      await scopedRowsInRange(ctx, user, 'harvestRecords', {
        from: cutoffDateStr,
        locationId: args.locationId,
      })
    ).filter(isRealHarvest)
    const fcrValues = periodHarvests
      .map((h) => h.fcr)
      .filter((f) => typeof f === 'number' && !Number.isNaN(f) && f > 0)
    const avgFcr =
      fcrValues.length > 0
        ? fcrValues.reduce((a, b) => a + b, 0) / fcrValues.length
        : null
    const harvestWeight = periodHarvests.reduce((s, h) => s + h.totalWeight, 0)

    const mortalityPct =
      activeFish + recentMortality > 0
        ? (recentMortality / (activeFish + recentMortality)) * 100
        : 0

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
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)

    const range = { from: args.dateFrom, to: args.dateTo, order: 'asc' as const }

    // Get daily records
    let dailyRecords = args.cageId
      ? await cageDaily(ctx, args.cageId, args.dateFrom, args.dateTo)
      : await scopedRowsInRange(ctx, user, 'dailyRecords', range)
    dailyRecords = await listForCompany(user, dailyRecords)

    // Get biweekly records
    let biweeklyRecords = args.cageId
      ? await ctx.db
          .query('biweeklyRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRowsInRange(ctx, user, 'biweeklyRecords', range)

    biweeklyRecords = await listForCompany(user, biweeklyRecords)
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

    harvestRecords = await listForCompany(user, harvestRecords)
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
    })

    const transformHarvestRecord = (r: any) => ({
      id: r._id,
      cage_id: r.cageId,
      harvest_date: r.harvestDate,
      average_body_weight: r.averageBodyWeight,
      total_weight: r.totalWeight,
      estimated_count: r.estimatedCount,
      fcr: r.fcr,
      size_breakdown: r.sizeBreakdown,
      notes: r.notes,
      harvest_type: r.harvestType,
      status: r.status,
      created_by: r.createdBy,
      created_at: r._creationTime,
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
        harvest_records_count: harvestRecords.length,
        total_mortality: dailyRecords.reduce((sum, r) => sum + r.mortality, 0),
        total_feed_usage: dailyRecords.reduce((sum, r) => sum + r.feedAmount, 0),
        total_feed_cost: dailyRecords.reduce((sum, r) => sum + r.feedCost, 0),
        total_harvest_weight: harvestRecords.reduce((sum, r) => sum + r.totalWeight, 0),
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
    const user = await requireUser(ctx)

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
    const user = await requireUser(ctx)
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
      avg_fcr:
        harvests.length > 0
          ? harvests.reduce((s, h) => s + h.fcr, 0) / harvests.length
          : null,
      avg_growth_g_day: (() => {
        if (biweekly.length < 2) return null
        const sorted = [...biweekly].sort((a, b) => a.date.localeCompare(b.date))
        const first = sorted[0]
        const last = sorted[sorted.length - 1]
        const days = Math.max(
          1,
          Math.ceil(
            (new Date(last.date).getTime() - new Date(first.date).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
        return (last.averageBodyWeight - first.averageBodyWeight) / days
      })(),
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
    const user = await requireUser(ctx)

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
/**
 * Per-cage P&L: feed cost from daily records vs sales revenue.
 */
export const getCagePnL = query({
  args: {
    cageId: v.id('cages'),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null

    const daily = await cageDaily(ctx, args.cageId, args.dateFrom, args.dateTo)

    let harvests = (
      await ctx.db
        .query('harvestRecords')
        .withIndex('by_cage', (q) => q.eq('cageId', args.cageId))
        .collect()
    ).filter(isRealHarvest)
    if (args.dateFrom)
      harvests = harvests.filter((r) => r.harvestDate >= args.dateFrom!)
    if (args.dateTo)
      harvests = harvests.filter((r) => r.harvestDate <= args.dateTo!)

    let sales = await ctx.db
      .query('sales')
      .withIndex('by_company_and_cage', (q) =>
        q.eq('companyId', cage.companyId).eq('cageId', args.cageId),
      )
      .collect()
    if (args.dateFrom) sales = sales.filter((s) => s.saleDate >= args.dateFrom!)
    if (args.dateTo) sales = sales.filter((s) => s.saleDate <= args.dateTo!)

    const feedKg = daily.reduce((s, r) => s + r.feedAmount, 0)
    const feedCost = daily.reduce((s, r) => s + r.feedCost, 0)
    const mortality = daily.reduce((s, r) => s + r.mortality, 0)
    const mortalityByCause: Record<string, number> = {}
    for (const r of daily) {
      if (!(r.mortality > 0)) continue
      const cause = r.mortalityCause || 'unknown'
      mortalityByCause[cause] = (mortalityByCause[cause] || 0) + r.mortality
    }

    const harvestKg = harvests.reduce((s, r) => s + r.totalWeight, 0)
    const soldKg = sales.reduce((s, r) => s + r.weightKg, 0)
    const revenue = sales.reduce((s, r) => s + r.totalAmount, 0)
    const grossMargin = revenue - feedCost

    return {
      cage_id: cage._id,
      cage_name: cage.name,
      species: cage.species || null,
      status: cage.status,
      feed_kg: feedKg,
      feed_cost: feedCost,
      mortality,
      mortality_by_cause: mortalityByCause,
      harvest_kg: harvestKg,
      sold_kg: soldKg,
      revenue,
      gross_margin: grossMargin,
      margin_pct: revenue > 0 ? (grossMargin / revenue) * 100 : null,
      sale_count: sales.length,
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
    const user = await requireUser(ctx)
    const cages = await scopedRows(ctx, user, 'cages', { locationId: args.locationId })

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


      let harvests = (
        await ctx.db
          .query('harvestRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
          .collect()
      ).filter(isRealHarvest)
      if (args.dateFrom)
        harvests = harvests.filter((r) => r.harvestDate >= args.dateFrom!)
      if (args.dateTo)
        harvests = harvests.filter((r) => r.harvestDate <= args.dateTo!)

      const feedCost = daily.reduce((s, r) => s + r.feedCost, 0)
      const revenue = sales.reduce((s, r) => s + r.totalAmount, 0)
      const grossMargin = revenue - feedCost
      if (daily.length === 0 && sales.length === 0 && harvests.length === 0) {
        continue
      }
      rows.push({
        cage_id: cage._id,
        cage_name: cage.name,
        species: cage.species || null,
        status: cage.status,
        feed_cost: feedCost,
        feed_kg: daily.reduce((s, r) => s + r.feedAmount, 0),
        mortality: daily.reduce((s, r) => s + r.mortality, 0),
        harvest_kg: harvests.reduce((s, r) => s + r.totalWeight, 0),
        sold_kg: sales.reduce((s, r) => s + r.weightKg, 0),
        revenue,
        gross_margin: grossMargin,
        margin_pct: revenue > 0 ? (grossMargin / revenue) * 100 : null,
      })
    }

    return rows.sort((a, b) => b.gross_margin - a.gross_margin)
  },
})
