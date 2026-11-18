/**
 * Grounded dashboard insights (Phase 13). Deterministic rules over the
 * rollup figures (weekly series and forecasts from lib/analytics): the facts
 * and the sentence are computed here; an LLM may only rephrase them, never
 * add numbers (pages/api/llm/insights.js).
 */
import { mean, round } from './kpi'

export type WeekPoint = {
  week_end: string
  units: number
  cycle_fcr: number | null
  mortality: number
  mortality_pct: number | null
}

export type UnitSeries = { unit_id: string; unit_name: string; series: WeekPoint[] }

export type UnitForecast = {
  unit_id: string
  unit_name: string
  days_of_culture: number | null
  abw_g: number | null
  target_abw_now_g: number | null
  harvest_abw_g: number
  harvest_ready_on: string | null
  days_to_target: number | null
}

export type Insight = {
  id: string
  kind: 'fcr_rising' | 'mortality_spike' | 'behind_target' | 'harvest_ready'
  severity: 'critical' | 'warning' | 'info'
  unit_id: string
  unit_name: string
  title: string
  detail: string
  /** The numbers behind the sentence (also what a model may rephrase). */
  facts: Record<string, string | number | null>
  /** For ordering within a severity: bigger first. */
  score: number
}

/** Rules' thresholds; exported for tests and the PR description. */
export const RULES = {
  fcrRisingWeeks: 3,
  /** Last week's mortality % must be at least this… */
  spikeMinPct: 0.5,
  /** …and this many times the mean of the 3 weeks before. */
  spikeFactor: 2,
  spikeCriticalPct: 2,
  harvestWithinDays: 21,
  /** ABW below this share of the target curve is "behind". */
  behindShare: 0.8,
}

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}

/** Consecutive week-on-week rises of cycle-to-date FCR ending at the last week. */
export function fcrRises(series: WeekPoint[]): number {
  let rises = 0
  for (let i = series.length - 1; i > 0; i--) {
    const now = series[i].cycle_fcr
    const before = series[i - 1].cycle_fcr
    if (now == null || before == null || !(now > before)) break
    rises++
  }
  return rises
}

export function unitInsights(u: UnitSeries): Insight[] {
  const out: Insight[] = []
  const s = u.series
  const last = s[s.length - 1]
  if (!last) return out

  const rises = fcrRises(s)
  if (rises >= RULES.fcrRisingWeeks) {
    const from = s[s.length - 1 - rises]
    out.push({
      id: `fcr_rising:${u.unit_id}`,
      kind: 'fcr_rising',
      severity: 'warning',
      unit_id: u.unit_id,
      unit_name: u.unit_name,
      title: `${u.unit_name} FCR rising ${rises} weeks in a row`,
      detail: `Cycle-to-date FCR went from ${from.cycle_fcr!.toFixed(2)} to ${last.cycle_fcr!.toFixed(2)} between the weeks ending ${shortDate(from.week_end)} and ${shortDate(last.week_end)}. Check feeding rates and the latest sample.`,
      facts: {
        weeks: rises,
        fcr_from: from.cycle_fcr,
        fcr_to: last.cycle_fcr,
        week_from: from.week_end,
        week_to: last.week_end,
      },
      score: (last.cycle_fcr ?? 0) - (from.cycle_fcr ?? 0),
    })
  }

  const before = s.slice(-4, -1).filter((w) => w.units > 0)
  const baseline = mean(before.map((w) => w.mortality_pct))
  const pct = last.mortality_pct
  if (
    last.units > 0 &&
    pct != null &&
    pct >= RULES.spikeMinPct &&
    pct >= RULES.spikeFactor * (baseline ?? 0)
  ) {
    out.push({
      id: `mortality_spike:${u.unit_id}`,
      kind: 'mortality_spike',
      severity: pct >= RULES.spikeCriticalPct ? 'critical' : 'warning',
      unit_id: u.unit_id,
      unit_name: u.unit_name,
      title: `${u.unit_name} deaths up in the week ending ${shortDate(last.week_end)}`,
      detail: `${last.mortality} deaths (${pct.toFixed(2)}% of the fish) against ${
        baseline == null ? 'no deaths' : `${baseline.toFixed(2)}% a week`
      } over the 3 weeks before. Check water quality and the mortality causes logged.`,
      facts: {
        deaths: last.mortality,
        mortality_pct: round(pct, 2),
        baseline_pct: round(baseline, 2),
        week: last.week_end,
      },
      score: pct,
    })
  }
  return out
}

export function forecastInsights(f: UnitForecast): Insight[] {
  const out: Insight[] = []
  if (f.harvest_ready_on && f.days_to_target != null && f.days_to_target <= RULES.harvestWithinDays) {
    out.push({
      id: `harvest_ready:${f.unit_id}`,
      kind: 'harvest_ready',
      severity: 'info',
      unit_id: f.unit_id,
      unit_name: f.unit_name,
      title:
        f.days_to_target === 0
          ? `${f.unit_name} has reached ${f.harvest_abw_g} g`
          : `${f.unit_name} reaches ${f.harvest_abw_g} g around ${shortDate(f.harvest_ready_on)}`,
      detail: `Projected from its recent growth rate (ABW now ${f.abw_g ?? '—'} g). Plan the harvest and buyers.`,
      facts: {
        harvest_abw_g: f.harvest_abw_g,
        ready_on: f.harvest_ready_on,
        days: f.days_to_target,
        abw_g: f.abw_g,
      },
      score: RULES.harvestWithinDays - f.days_to_target,
    })
  }
  if (
    f.abw_g != null &&
    f.target_abw_now_g != null &&
    f.target_abw_now_g > 0 &&
    f.abw_g < RULES.behindShare * f.target_abw_now_g
  ) {
    const share = f.abw_g / f.target_abw_now_g
    out.push({
      id: `behind_target:${f.unit_id}`,
      kind: 'behind_target',
      severity: 'warning',
      unit_id: f.unit_id,
      unit_name: f.unit_name,
      title: `${f.unit_name} is ${Math.round((1 - share) * 100)}% behind the growth target`,
      detail: `ABW ${f.abw_g} g at day ${f.days_of_culture ?? '—'} against a target of ${Math.round(f.target_abw_now_g)} g. A fresh sample confirms whether growth has slowed.`,
      facts: {
        abw_g: f.abw_g,
        target_g: round(f.target_abw_now_g, 0),
        day: f.days_of_culture,
      },
      score: 1 - share,
    })
  }
  return out
}

const RANK = { critical: 0, warning: 1, info: 2 } as const

/** Every insight, most severe first; `limit` keeps the top ones. */
export function rankInsights(all: Insight[], limit = 3): Insight[] {
  return [...all]
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}
