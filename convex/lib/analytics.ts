/**
 * Analytics over the rollups (ANLY-002..004). Pure functions over batchStats
 * rows: no Convex reads, no clock, no formulas of their own. Every KPI comes
 * from lib/kpi, every cost from lib/costing.
 *
 * A period [from, to] is the difference of two weekly snapshots of each
 * occupancy (the last one on or before `to`, and the last one before
 * `from`), so periods align to weeks (Monday to Sunday) except at the ends of
 * a cycle and at its as-of date.
 */
import type { Doc } from '../_generated/dataModel'
import {
  biomassKg,
  dailyMortalityPct,
  daysBetween,
  daysToReach,
  efcr,
  mean,
  periodMortalityPct,
  pooledFcr,
  projectAbw,
  projectCount,
  round,
  sgr,
  survivalPct,
} from './kpi'
import { summarizeCost } from './costing'
import { addDays } from './dates'

export type Stats = Doc<'batchStats'>
export type Snap = Stats['weekly'][number]

const isSunday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0

/** The `n` Sundays ending on the last Sunday on or before `to`, oldest first. */
export function weekEnds(to: string, n: number): string[] {
  let d = to
  while (!isSunday(d)) d = addDays(d, -1)
  const out: string[] = []
  for (let i = 0; i < n; i++) out.unshift(addDays(d, -7 * i))
  return out
}

/** The occupancy's state at the end of `date`: its last snapshot on or before it. */
export function snapAt(s: Stats, date: string): Snap | null {
  let found: Snap | null = null
  for (const w of s.weekly) {
    if (w.date <= date) found = w
    else break
  }
  return found
}

/** Whether the occupancy had fish at some point of the week ending `weekEnd`. */
export function liveInWeek(s: Stats, weekEnd: string) {
  const opened = s.kpis.opened_on
  if (!opened || opened > weekEnd) return false
  return s.open || s.lastDate >= addDays(weekEnd, -6)
}

export type Period = {
  stats: Stats
  start: Snap | null
  end: Snap
  feedKg: number
  feedCost: number
  gainKg: number
  harvestedKg: number
  harvestedCount: number
  outCount: number
  inCount: number
  stockedCount: number
  mortality: number
  startCount: number
  sgr: number | null
}

const delta = (end: Snap, start: Snap | null, k: keyof Snap) =>
  (end[k] as number) - ((start?.[k] as number | undefined) ?? 0)

/** One occupancy's figures for [from, to]; null when it had no fish then. */
export function periodOf(s: Stats, from: string, to: string): Period | null {
  const end = snapAt(s, to)
  if (!end || !s.kpis.opened_on || s.kpis.opened_on > to) return null
  if (!s.open && s.lastDate < from) return null
  const start = snapAt(s, addDays(from, -1))
  const startAbw = start?.abwG ?? s.kpis.initial_abw_g
  const startDate = start?.date ?? s.kpis.opened_on
  return {
    stats: s,
    start,
    end,
    feedKg: delta(end, start, 'feedKg'),
    feedCost: delta(end, start, 'feedCost'),
    gainKg: delta(end, start, 'gainKg'),
    harvestedKg: delta(end, start, 'harvestedKg'),
    harvestedCount: delta(end, start, 'harvestedCount'),
    outCount: delta(end, start, 'outCount'),
    inCount: delta(end, start, 'inCount'),
    stockedCount: delta(end, start, 'stockedCount'),
    mortality: delta(end, start, 'mortality'),
    startCount: start?.count ?? 0,
    sgr: sgr(startAbw ?? 0, end.abwG ?? 0, daysBetween(startDate, end.date)),
  }
}

export type CostInputs = {
  fingerlingCost: number
  otherExpenses: number
  revenue: number
  soldKg: number
}

export const noCosts = (): CostInputs => ({
  fingerlingCost: 0,
  otherExpenses: 0,
  revenue: 0,
  soldKg: 0,
})

