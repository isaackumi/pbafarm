import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { inSiteScope, rollupRowsInSiteScope, scopedRows, scopedRowsInRange, tenantScope } from './lib/scope'
import { addDays, isBusinessDate } from './lib/dates'
import { userError } from './lib/errors'
import { forecast, targetAbw, weekEnds, weeklySeries, type Stats } from './lib/analytics'
import { daysBetween, round } from './lib/kpi'
import {
  forecastInsights,
  rankInsights,
  unitInsights,
  type Insight,
  type UnitForecast,
} from './lib/insights'
import { farmTarget, names, occupanciesSince } from './analytics'
import { can, memberContextIn, requireMember } from './lib/permissions'
import { SEVERITY_RANK, alertText, langOf } from './lib/earlyWarning'

/**
 * Grounded insights and the assistant's context (Phase 13, ANLY-005), both
 * from the rollups, both scoped to the caller's company and sites (PERM-004).
 * The assistant never gets more than these queries return to the same user.
 */

const INSIGHT_WEEKS = 6

function assertDate(value: string) {
  if (!isBusinessDate(value)) throw userError('VALIDATION', 'As of must be a date (YYYY-MM-DD)')
}

/** Weekly series and forecasts per unit, and every insight they trigger. */
async function analyse(
  ctx: QueryCtx,
  user: Doc<'users'>,
  asOf: string,
  locationId?: Doc<'farmLocations'>['_id'],
) {
  const weeks = weekEnds(asOf, INSIGHT_WEEKS)
  const stats = await occupanciesSince(ctx, user, addDays(weeks[0], -6), locationId)
  const n = await names(ctx, user)
  const target = await farmTarget(ctx, user)
  const unitName = (id: string) => n.unit.get(id)?.name ?? 'Unknown unit'

  const byUnit = new Map<string, Stats[]>()
  for (const s of stats) byUnit.set(String(s.unitId), [...(byUnit.get(String(s.unitId)) ?? []), s])
  const units = [...byUnit.entries()].map(([id, rows]) => ({
    unit_id: id,
    unit_name: unitName(id),
    series: weeklySeries(rows, weeks),
  }))

  const forecasts: Array<UnitForecast & { batch_number: string; stats: Stats }> = stats
    .filter((s) => s.open)
    .map((s) => {
      const f = forecast(s, addDays(asOf, 30), target.abwG)
      const doc = s.kpis.opened_on ? daysBetween(s.kpis.opened_on, asOf) : null
      return {
        unit_id: String(s.unitId),
        unit_name: unitName(String(s.unitId)),
        batch_number: s.batchNumber,
        days_of_culture: doc,
        abw_g: s.kpis.current_abw_g,
        target_abw_now_g:
          doc == null || s.kpis.abw_measured_on == null
            ? null
            : targetAbw(
                s.kpis.initial_abw_g,
                target.abwG,
                target.days,
                daysBetween(s.kpis.opened_on!, s.kpis.abw_measured_on),
              ),
        harvest_abw_g: target.abwG,
        harvest_ready_on: f.harvest_ready_on,
        days_to_target: f.days_to_target,
        stats: s,
      }
    })

  const insights: Insight[] = [
    ...units.flatMap(unitInsights),
    ...forecasts.flatMap(forecastInsights),
  ]
  return { weeks, stats, units, forecasts, insights, target }
}

