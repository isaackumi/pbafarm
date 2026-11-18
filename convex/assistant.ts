import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { requireUser } from './lib/authz'
import { scopedRows, tenantScope } from './lib/scope'
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

/**
 * Grounded insights and the assistant's context (Phase 13, ANLY-005), both
 * from the rollups, both scoped to the caller's company. The assistant never
 * gets more than these queries return to the same user.
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
  handler: async (ctx, args) => {
    assertDate(args.asOf)
    const user = await requireUser(ctx)
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
export const context = query({
  args: {
    asOf: v.string(),
    /** Days of daily totals (default 14, at most 30). */
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertDate(args.asOf)
    const user = await requireUser(ctx)
    await assertAiEnabled(ctx, user)
    const scope = tenantScope(user)
    const days = Math.max(1, Math.min(args.days ?? 14, 30))
    const a = await analyse(ctx, user, args.asOf)

    const from = addDays(args.asOf, -(days - 1))
    const daily =
      scope.kind === 'company'
        ? await ctx.db
            .query('unitDailyStats')
            .withIndex('by_companyId_and_date', (q) =>
              q.eq('companyId', scope.companyId).gte('date', from).lte('date', args.asOf),
            )
            .take(5000)
        : []
    const byDate = new Map<string, { date: string; feed_kg: number; deaths: number }>()
    for (const r of daily) {
      const d = byDate.get(r.date) ?? { date: r.date, feed_kg: 0, deaths: 0 }
      d.feed_kg = round(d.feed_kg + r.feedKg, 1) ?? 0
      d.deaths += r.mortalityRecorded
      byDate.set(r.date, d)
    }
    const feedTypes = await scopedRows(ctx, user, 'feedTypes')
    const company = user.companyId ? await ctx.db.get(user.companyId) : null

    return {
      farm: company?.name ?? null,
      as_of: args.asOf,
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
      insights: rankInsights(a.insights, 10).map((i) => ({ title: i.title, detail: i.detail })),
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
