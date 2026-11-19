import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { scopedRows, scopedRowsInRange, tenantScope } from './lib/scope'
import { mergeSettings } from './lib/farmRules'
import { splitExpenses } from './lib/costing'
import { addDays, isBusinessDate } from './lib/dates'
import {
  forecast,
  groupKpis,
  growthCurve,
  noCosts,
  periodOf,
  weekEnds,
  weeklySeries,
  type CostInputs,
  type Period,
  type Stats,
} from './lib/analytics'
import { userError } from './lib/errors'
import { requireMember } from './lib/permissions'

/**
 * Analytics pages (ANLY-002..004, Phase 13): farm comparison, growth curves
 * and forecasts, weekly trends and cycle profitability. All read the rollups
 * (one batchStats row per occupancy) plus the period's expenses and sales;
 * KPIs and costs come from lib/kpi and lib/costing through lib/analytics.
 * Dates come from the client (`YYYY-MM-DD`): queries never read the clock.
 */

const MAX_OCCUPANCIES = 2000

function assertDate(value: string, label: string) {
  if (!isBusinessDate(value)) throw userError('VALIDATION', `${label} must be a date (YYYY-MM-DD)`)
}

/** Occupancies of the caller's company with fish on or after `from`. */
export async function occupanciesSince(
  ctx: QueryCtx,
  user: Doc<'users'>,
  from: string,
  locationId?: Id<'farmLocations'> | null,
): Promise<Stats[]> {
  const scope = tenantScope(user)
  if (scope.kind !== 'company') return []
  const rows = await ctx.db
    .query('batchStats')
    .withIndex('by_companyId_and_lastDate', (q) =>
      q.eq('companyId', scope.companyId).gte('lastDate', from),
    )
    .take(MAX_OCCUPANCIES)
  return locationId ? rows.filter((r) => r.locationId === locationId) : rows
}

/** Unit and site names of the company. */
export async function names(ctx: QueryCtx, user: Doc<'users'>) {
  const cages = await scopedRows(ctx, user, 'cages')
  const sites = await scopedRows(ctx, user, 'farmLocations')
  return {
    unit: new Map(cages.map((c) => [String(c._id), c])),
    site: new Map(sites.map((s) => [String(s._id), s])),
  }
}

export async function farmTarget(ctx: QueryCtx, user: Doc<'users'>) {
  const company = user.companyId ? await ctx.db.get(user.companyId) : null
  const rules = mergeSettings(company?.settings).farmRules
  return { abwG: rules.targetHarvestAbwG, days: rules.harvestDocMaxDays }
}

type CostRow = { cageId?: Id<'cages'>; locationId?: Id<'farmLocations'> }

function addCosts(
  into: Map<string, CostInputs>,
  key: string,
  f: (c: CostInputs) => void,
) {
  const c = into.get(key) ?? noCosts()
  f(c)
  into.set(key, c)
}

/**
 * Sites and units side by side for a period: FCR, SGR, survival, mortality,
 * biomass, cost per kg and margin. Expenses and sales dated in the period
 * count against their unit (cage) and site; unallocated ones against the farm.
 */