/** Up to 3 insights for the dashboard, most severe first. */
export const forDashboard = query({
  args: {
    /** Client's today. */
    asOf: v.string(),
    locationId: v.optional(v.id('farmLocations')),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      kind: v.union(
        v.literal('fcr_rising'),
        v.literal('mortality_spike'),
        v.literal('behind_target'),
        v.literal('harvest_ready'),
      ),
      severity: v.union(v.literal('info'), v.literal('warning'), v.literal('critical')),
      unit_id: v.string(),
      unit_name: v.string(),
      title: v.string(),
      detail: v.string(),
      facts: v.record(v.string(), v.union(v.string(), v.number(), v.null())),
    }),
  ),
  handler: async (ctx, args) => {
    assertDate(args.asOf)
    const { user } = await requireMember(ctx, { permission: 'reports.view' })
    if (tenantScope(user).kind !== 'company') return []
    const { insights } = await analyse(ctx, user, args.asOf, args.locationId)
    return rankInsights(insights, Math.max(1, Math.min(args.limit ?? 3, 10))).map(
      ({ score: _s, ...i }) => i,
    )
  },
})

/** The company's AI switch (same rule as reports.farmContextForAi). */
async function assertAiEnabled(ctx: QueryCtx, user: Doc<'users'>) {
  const role = user.role ?? 'user'
  if (role === 'super_admin' && !user.companyId) return
  if (!user.companyId) throw userError('FORBIDDEN', 'AI assistant is disabled (no company)')
  const company = await ctx.db.get(user.companyId)
  if (company?.settings?.aiAssistantEnabled !== true) {
    throw userError('FORBIDDEN', 'AI assistant is disabled by admin')
  }
}

/**
 * What the assistant may know, built on the server for the signed-in user:
 * open cycles with their KPIs and forecast, the farm's last N days of feed
 * and deaths, weekly FCR and mortality, the current insights and feed
 * stock. Read by pages/api/llm/chat.js with the user's own token.
 */
/** Open early-warning alerts (AI-001) the user may see, as assistant facts. */
async function earlyWarningsFor(
  ctx: QueryCtx,
  user: Doc<'users'>,
  locationId?: Id<'farmLocations'>,
) {
  if (!user.companyId) return []
  const m = await memberContextIn(ctx, user, user.companyId)
  if (!m || !can(m, 'production.view')) return []
  const lang = langOf(user.locale)
  const rows = await ctx.db
    .query('farmAlerts')
    .withIndex('by_companyId_and_status', (q) => q.eq('companyId', user.companyId!).eq('status', 'open'))
    .take(200)
  return rows
    .filter((a) => m.siteScope === 'all' || (!!a.locationId && m.siteScope.has(a.locationId)))
    .filter((a) => !locationId || a.locationId === locationId)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, 10)
    .map((a) => {
      const t = alertText(a, lang)
      return { title: `${a.severity === 'critical' ? '[critical] ' : ''}${t.title}`, detail: t.detail }
    })
}

/** Longest window the assistant reads (Ask Anowa date range: up to 90 days). */
export const MAX_DAYS = 90
/** Rows counted per table for the "Answers use …" strip; more shows as "N+". */
export const SOURCE_COUNT_CAP = 2000

function clampDays(days: number | undefined) {
  return Math.max(1, Math.min(Math.round(days ?? 14), MAX_DAYS))
}

/** Rollup rows at one site; a row without a site falls back to its unit's site. */
async function rowsAtSite<T extends { locationId?: Id<'farmLocations'>; unitId: Id<'cages'> }>(
  ctx: QueryCtx,
  rows: T[],
  site: Id<'farmLocations'> | undefined,
): Promise<T[]> {
  if (!site) return rows
  const unitSite = new Map<string, Id<'farmLocations'> | undefined>()
  const out: T[] = []
  for (const r of rows) {
    let at = r.locationId
    if (!at) {
      const key = String(r.unitId)
      if (!unitSite.has(key)) unitSite.set(key, (await ctx.db.get(r.unitId))?.locationId)
      at = unitSite.get(key)
    }
    if (at === site) out.push(r)
  }
  return out
}

