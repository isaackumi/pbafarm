/**
 * Growth and harvest forecasting (AI-004). Pure and deterministic: no Convex
 * reads, no clock; "now" is `asOf`. The browser and tests share it.
 *
 * Model: thermal growth coefficient (TGC). Weight grows on the cube-root
 * scale in proportion to the water temperature:
 *
 *   W(t)^(1/3) = W(0)^(1/3) + TGC × Σ Teff / 1000
 *
 * where Teff is the day's temperature times the species' appetite factor at
 * that temperature (lib/ration, AI-002), so growth slows when the water is
 * too cold or too hot. The cycle's TGC is fitted to its own samples
 * (stocking weight, then each sampling) and shrunk towards the species
 * default, which is all there is before the first sample ("species curve").
 *
 * Feed cap: going forward the fish cannot grow faster than the feed they are
 * given allows. With the last 14 days' feeding rate r (kg feed per kg of fish
 * per day) and an FCR, a day's growth is at most W × r / FCR.
 *
 * Band: the posterior spread of the TGC (80 %: ±1.28 sd, at least ±5 %).
 * The high line also assumes a better FCR (×0.85) under the feed cap, so the
 * lines never cross: low ≤ expected ≤ high on every day.
 *
 * It is an estimate: the UI labels it so and says which inputs it used.
 */
import { temperatureFactor, temperatureGroup } from './ration'
import { biomassKg, dailyMortalityPct, daysBetween, projectCount, round } from './kpi'

export type DayValue = { date: string; value: number }
export type SpeciesPrior = {
  key?: string | null
  targetFcr?: number | null
  targetHarvestAbwG?: number | null
  expectedDailyGrowthG?: number | null
} | null

export type ForecastInput = {
  /** The day the forecast is made (client's today, or a past date for back-testing). */
  asOf: string
  /** First stock-in of the occupancy. */
  openedOn: string
  /** ABW at stocking (g), the first point of the fit. */
  initialAbwG: number | null
  /** Samples of this occupancy (any order; ones after asOf are ignored). */
  samples: Array<{ date: string; abwG: number }>
  /** Daily water temperature (°C), recorded or averaged from sensors. */
  temps: DayValue[]
  /** Daily feed given (kg). */
  feed: DayValue[]
  /** Live fish on asOf. */
  count: number
  /** Deaths in the 28 days to asOf. */
  deathsLast28: number
  /** Cycle eFCR so far. */
  efcr: number | null
  species: SpeciesPrior
  /** Days to project past the start point (default 365). */
  horizonDays?: number
}

export type BandPoint = { date: string; low: number; expected: number; high: number }

export type Forecast = {
  method: 'fitted' | 'species_curve'
  /** Points the fit used (stocking + samples). */
  points: number
  /** Fewer than 3 points: the fit leans on the species default. */
  fewSamples: boolean
  start: { date: string; abwG: number; measured: boolean }
  tgc: { low: number; expected: number; high: number; prior: number }
  temperature: { c: number; source: 'recorded' | 'default' }
  feed: { ratePctBw: number | null; fcr: number; fcrSource: 'cycle' | 'species' | 'default'; limited: boolean }
  dailyMortalityPct: number | null
  count: number
  /** Daily ABW from the start date, index 0 = start. */
  daily: { low: number[]; expected: number[]; high: number[] }
}

export const FORECAST = {
  /** Default water temperature when nothing is on record. */
  defaultTempC: { tilapia: 28, catfish: 27 },
  /** TGC defaults without species growth targets (×10⁻³ g^(1/3) per °C-day). */
  defaultTgc: { tilapia: 1.0, catfish: 1.6 },
  priorSdFraction: 0.5,
  /** Observation sd floor as a fraction of the interval TGCs' mean. */
  obsSdFloorFraction: 0.08,
  z80: 1.2816,
  minBandFraction: 0.05,
  feedWindowDays: 14,
  tempWindowDays: 14,
  minIntervalDays: 3,
  bestFcrFactor: 0.85,
  fcrRange: [0.8, 3.5] as const,
  defaultFcr: 1.6,
  horizonDays: 365,
} as const