export const comparison = query({
  args: {
    from: v.string(),
    to: v.string(),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.object({
    from: v.string(),
    to: v.string(),
    farm: v.object({
      occupancies: v.number(),
      fish_end: v.number(),
      biomass_kg: v.number(),
      feed_kg: v.number(),
      gain_kg: v.number(),
      harvested_kg: v.number(),
      mortality: v.number(),
      fcr: v.union(v.number(), v.null()),
      survival_pct: v.union(v.number(), v.null()),
      mortality_pct: v.union(v.number(), v.null()),
      sgr_pct_day: v.union(v.number(), v.null()),
      feed_cost: v.number(),
      fingerling_cost: v.number(),
      other_cost: v.number(),
      revenue: v.number(),
      total_cost: v.number(),
      cost_per_kg: v.union(v.number(), v.null()),
      cost_per_kg_produced: v.union(v.number(), v.null()),
      net_margin: v.number(),
      net_margin_pct: v.union(v.number(), v.null()),
    }),
    sites: v.array(
      v.object({
        occupancies: v.number(),
        fish_end: v.number(),
        biomass_kg: v.number(),
        feed_kg: v.number(),
        gain_kg: v.number(),
        harvested_kg: v.number(),
        mortality: v.number(),
        fcr: v.union(v.number(), v.null()),
        survival_pct: v.union(v.number(), v.null()),
        mortality_pct: v.union(v.number(), v.null()),
        sgr_pct_day: v.union(v.number(), v.null()),
        feed_cost: v.number(),
        fingerling_cost: v.number(),
        other_cost: v.number(),
        revenue: v.number(),
        total_cost: v.number(),
        cost_per_kg: v.union(v.number(), v.null()),
        cost_per_kg_produced: v.union(v.number(), v.null()),
        net_margin: v.number(),
        net_margin_pct: v.union(v.number(), v.null()),
        id: v.union(v.string(), v.null()),
        name: v.string(),
        units: v.number(),
      }),
    ),
    units: v.array(
      v.object({
        occupancies: v.number(),
        fish_end: v.number(),
        biomass_kg: v.number(),
        feed_kg: v.number(),
        gain_kg: v.number(),
        harvested_kg: v.number(),
        mortality: v.number(),
        fcr: v.union(v.number(), v.null()),
        survival_pct: v.union(v.number(), v.null()),
        mortality_pct: v.union(v.number(), v.null()),
        sgr_pct_day: v.union(v.number(), v.null()),
        feed_cost: v.number(),
        fingerling_cost: v.number(),
        other_cost: v.number(),
        revenue: v.number(),
        total_cost: v.number(),
        cost_per_kg: v.union(v.number(), v.null()),
        cost_per_kg_produced: v.union(v.number(), v.null()),
        net_margin: v.number(),
        net_margin_pct: v.union(v.number(), v.null()),
        id: v.string(),
        name: v.string(),
        unit_type: v.union(
          v.literal('cage'),
          v.literal('pond'),
          v.literal('tank'),
          v.literal('raceway'),
          v.literal('hatchery_tank'),
          v.literal('incubator'),
          v.literal('hapa'),
        ),
        site_id: v.union(v.id('farmLocations'), v.null()),
        site_name: v.union(v.string(), v.null()),
        batches: v.array(v.string()),
      }),
    ),
    updated_at: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    assertDate(args.from, 'From')
    assertDate(args.to, 'To')
    if (args.from > args.to) throw userError('VALIDATION', 'From must be on or before To')
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const scope = tenantScope(user)
    const stats = await occupanciesSince(ctx, user, args.from, args.locationId)
    const n = await names(ctx, user)

    const expenses =
      scope.kind === 'company'
        ? (
            await ctx.db
              .query('expenses')
              .withIndex('by_company_and_date', (q) =>
                q.eq('companyId', scope.companyId).gte('date', args.from).lte('date', args.to),
              )
              .take(10_000)
          ).filter((e) => !e.deletedAt && (!args.locationId || e.locationId === args.locationId))
        : []
    const sales = await scopedRowsInRange(ctx, user, 'sales', {
      from: args.from,
      to: args.to,
      locationId: args.locationId,
      limit: 10_000,
    })

    const byUnit = new Map<string, CostInputs>()
    const bySite = new Map<string, CostInputs>()
    const farm = noCosts()
    const siteOf = (r: CostRow) =>
      r.locationId ? String(r.locationId) : r.cageId ? String(n.unit.get(String(r.cageId))?.locationId ?? '') : ''
    for (const e of expenses) {
      const split = splitExpenses([e])
      const apply = (c: CostInputs) => {
        c.fingerlingCost += split.fingerlings
        c.otherExpenses += split.other
      }
      apply(farm)
      if (e.cageId) addCosts(byUnit, String(e.cageId), apply)
      const site = siteOf(e)
      if (site) addCosts(bySite, site, apply)
    }
    for (const s of sales) {
      const apply = (c: CostInputs) => {
        c.revenue += s.totalAmount
        c.soldKg += s.weightKg
      }
      apply(farm)
      if (s.cageId) addCosts(byUnit, String(s.cageId), apply)
      const site = siteOf(s)
      if (site) addCosts(bySite, site, apply)
    }

    const periods = stats
      .map((s) => periodOf(s, args.from, args.to))
      .filter((p): p is Period => p != null)
    const group = (key: (p: Period) => string) => {
      const m = new Map<string, Period[]>()
      for (const p of periods) {
        const k = key(p)
        m.set(k, [...(m.get(k) ?? []), p])
      }
      return m
    }

    const unitKeys = new Set([...group((p) => String(p.stats.unitId)).keys(), ...byUnit.keys()])
    const unitPeriods = group((p) => String(p.stats.unitId))
    const units = [...unitKeys]
      .filter((id) => n.unit.has(id))
      .map((id) => {
        const cage = n.unit.get(id)!
        const site = cage.locationId ? n.site.get(String(cage.locationId)) : undefined
        return {
          id,
          name: cage.name,
          unit_type: cage.unitType ?? 'cage',
          site_id: cage.locationId ?? null,
          site_name: site?.name ?? null,
          batches: (unitPeriods.get(id) ?? []).map((p) => p.stats.batchNumber),
          ...groupKpis(unitPeriods.get(id) ?? [], byUnit.get(id)),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const sitePeriods = group((p) => String(p.stats.locationId ?? ''))
    const siteKeys = new Set([...sitePeriods.keys(), ...bySite.keys()])
    const sites = [...siteKeys]
      .map((id) => ({
        id: id || null,
        name: id ? (n.site.get(id)?.name ?? 'Unknown site') : 'No site',
        units: units.filter((u) => String(u.site_id ?? '') === id).length,
        ...groupKpis(sitePeriods.get(id) ?? [], bySite.get(id)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      from: args.from,
      to: args.to,
      farm: groupKpis(periods, farm),
      sites,
      units,
      updated_at: stats.reduce((m, s) => Math.max(m, s.updatedAt), 0) || null,
    }
  },
})

/**
 * Growth of each occupancy against the farm's target curve (constant SGR from
 * the stocking ABW to the target harvest ABW at the target days of culture),
 * with a forecast to `forecastOn` and the date the target ABW is reached.
 */
export const growth = query({
  args: {
    /** Client's today. */
    asOf: v.string(),
    /** Date to project ABW and biomass to (default asOf + 30 days). */
    forecastOn: v.optional(v.string()),
    /** Harvest weight to forecast for (default the farm rule). */
    targetAbwG: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
    /** Include occupancies closed in the last N days (default 0: open only). */
    closedWithinDays: v.optional(v.number()),
  },
  returns: v.object({
    target: v.object({ abw_g: v.number(), days: v.number(), harvest_abw_g: v.number() }),
    forecast_on: v.string(),
    occupancies: v.array(
      v.object({
        unit_id: v.id('cages'),
        unit_name: v.string(),
        site_name: v.union(v.string(), v.null()),
        batch_id: v.id('batches'),
        batch_number: v.string(),
        species: v.union(v.string(), v.null()),
        open: v.boolean(),
        as_of: v.string(),
        opened_on: v.union(v.string(), v.null()),
        days_of_culture: v.union(v.number(), v.null()),
        count: v.number(),
        abw_g: v.union(v.number(), v.null()),
        biomass_kg: v.number(),
        efcr: v.union(v.number(), v.null()),
        sgr_pct_day: v.union(v.number(), v.null()),
        survival_pct: v.union(v.number(), v.null()),
        curve: v.array(
          v.object({
            date: v.string(),
            doc: v.union(v.number(), v.null()),
            abw_g: v.union(v.number(), v.null()),
            target_g: v.union(v.number(), v.null()),
          }),
        ),
        forecast: v.union(
          v.object({
            abw_g: v.union(v.number(), v.null()),
            abw_date: v.string(),
            sgr_pct_day: v.union(v.number(), v.null()),
            sgr_source: v.union(v.literal('recent samples'), v.literal('cycle')),
            daily_mortality_pct: v.union(v.number(), v.null()),
            projected_abw_g: v.union(v.number(), v.null()),
            projected_count: v.number(),
            projected_biomass_kg: v.union(v.number(), v.null()),
            harvest_ready_on: v.union(v.string(), v.null()),
            days_to_target: v.union(v.number(), v.null()),
          }),
          v.null(),
        ),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    assertDate(args.asOf, 'As of')
    if (args.forecastOn) assertDate(args.forecastOn, 'Forecast date')
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const target = await farmTarget(ctx, user)
    const harvestAt = args.targetAbwG && args.targetAbwG > 0 ? args.targetAbwG : target.abwG
    const since = addDays(args.asOf, -Math.max(0, Math.min(args.closedWithinDays ?? 0, 730)))
    const stats = await occupanciesSince(ctx, user, since, args.locationId)
    const n = await names(ctx, user)
    const at = args.forecastOn ?? addDays(args.asOf, 30)
    return {
      target: { abw_g: target.abwG, days: target.days, harvest_abw_g: harvestAt },
      forecast_on: at,
      occupancies: stats
        .map((s) => ({
          unit_id: s.unitId,
          unit_name: n.unit.get(String(s.unitId))?.name ?? 'Unknown unit',
          site_name: s.locationId ? (n.site.get(String(s.locationId))?.name ?? null) : null,
          batch_id: s.batchId,
          batch_number: s.batchNumber,
          species: s.speciesCode ?? null,
          open: s.open,
          as_of: s.asOf,
          opened_on: s.kpis.opened_on,
          days_of_culture: s.kpis.days_of_culture,
          count: s.kpis.count,
          abw_g: s.kpis.current_abw_g,
          biomass_kg: s.kpis.current_biomass_kg,
          efcr: s.kpis.efcr,
          sgr_pct_day: s.kpis.sgr_pct_day,
          survival_pct: s.kpis.survival_pct,
          curve: growthCurve(s, target),
          forecast: s.open ? forecast(s, at, harvestAt) : null,
        }))
        .sort((a, b) => a.unit_name.localeCompare(b.unit_name, undefined, { numeric: true })),
    }
  },
})

const farmRow = v.object({
  week_end: v.string(),
  units: v.number(),
  feed_kg: v.number(),
  gain_kg: v.number(),
  week_fcr: v.union(v.number(), v.null()),
  cycle_fcr: v.union(v.number(), v.null()),
  mortality: v.number(),
  mortality_pct: v.union(v.number(), v.null()),
})

/**
 * Week by week figures for the farm and each unit: feed, gain, the week's
 * FCR and the cycle-to-date FCR, deaths and mortality %. Feeds the feed
 * efficiency trend and the mortality heatmap.
 */
export const trends = query({
  args: {
    /** Client's today: the last full week ends on the Sunday on or before it. */
    asOf: v.string(),
    weeks: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.object({
    weeks: v.array(v.string()),
    farm: v.array(farmRow),
    units: v.array(
      v.object({
        unit_id: v.string(),
        unit_name: v.string(),
        site_name: v.union(v.string(), v.null()),
        series: v.array(farmRow),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    assertDate(args.asOf, 'As of')
    const weeks = weekEnds(args.asOf, Math.max(2, Math.min(args.weeks ?? 12, 26)))
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const stats = await occupanciesSince(ctx, user, addDays(weeks[0], -6), args.locationId)
    const n = await names(ctx, user)
    const byUnit = new Map<string, Stats[]>()
    for (const s of stats) byUnit.set(String(s.unitId), [...(byUnit.get(String(s.unitId)) ?? []), s])
    return {
      weeks,
      farm: weeklySeries(stats, weeks),
      units: [...byUnit.entries()]
        .map(([id, rows]) => ({
          unit_id: id,
          unit_name: n.unit.get(id)?.name ?? 'Unknown unit',
          site_name: rows[0].locationId ? (n.site.get(String(rows[0].locationId))?.name ?? null) : null,
          series: weeklySeries(rows, weeks),
        }))
        .sort((a, b) => a.unit_name.localeCompare(b.unit_name, undefined, { numeric: true })),
    }
  },
})

/**
 * Profitability by cycle (one occupancy = one cycle of a unit): feed at
 * purchase prices, fingerling and other expenses tagged to the unit in the
 * cycle's dates (or to its stocking), and revenue from the unit's sales in
 * those dates. Latest 100 cycles.
 */
export const cycles = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  returns: v.array(
    v.object({
      occupancies: v.number(),
      fish_end: v.number(),
      biomass_kg: v.number(),
      feed_kg: v.number(),
      gain_kg: v.number(),
      harvested_kg: v.number(),
      mortality: v.number(),
      fcr: v.union(v.number(), v.null()),
      survival_pct: v.union(v.number(), v.null()),
      mortality_pct: v.union(v.number(), v.null()),
      sgr_pct_day: v.union(v.number(), v.null()),
      feed_cost: v.number(),
      fingerling_cost: v.number(),
      other_cost: v.number(),
      revenue: v.number(),
      total_cost: v.number(),
      cost_per_kg: v.union(v.number(), v.null()),
      cost_per_kg_produced: v.union(v.number(), v.null()),
      net_margin: v.number(),
      net_margin_pct: v.union(v.number(), v.null()),
      unit_id: v.id('cages'),
      unit_name: v.string(),
      site_name: v.union(v.string(), v.null()),
      batch_number: v.string(),
      open: v.boolean(),
      start_date: v.string(),
      end_date: v.string(),
      days_of_culture: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    const scope = tenantScope(user)
    if (scope.kind !== 'company') return []
    const rows = (
      await ctx.db
        .query('batchStats')
        .withIndex('by_companyId_and_lastDate', (q) => q.eq('companyId', scope.companyId))
        .order('desc')
        .take(args.locationId ? 500 : 100)
    )
      .filter((r) => !args.locationId || r.locationId === args.locationId)
      .slice(0, 100)
    const n = await names(ctx, user)

    const out = []
    for (const s of rows) {
      const from = s.kpis.opened_on ?? s.asOf
      const to = s.open ? s.asOf : s.lastDate
      const batch = await ctx.db.get(s.batchId)
      const expenses = (
        await ctx.db
          .query('expenses')
          .withIndex('by_company_and_cage', (q) =>
            q.eq('companyId', scope.companyId).eq('cageId', s.unitId),
          )
          .take(2000)
      ).filter(
        (e) =>
          !e.deletedAt &&
          (e.stockingId && batch?.legacyStockingId
            ? e.stockingId === batch.legacyStockingId
            : e.date >= from && e.date <= to),
      )
      const sales = (
        await ctx.db
          .query('sales')
          .withIndex('by_company_and_cage', (q) =>
            q.eq('companyId', scope.companyId).eq('cageId', s.unitId),
          )
          .take(2000)
      ).filter((x) => x.saleDate >= from && x.saleDate <= to)
      const split = splitExpenses(expenses)
      const period: Period = {
        stats: s,
        start: null,
        end: s.weekly[s.weekly.length - 1],
        feedKg: s.kpis.feed_kg,
        feedCost: s.feedCostLedger,
        gainKg: s.kpis.gain_kg,
        harvestedKg: s.kpis.harvested_kg,
        harvestedCount: s.kpis.harvested_count,
        outCount: s.kpis.out_count,
        inCount: s.kpis.in_count,
        stockedCount: s.kpis.stocked_count,
        mortality: s.kpis.mortality,
        startCount: 0,
        sgr: s.kpis.sgr_pct_day,
      }
      out.push({
        unit_id: s.unitId,
        unit_name: n.unit.get(String(s.unitId))?.name ?? 'Unknown unit',
        site_name: s.locationId ? (n.site.get(String(s.locationId))?.name ?? null) : null,
        batch_number: s.batchNumber,
        open: s.open,
        start_date: from,
        end_date: to,
        days_of_culture: s.kpis.days_of_culture,
        ...groupKpis([period], {
          fingerlingCost: split.fingerlings,
          otherExpenses: split.other,
          revenue: sales.reduce((t, x) => t + x.totalAmount, 0),
          soldKg: sales.reduce((t, x) => t + x.weightKg, 0),
        }),
      })
    }
    return out
  },
})