/** Water-quality readings (manual, sensor, from records) in [from, to], site-scoped. */
async function waterReadings(
  ctx: QueryCtx,
  user: Doc<'users'>,
  from: string,
  to: string,
  site: Id<'farmLocations'> | undefined,
) {
  const scope = tenantScope(user)
  if (scope.kind !== 'company') return []
  // measuredAt is a timestamp; widen by a day each side, then keep the site-local dates.
  const lo = Date.parse(`${addDays(from, -1)}T00:00:00Z`)
  const hi = Date.parse(`${addDays(to, 2)}T00:00:00Z`)
  const rows = await ctx.db
    .query('waterQualityReadings')
    .withIndex('by_companyId_and_measuredAt', (q) =>
      q.eq('companyId', scope.companyId).gte('measuredAt', lo).lt('measuredAt', hi),
    )
    .order('desc')
    .take(SOURCE_COUNT_CAP)
  return inSiteScope(
    user,
    rows.filter((r) => r.date >= from && r.date <= to && (!site || r.locationId === site)),
  )
}

const waterSummary = v.object({
  readings: v.number(),
  avg_do_mg_l: v.union(v.number(), v.null()),
  min_do_mg_l: v.union(v.number(), v.null()),
  low_do_readings_below_4: v.number(),
  avg_temperature_c: v.union(v.number(), v.null()),
  readings_outside_thresholds: v.number(),
})
type WaterSummary = typeof waterSummary.type

async function waterSummaryFor(
  ctx: QueryCtx,
  user: Doc<'users'>,
  from: string,
  to: string,
  site: Id<'farmLocations'> | undefined,
): Promise<WaterSummary> {
  const rows = await waterReadings(ctx, user, from, to, site)
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null)
  const dos = rows.map((r) => r.dissolvedOxygen).filter((x): x is number => typeof x === 'number')
  const temps = rows.map((r) => r.temperatureC).filter((x): x is number => typeof x === 'number')
  return {
    readings: rows.length,
    avg_do_mg_l: avg(dos),
    min_do_mg_l: dos.length ? Math.min(...dos) : null,
    low_do_readings_below_4: dos.filter((d) => d < 4).length,
    avg_temperature_c: avg(temps),
    readings_outside_thresholds: rows.filter((r) => (r.breachCount ?? 0) > 0).length,
  }
}

const salesSummary = v.object({
  sales: v.number(),
  weight_kg: v.number(),
  amount: v.number(),
  unpaid_amount: v.number(),
})
type SalesSummary = typeof salesSummary.type

async function salesSummaryFor(
  ctx: QueryCtx,
  user: Doc<'users'>,
  from: string,
  to: string,
  site: Id<'farmLocations'> | undefined,
): Promise<SalesSummary> {
  const rows = await scopedRowsInRange(ctx, user, 'sales', { from, to, locationId: site, limit: SOURCE_COUNT_CAP })
  let weight = 0
  let amount = 0
  let unpaid = 0
  for (const r of rows) {
    weight += r.weightKg
    amount += r.totalAmount
    unpaid += Math.max(0, r.totalAmount - (r.amountPaid ?? (r.paymentStatus === 'paid' ? r.totalAmount : 0)))
  }
  return {
    sales: rows.length,
    weight_kg: round(weight, 1) ?? 0,
    amount: round(amount, 2) ?? 0,
    unpaid_amount: round(unpaid, 2) ?? 0,
  }
}