const cbrt = Math.cbrt

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Growth-effective temperature: °C × appetite factor (0 when too cold to feed). */
export function effectiveTemp(speciesKey: string | null | undefined, tempC: number): number {
  return Math.max(0, tempC) * temperatureFactor(speciesKey, tempC)
}

/**
 * The species' TGC: from its growth target (expected g/day from half the
 * harvest weight to the harvest weight at the default temperature), else the
 * group default.
 */
export function priorTgc(species: SpeciesPrior): number {
  const group = temperatureGroup(species?.key)
  const target = species?.targetHarvestAbwG
  const adg = species?.expectedDailyGrowthG
  if (target && target > 0 && adg && adg > 0) {
    const w1 = target / 2
    const days = (target - w1) / adg
    const t = effectiveTemp(species?.key, FORECAST.defaultTempC[group])
    const tgc = (cbrt(target) - cbrt(w1)) / ((t * days) / 1000)
    if (Number.isFinite(tgc)) return Math.min(4, Math.max(0.2, tgc))
  }
  return FORECAST.defaultTgc[group]
}

/** TGC between two weights over a sum of effective degree-days. */
export function tgcBetween(w1: number, w2: number, degreeDays: number): number | null {
  if (!(w1 > 0) || !(w2 > 0) || !(degreeDays > 0)) return null
  return (cbrt(w2) - cbrt(w1)) / (degreeDays / 1000)
}