/** KPIs of a group of occupancy periods (a unit, a site, the farm). */
export function groupKpis(periods: Period[], costs: CostInputs = noCosts()) {
  const sum = (f: (p: Period) => number) => periods.reduce((t, p) => t + f(p), 0)
  const feedKg = sum((p) => p.feedKg)
  const gainKg = sum((p) => p.gainKg)
  const feedCost = sum((p) => p.feedCost)
  const harvestedKg = sum((p) => p.harvestedKg)
  const deaths = sum((p) => p.mortality)
  const fishEnd = sum((p) => Math.max(0, p.end.count))
  const cost = summarizeCost({
    feedCost,
    fingerlingCost: costs.fingerlingCost,
    otherExpenses: costs.otherExpenses,
    revenue: costs.revenue,
    harvestKg: harvestedKg,
    soldKg: costs.soldKg,
  })
  // Same totals over kg produced (gain), for units still growing out.
  const produced = summarizeCost({
    feedCost,
    fingerlingCost: costs.fingerlingCost,
    otherExpenses: costs.otherExpenses,
    revenue: costs.revenue,
    harvestKg: gainKg,
    soldKg: 0,
  })
  return {
    occupancies: periods.length,
    fish_end: fishEnd,
    biomass_kg: round(sum((p) => p.end.biomassKg), 1) ?? 0,
    feed_kg: round(feedKg, 1) ?? 0,
    gain_kg: round(gainKg, 1) ?? 0,
    harvested_kg: round(harvestedKg, 1) ?? 0,
    mortality: deaths,
    fcr: round(efcr(feedKg, gainKg), 2),
    survival_pct: round(
      survivalPct({
        count: sum((p) => p.end.count),
        harvestedCount: sum((p) => p.harvestedCount),
        outCount: sum((p) => p.outCount),
        stockedCount: sum((p) => p.startCount + p.stockedCount),
        inCount: sum((p) => p.inCount),
      }),
      1,
    ),
    mortality_pct: round(periodMortalityPct(deaths, fishEnd), 2),
    sgr_pct_day: round(mean(periods.map((p) => p.sgr)), 2),
    feed_cost: round(feedCost, 2) ?? 0,
    fingerling_cost: costs.fingerlingCost,
    other_cost: costs.otherExpenses,
    revenue: costs.revenue,
    total_cost: round(cost.total_cost, 2) ?? 0,
    cost_per_kg: round(cost.cost_per_kg, 2),
    cost_per_kg_produced: round(produced.cost_per_kg, 2),
    net_margin: round(cost.net_margin, 2) ?? 0,
    net_margin_pct: round(cost.net_margin_pct, 1),
  }
}

export type GroupKpis = ReturnType<typeof groupKpis>

/** Week by week figures of a group of occupancies over `weeks` (Sundays). */
export function weeklySeries(stats: Stats[], weeks: string[]) {
  return weeks.map((w) => {
    const prev = addDays(w, -7)
    const live = stats.filter((s) => liveInWeek(s, w))
    let feed = 0
    let gain = 0
    let deaths = 0
    let count = 0
    const cumulative: Array<{ feedKg: number; gainKg: number }> = []
    for (const s of live) {
      const end = snapAt(s, w)
      if (!end) continue
      const start = snapAt(s, prev)
      feed += delta(end, start, 'feedKg')
      gain += delta(end, start, 'gainKg')
      deaths += delta(end, start, 'mortality')
      count += Math.max(0, end.count)
      cumulative.push({ feedKg: end.feedKg, gainKg: end.gainKg })
    }
    return {
      week_end: w,
      units: live.length,
      feed_kg: round(feed, 1) ?? 0,
      gain_kg: round(gain, 1) ?? 0,
      week_fcr: round(efcr(feed, gain), 2),
      cycle_fcr: round(pooledFcr(cumulative), 2),
      mortality: deaths,
      mortality_pct: round(periodMortalityPct(deaths, count), 2),
    }
  })
}

/** Target ABW `doc` days into a cycle: constant SGR from the stocking ABW to the target. */
export function targetAbw(initialAbwG: number | null, targetG: number, targetDays: number, doc: number) {
  if (!initialAbwG) return null
  const rate = sgr(initialAbwG, targetG, targetDays)
  return rate == null ? null : projectAbw(initialAbwG, rate, doc)
}

/** Growth curve of an occupancy: ABW at each snapshot and the target curve. */
export function growthCurve(s: Stats, target: { abwG: number; days: number }) {
  const opened = s.kpis.opened_on
  return s.weekly.map((w) => {
    const doc = opened ? daysBetween(opened, w.date) : null
    return {
      date: w.date,
      doc,
      abw_g: w.abwG,
      target_g: doc == null ? null : round(targetAbw(s.kpis.initial_abw_g, target.abwG, target.days, doc), 1),
    }
  })
}

/**
 * Forecast of an open occupancy: ABW and biomass at `at` from the recent SGR
 * (last two samples, else the cycle's), deaths at the last 28 days' rate,
 * and the date the target ABW is reached.
 */
export function forecast(s: Stats, at: string, targetAbwG: number) {
  const k = s.kpis
  const abw = k.current_abw_g
  const from = k.abw_measured_on ?? s.asOf
  const rate = s.recentSgr ?? k.sgr_pct_day
  const days = daysBetween(from, at)
  const projected = abw != null && rate != null ? projectAbw(abw, rate, days) : null
  // Deaths per day as a % of the fish there 28 days ago (today's fish + those deaths).
  const daily = dailyMortalityPct(s.recentMortality / 28, Math.max(0, k.count) + s.recentMortality)
  const countAt = projectCount(Math.max(0, k.count), daily, daysBetween(s.asOf, at))
  const toTarget = abw != null && rate != null ? daysToReach(abw, targetAbwG, rate) : null
  return {
    abw_g: abw,
    abw_date: from,
    sgr_pct_day: round(rate, 2),
    sgr_source: s.recentSgr != null ? ('recent samples' as const) : ('cycle' as const),
    daily_mortality_pct: round(daily, 3),
    projected_abw_g: round(projected, 1),
    projected_count: countAt,
    projected_biomass_kg: projected == null ? null : round(biomassKg(countAt, projected), 0),
    harvest_ready_on: toTarget == null ? null : addDays(from, toTarget),
    days_to_target: toTarget == null ? null : Math.max(0, toTarget - daysBetween(from, s.asOf)),
  }
}