export const context = query({
  args: {
    asOf: v.string(),
    /** Days of daily totals, sales and water readings (default 14, at most MAX_DAYS). */
    days: v.optional(v.number()),
    /**
     * One site only (Ask Anowa site scope, artboard 47). Refused with
     * SITE_FORBIDDEN when the member's role does not cover the site.
     */
    locationId: v.optional(v.id('farmLocations')),
    /** Deep analysis: more insights and alerts in the context. */
    deep: v.optional(v.boolean()),
  },
  returns: v.record(
    v.string(),
    v.union(
      v.string(),
      v.array(
        v.object({
          unit: v.string(),
          batch: v.string(),
          stocked_on: v.union(v.string(), v.null()),
          days_of_culture: v.union(v.number(), v.null()),
          fish: v.number(),
          abw_g: v.union(v.number(), v.null()),
          abw_measured_on: v.union(v.string(), v.null()),
          biomass_kg: v.number(),
          feed_kg: v.number(),
          fcr: v.union(v.number(), v.null()),
          survival_pct: v.union(v.number(), v.null()),
          sgr_pct_day: v.union(v.number(), v.null()),
          target_abw_now_g: v.union(v.number(), v.null()),
          forecast_in_30_days: v.object({
            abw_g: v.union(v.number(), v.null()),
            biomass_kg: v.union(v.number(), v.null()),
          }),
          harvest_ready_on: v.union(v.string(), v.null()),
        }),
      ),
      v.array(v.object({ date: v.string(), feed_kg: v.number(), deaths: v.number() })),
      v.array(
        v.object({
          unit: v.string(),
          weeks: v.array(
            v.object({
              week_end: v.string(),
              feed_kg: v.number(),
              cycle_fcr: v.union(v.number(), v.null()),
              deaths: v.number(),
              mortality_pct: v.union(v.number(), v.null()),
            }),
          ),
        }),
      ),
      v.array(v.object({ title: v.string(), detail: v.string() })),
      v.array(v.object({ name: v.string(), stock_kg: v.number(), low: v.boolean() })),
      v.object({ harvest_abw_g: v.number(), days_of_culture: v.number() }),
      v.object({ site: v.string(), from: v.string(), to: v.string() }),
      salesSummary,
      waterSummary,
      v.null(),
    ),
  ),
  handler: async (ctx, args) => {
    assertDate(args.asOf)
    const m = await requireMember(ctx, { permission: 'ai.use', locationId: args.locationId })
    const { user } = m
    await assertAiEnabled(ctx, user)
    const scope = tenantScope(user)
    const days = clampDays(args.days)
    const site = args.locationId
    const a = await analyse(ctx, user, args.asOf, site)

    const from = addDays(args.asOf, -(days - 1))
    const dailyAll =
      scope.kind === 'company'
        ? await rollupRowsInSiteScope(
            ctx,
            user,
            await ctx.db
              .query('unitDailyStats')
              .withIndex('by_companyId_and_date', (q) =>
                q.eq('companyId', scope.companyId).gte('date', from).lte('date', args.asOf),
              )
              .take(5000),
          )
        : []
    const daily = await rowsAtSite(ctx, dailyAll, site)
    const byDate = new Map<string, { date: string; feed_kg: number; deaths: number }>()
    for (const r of daily) {
      const d = byDate.get(r.date) ?? { date: r.date, feed_kg: 0, deaths: 0 }
      d.feed_kg = round(d.feed_kg + r.feedKg, 1) ?? 0
      d.deaths += r.mortalityRecorded
      byDate.set(r.date, d)
    }
    const feedTypes = await scopedRows(ctx, user, 'feedTypes')
    const company = user.companyId ? await ctx.db.get(user.companyId) : null

    const siteDoc = site ? await ctx.db.get(site) : null
    const extras: Record<string, unknown> = {}
    if (can(m, 'production.view')) {
      extras.water_quality = await waterSummaryFor(ctx, user, from, args.asOf, site)
    }
    if (can(m, 'finance.view')) {
      extras.sales = await salesSummaryFor(ctx, user, from, args.asOf, site)
    }

    return {
      farm: company?.name ?? null,
      as_of: args.asOf,
      scope: { site: siteDoc?.name ?? 'All sites you can see', from: from, to: args.asOf },
      ...(extras as { water_quality?: WaterSummary; sales?: SalesSummary }),
      units_note: 'Open cycles; ABW in grams, biomass and feed in kg, FCR = feed / weight gained.',
      open_cycles: a.forecasts.map((f) => {
        const k = f.stats.kpis
        const fc = forecast(f.stats, addDays(args.asOf, 30), a.target.abwG)
        return {
          unit: f.unit_name,
          batch: f.batch_number,
          stocked_on: k.opened_on,
          days_of_culture: f.days_of_culture,
          fish: k.count,
          abw_g: k.current_abw_g,
          abw_measured_on: k.abw_measured_on,
          biomass_kg: k.current_biomass_kg,
          feed_kg: k.feed_kg,
          fcr: k.efcr,
          survival_pct: k.survival_pct,
          sgr_pct_day: k.sgr_pct_day,
          target_abw_now_g: round(f.target_abw_now_g, 0),
          forecast_in_30_days: {
            abw_g: fc.projected_abw_g,
            biomass_kg: fc.projected_biomass_kg,
          },
          harvest_ready_on: fc.harvest_ready_on,
        }
      }),
      target: { harvest_abw_g: a.target.abwG, days_of_culture: a.target.days },
      [`last_${days}_days`]: [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)),
      weekly: a.units.map((u) => ({
        unit: u.unit_name,
        weeks: u.series
          .filter((w) => w.units > 0)
          .map((w) => ({
            week_end: w.week_end,
            feed_kg: w.feed_kg,
            cycle_fcr: w.cycle_fcr,
            deaths: w.mortality,
            mortality_pct: w.mortality_pct,
          })),
      })),
      insights: rankInsights(a.insights, args.deep ? 25 : 10).map((i) => ({ title: i.title, detail: i.detail })),
      // Early-warning alerts (AI-001) open in the caller's sites.
      early_warnings: await earlyWarningsFor(ctx, user, site),
      feed_stock: feedTypes
        .filter((f) => f.active && !f.deletedAt)
        .map((f) => ({
          name: f.name,
          stock_kg: f.currentStock,
          low: f.currentStock <= f.minimumStock,
        })),
    }
  },
})