/** ABW after `degreeDays` effective °C-days at a TGC. */
export function abwAfter(w: number, tgc: number, degreeDays: number): number {
  const root = cbrt(w) + (tgc * degreeDays) / 1000
  return root > 0 ? root ** 3 : 0
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Temperature for each date: recorded, else `fill`. */
function tempLookup(temps: DayValue[], fill: number) {
  const byDate = new Map<string, number>()
  for (const t of temps) if (Number.isFinite(t.value)) byDate.set(t.date, t.value)
  return (date: string) => byDate.get(date) ?? fill
}

/**
 * Forecast for one occupancy, or null when there is no weight to start from.
 */
export function forecastGrowth(input: ForecastInput): Forecast | null {
  const species = input.species
  const key = species?.key ?? null
  const group = temperatureGroup(key)
  const horizon = Math.max(1, Math.min(input.horizonDays ?? FORECAST.horizonDays, 730))

  // Points: stocking weight, then samples (one per date, the last one wins).
  const byDate = new Map<string, number>()
  for (const s of input.samples) {
    if (s.date >= input.openedOn && s.date <= input.asOf && s.abwG > 0) byDate.set(s.date, s.abwG)
  }
  const points: Array<{ date: string; abwG: number; measured: boolean }> = []
  if (input.initialAbwG && input.initialAbwG > 0 && !byDate.has(input.openedOn)) {
    points.push({ date: input.openedOn, abwG: input.initialAbwG, measured: false })
  }
  for (const [date, abwG] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    points.push({ date, abwG, measured: true })
  }
  if (!points.length) return null

  // Temperatures: recorded in the cycle, filled with their mean or the default.
  const recorded = input.temps.filter((t) => t.date >= input.openedOn && t.date <= input.asOf && Number.isFinite(t.value))
  const recent = recorded.filter((t) => t.date > addDays(input.asOf, -FORECAST.tempWindowDays))
  const fill = mean(recorded.map((t) => t.value))
  const projTemp = mean(recent.map((t) => t.value)) ?? fill
  const tempSource: 'recorded' | 'default' = projTemp == null ? 'default' : 'recorded'
  const projC = projTemp ?? FORECAST.defaultTempC[group]
  const pastTemp = tempLookup(recorded, fill ?? FORECAST.defaultTempC[group])

  // Interval TGCs between consecutive points.
  const intervals: Array<{ tgc: number; weight: number }> = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const days = daysBetween(a.date, b.date)
    if (days < FORECAST.minIntervalDays) continue
    let dd = 0
    for (let d = 0; d < days; d++) dd += effectiveTemp(key, pastTemp(addDays(a.date, d)))
    const tgc = tgcBetween(a.abwG, b.abwG, dd)
    if (tgc != null && Number.isFinite(tgc)) intervals.push({ tgc, weight: Math.min(days / 14, 3) })
  }

  // Posterior TGC (normal prior × normal observations).
  const prior = priorTgc(species)
  const priorSd = prior * FORECAST.priorSdFraction
  let expected = prior
  let sd = priorSd
  if (intervals.length) {
    const xs = intervals.map((i) => i.tgc)
    const m = Math.abs(mean(xs)!) || prior
    const spread =
      xs.length >= 2 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)!) ** 2, 0) / (xs.length - 1)) : 0
    const obsSd = Math.max(spread, m * FORECAST.obsSdFloorFraction)
    const priorPrec = 1 / priorSd ** 2
    const obsPrec = intervals.reduce((s, i) => s + i.weight, 0) / obsSd ** 2
    expected = (prior * priorPrec + (intervals.reduce((s, i) => s + i.weight * i.tgc, 0) / obsSd ** 2)) / (priorPrec + obsPrec)
    sd = 1 / Math.sqrt(priorPrec + obsPrec)
  }
  expected = Math.max(expected, prior * 0.05)
  const half = Math.max(FORECAST.z80 * sd, expected * FORECAST.minBandFraction)
  const tgc = {
    low: Math.max(expected - half, expected * 0.1),
    expected,
    high: expected + half,
    prior,
  }

  const start = points[points.length - 1]

  // Feed cap from the last 14 days' feeding rate.
  const feedFrom = addDays(input.asOf, -FORECAST.feedWindowDays)
  const feedRows = input.feed.filter((f) => f.date > feedFrom && f.date <= input.asOf && f.value >= 0)
  const startBiomass = biomassKg(Math.max(0, input.count), start.abwG)
  const rate =
    feedRows.length && startBiomass > 0
      ? feedRows.reduce((s, f) => s + f.value, 0) / FORECAST.feedWindowDays / startBiomass
      : null
  const [fMin, fMax] = FORECAST.fcrRange
  const fcrSource: 'cycle' | 'species' | 'default' =
    input.efcr != null && input.efcr >= fMin && input.efcr <= fMax
      ? 'cycle'
      : species?.targetFcr && species.targetFcr > 0
        ? 'species'
        : 'default'
  const fcr =
    fcrSource === 'cycle' ? input.efcr! : fcrSource === 'species' ? species!.targetFcr! : FORECAST.defaultFcr

  // Daily simulation from the start point. Past days (to asOf) use recorded
  // temperatures; future days the recent mean.
  const days = daysBetween(start.date, input.asOf) + horizon
  const run = (k: number, capFcr: number | null) => {
    const out = [start.abwG]
    let w = start.abwG
    let limited = false
    for (let d = 0; d < days; d++) {
      const date = addDays(start.date, d)
      const t = date <= input.asOf ? pastTemp(date) : projC
      let next = abwAfter(w, k, effectiveTemp(key, t))
      if (rate != null && capFcr != null && date >= input.asOf) {
        const cap = w * (1 + rate / capFcr)
        if (next > cap) {
          next = cap
          limited = true
        }
      }
      w = next
      out.push(w)
    }
    return { out, limited }
  }
  const low = run(tgc.low, fcr)
  const exp = run(tgc.expected, fcr)
  const high = run(tgc.high, fcr * FORECAST.bestFcrFactor)

  const deaths = Math.max(0, input.deathsLast28)
  return {
    method: intervals.length ? 'fitted' : 'species_curve',
    points: points.length,
    fewSamples: points.length < 3,
    start: { date: start.date, abwG: start.abwG, measured: start.measured },
    tgc: {
      low: round(tgc.low, 3)!,
      expected: round(tgc.expected, 3)!,
      high: round(tgc.high, 3)!,
      prior: round(prior, 3)!,
    },
    temperature: { c: round(projC, 1)!, source: tempSource },
    feed: { ratePctBw: rate == null ? null : round(rate * 100, 2), fcr: round(fcr, 2)!, fcrSource, limited: exp.limited },
    dailyMortalityPct: round(dailyMortalityPct(deaths / 28, Math.max(0, input.count) + deaths), 3),
    count: Math.max(0, input.count),
    daily: { low: low.out, expected: exp.out, high: high.out },
  }
}