const sourceCount = v.union(v.null(), v.object({ count: v.number(), capped: v.boolean() }))

/**
 * What Ask Anowa's answers draw on (artboard 47 strip "Answers use …"): the
 * records in the chosen window and site that this member may see. Each count
 * reads at most SOURCE_COUNT_CAP rows (`capped` then says "N+"); a table the
 * role cannot see is null and left out of the strip.
 */
export const sources = query({
  args: {
    asOf: v.string(),
    days: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.object({
    from: v.string(),
    to: v.string(),
    dailyRecords: sourceCount,
    samplings: sourceCount,
    waterReadings: sourceCount,
    sales: sourceCount,
  }),
  handler: async (ctx, args) => {
    assertDate(args.asOf)
    const m = await requireMember(ctx, { permission: 'ai.use', locationId: args.locationId })
    const user = m.user
    const site = args.locationId
    const from = addDays(args.asOf, -(clampDays(args.days) - 1))
    const range = { from, to: args.asOf, locationId: site, limit: SOURCE_COUNT_CAP }
    const counted = (rows: unknown[], read = rows.length) => ({
      count: rows.length,
      capped: read >= SOURCE_COUNT_CAP,
    })
    const out = {
      from,
      to: args.asOf,
      dailyRecords: null as null | { count: number; capped: boolean },
      samplings: null as null | { count: number; capped: boolean },
      waterReadings: null as null | { count: number; capped: boolean },
      sales: null as null | { count: number; capped: boolean },
    }
    if (tenantScope(user).kind !== 'company') return out
    if (can(m, 'production.view')) {
      out.dailyRecords = counted(await scopedRowsInRange(ctx, user, 'dailyRecords', range))
      out.samplings = counted(await scopedRowsInRange(ctx, user, 'biweeklyRecords', range))
      out.waterReadings = counted(await waterReadings(ctx, user, from, args.asOf, site))
    }
    if (can(m, 'finance.view')) {
      out.sales = counted(await scopedRowsInRange(ctx, user, 'sales', range))
    }
    return out
  },
})