/** ABW band on a date (null outside the simulated range). */
export function bandOn(f: Forecast, date: string): BandPoint | null {
  const i = daysBetween(f.start.date, date)
  if (i < 0 || i >= f.daily.expected.length) return null
  return {
    date,
    low: round(f.daily.low[i], 1)!,
    expected: round(f.daily.expected[i], 1)!,
    high: round(f.daily.high[i], 1)!,
  }
}

/** Weekly band points from `from` (default the start) for `weeks` weeks. */
export function bandSeries(f: Forecast, from: string, weeks: number): BandPoint[] {
  const out: BandPoint[] = []
  const first = from < f.start.date ? f.start.date : from
  for (let w = 0; w <= weeks; w++) {
    const p = bandOn(f, addDays(first, w * 7))
    if (p) out.push(p)
  }
  return out
}

const firstDayAtLeast = (xs: number[], target: number) => {
  for (let i = 0; i < xs.length; i++) if (xs[i] >= target) return i
  return null
}

export type HarvestPlan = {
  targetG: number
  /** Already at or above the target on asOf (expected line). */
  ready: boolean
  /** Earliest (high line), expected and latest (low line) date to reach it; null past the horizon. */
  earliest: string | null
  expected: string | null
  latest: string | null
  /** Fish and biomass on the expected date (mortality trend). */
  expectedCount: number | null
  expectedBiomassKg: number | null
  biomassLowKg: number | null
  biomassHighKg: number | null
}

/**
 * When the occupancy reaches `targetG`, and what it would weigh in then: the
 * fish left after the recent mortality trend times the target weight.
 * Biomass low/high: the count at the latest/earliest date times the target.
 */
export function harvestPlan(f: Forecast, asOf: string, targetG: number): HarvestPlan {
  const offset = Math.max(0, daysBetween(f.start.date, asOf))
  const at = (line: number[]) => {
    const i = firstDayAtLeast(line, targetG)
    if (i == null) return null
    return addDays(f.start.date, Math.max(i, offset))
  }
  const earliest = at(f.daily.high)
  const expected = at(f.daily.expected)
  const latest = at(f.daily.low)
  const countOn = (date: string | null) =>
    date == null ? null : projectCount(f.count, f.dailyMortalityPct, daysBetween(asOf, date))
  const bio = (date: string | null) => {
    const c = countOn(date)
    if (c == null || date == null) return null
    const w = bandOn(f, date)?.expected ?? targetG
    return round(biomassKg(c, Math.max(w, targetG)), 0)
  }
  const expectedCount = countOn(expected)
  return {
    targetG,
    ready: expected != null && expected === asOf && (f.daily.expected[offset] ?? 0) >= targetG,
    earliest,
    expected,
    latest,
    expectedCount,
    expectedBiomassKg: bio(expected),
    biomassLowKg: latest ? round(biomassKg(countOn(latest)!, targetG), 0) : null,
    biomassHighKg: earliest ? round(biomassKg(countOn(earliest)!, targetG), 0) : null,
  }
}

/**
 * Forecast error of a harvest (AI-004 acceptance): (predicted − actual) /
 * actual, in %, and whether the actual weight fell inside the band.
 */
export function forecastError(predicted: BandPoint, actualAbwG: number) {
  if (!(actualAbwG > 0)) return null
  const errorPct = ((predicted.expected - actualAbwG) / actualAbwG) * 100
  return {
    errorPct: round(errorPct, 1)!,
    absErrorPct: round(Math.abs(errorPct), 1)!,
    withinBand: actualAbwG >= predicted.low && actualAbwG <= predicted.high,
  }
}

/** Mean absolute % error, bias and band hit rate over tracked harvests. */
export function accuracySummary(rows: Array<{ errorPct: number; withinBand: boolean }>) {
  if (!rows.length) return { n: 0, mapePct: null, biasPct: null, withinBandPct: null }
  const n = rows.length
  return {
    n,
    mapePct: round(rows.reduce((s, r) => s + Math.abs(r.errorPct), 0) / n, 1),
    biasPct: round(rows.reduce((s, r) => s + r.errorPct, 0) / n, 1),
    withinBandPct: round((rows.filter((r) => r.withinBand).length / n) * 100, 0),
  }
}
