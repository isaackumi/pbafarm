/**
 * Cycle planner (what if): from a stocking plan and a few assumptions, when
 * the fish reach harvest weight, how much they weigh in, the feed to buy, the
 * cash the cycle needs before the sale, and the margin before labour.
 *
 * Pure and deterministic: no Convex imports and no clock, so the planner page
 * recomputes live in the browser from the same functions the server and the
 * tests use.
 *
 * Model
 * - Growth: thermal growth coefficient (lib/growthForecast `abwAfter`), one
 *   day at a time, with the site's mean water temperature for each calendar
 *   month (or one temperature for the whole cycle) times the species'
 *   appetite factor (lib/ration).
 * - Survival: the cycle survival is spread as a constant daily hazard,
 *   h = 1 − S^(1/days), so the count falls smoothly to N₀ × S on harvest day.
 * - Feed: the cycle total is the economic FCR times the net gain
 *   (harvested kg − stocked kg). It is spread over the days in proportion to
 *   the day's ration from the species' feed table (biomass × % body weight ×
 *   appetite), so small fish eat little and the last months carry the bulk.
 * - Money: fingerlings are paid on stocking day, feed as it is fed (whole
 *   bags in the totals), and the sale comes in on harvest day. Cash needed is
 *   the deepest point of that curve; margin is sales − feed − fingerlings,
 *   before labour and other expenses.
 */
import { abwAfter, effectiveTemp, priorTgc, FORECAST, type SpeciesPrior } from './growthForecast'
import { DEFAULT_FEED_TABLES, bandFor, temperatureFactor, temperatureGroup, type FeedBand } from './ration'

export const PLAN_LIMITS = {
  maxUnits: 50,
  maxFishPerUnit: 5_000_000,
  maxAbwG: 5_000,
  maxDays: 730,
  maxPrice: 10_000_000,
  maxPlansCompared: 4,
  nameLength: 80,
} as const

/** Used when an organization has no closed cycle to learn from. */
export const PLAN_DEFAULTS = {
  survivalPct: 85,
  bagKg: 25,
} as const

export type PlanInputs = {
  /** Stocking date, YYYY-MM-DD. */
  stockOn: string
  units: number
  fishPerUnit: number
  /** ABW of the fingerlings at stocking (g). */
  stockAbwG: number
  /** Target harvest weight (g). */
  harvestAbwG: number
  feedPricePerBag: number
  bagKg: number
  salePricePerKg: number
  /** Price of one fingerling. */
  fingerlingPrice: number
}

export type PlanAssumptions = {
  speciesKey: string | null
  /** Cycle survival, %. */
  survivalPct: number
  /** Economic FCR: feed ÷ net gain. */
  fcr: number
  /** Thermal growth coefficient (×10⁻³ g^(1/3) per °C-day). */
  tgc: number
  /** Water temperature when no month has a mean (°C). */
  tempC: number
  /** Mean water temperature per calendar month, Jan..Dec; null = use tempC. */
  monthlyTempC?: Array<number | null> | null
}

export type PlanMonth = {
  /** YYYY-MM */
  month: string
  feedKg: number
  /** ABW at the end of the month, or on harvest day in the harvest month (g). */
  abwG: number
  fish: number
  /** Cash out that month (fingerlings + feed); the sale is not netted in. */
  cashOut: number
  harvest: boolean
}

export type PlanResult = {
  /** False when the fish never reach the harvest weight within PLAN_LIMITS.maxDays. */
  reached: boolean
  days: number
  harvestDate: string
  fish: number
  harvestKg: number
  stockedFish: number
  stockedKg: number
  feedKg: number
  bags: number
  feedCost: number
  fingerlingCost: number
  /** Deepest point of the cash curve (a positive amount). */
  cashNeeded: number
  /** Date of that point: the day before the sale. */
  cashLowOn: string
  sales: number
  margin: number
  /** margin ÷ sales, %; null without sales. */
  marginPct: number | null
  months: PlanMonth[]
  /** ABW at the start of the cycle and at each month end (chart line). */
  curve: Array<{ date: string; abwG: number }>
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const finite = (x: number) => Number.isFinite(x)

/** Problems with a plan's inputs and assumptions, as message keys; [] when valid. */
export function planProblems(i: PlanInputs, a: PlanAssumptions): string[] {
  const out: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.stockOn) || Number.isNaN(Date.parse(`${i.stockOn}T12:00:00Z`))) out.push('stockOn')
  if (!Number.isInteger(i.units) || i.units < 1 || i.units > PLAN_LIMITS.maxUnits) out.push('units')
  if (!Number.isInteger(i.fishPerUnit) || i.fishPerUnit < 1 || i.fishPerUnit > PLAN_LIMITS.maxFishPerUnit) out.push('fishPerUnit')
  if (!finite(i.stockAbwG) || i.stockAbwG <= 0 || i.stockAbwG > PLAN_LIMITS.maxAbwG) out.push('stockAbwG')
  if (!finite(i.harvestAbwG) || i.harvestAbwG <= i.stockAbwG || i.harvestAbwG > PLAN_LIMITS.maxAbwG) out.push('harvestAbwG')
  if (!finite(i.bagKg) || i.bagKg <= 0 || i.bagKg > 1000) out.push('bagKg')
  for (const k of ['feedPricePerBag', 'salePricePerKg', 'fingerlingPrice'] as const) {
    if (!finite(i[k]) || i[k] < 0 || i[k] > PLAN_LIMITS.maxPrice) out.push(k)
  }
  if (!finite(a.survivalPct) || a.survivalPct <= 0 || a.survivalPct > 100) out.push('survivalPct')
  if (!finite(a.fcr) || a.fcr < 0.5 || a.fcr > 5) out.push('fcr')
  if (!finite(a.tgc) || a.tgc <= 0 || a.tgc > 5) out.push('tgc')
  if (!finite(a.tempC) || a.tempC < 0 || a.tempC > 40) out.push('tempC')
  if (a.monthlyTempC && (a.monthlyTempC.length !== 12 || a.monthlyTempC.some((t) => t != null && (!finite(t) || t < 0 || t > 40)))) {
    out.push('monthlyTempC')
  }
  return out
}

/** Water temperature on a date: that month's mean, else the single figure. */
export function tempOn(a: Pick<PlanAssumptions, 'tempC' | 'monthlyTempC'>, date: string): number {
  const m = Number(date.slice(5, 7)) - 1
  const t = a.monthlyTempC?.[m]
  return t != null && finite(t) ? t : a.tempC
}

const tableFor = (speciesKey: string | null): FeedBand[] =>
  (speciesKey && DEFAULT_FEED_TABLES[speciesKey]?.bands) ||
  (temperatureGroup(speciesKey) === 'catfish' ? DEFAULT_FEED_TABLES.african_catfish.bands : DEFAULT_FEED_TABLES.nile_tilapia.bands)

/**
 * Plan one cycle. Inputs are assumed valid (planProblems); out-of-range
 * numbers are clamped rather than thrown so a half-typed form still draws.
 */
export function planCycle(i: PlanInputs, a: PlanAssumptions): PlanResult {
  const key = a.speciesKey
  const stockedFish = Math.max(0, Math.round(i.units * i.fishPerUnit))
  const w0 = Math.max(0.01, i.stockAbwG)
  const target = Math.max(w0, i.harvestAbwG)
  const survival = Math.min(1, Math.max(0.0001, a.survivalPct / 100))
  const bands = tableFor(key)

  // Growth, day by day, until the target weight.
  const weights = [w0]
  let w = w0
  let days = 0
  while (w < target && days < PLAN_LIMITS.maxDays) {
    w = abwAfter(w, a.tgc, effectiveTemp(key, tempOn(a, addDays(i.stockOn, days))))
    weights.push(w)
    days += 1
  }
  const reached = w >= target
  const hazard = days > 0 ? 1 - survival ** (1 / days) : 0
  const countOn = (d: number) => stockedFish * (1 - hazard) ** d

  // Feed: the table's ration shape, scaled so feed ÷ net gain = FCR.
  const fish = Math.round(stockedFish * survival)
  const harvestKg = (fish * (reached ? target : w)) / 1000
  const stockedKg = (stockedFish * w0) / 1000
  const feedKg = Math.max(0, harvestKg - stockedKg) * a.fcr
  const shape: number[] = []
  for (let d = 0; d < days; d++) {
    const date = addDays(i.stockOn, d)
    const pct = bandFor(bands, weights[d])?.band.bodyWeightPct ?? 1
    shape.push(((countOn(d) * weights[d]) / 1000) * (pct / 100) * temperatureFactor(key, tempOn(a, date)))
  }
  const shapeSum = shape.reduce((s, x) => s + x, 0)
  const daily = shape.map((x) => (shapeSum > 0 ? (x / shapeSum) * feedKg : 0))

  const bagKg = i.bagKg > 0 ? i.bagKg : PLAN_DEFAULTS.bagKg
  const bags = Math.ceil(feedKg / bagKg - 1e-9)
  const feedCost = bags * i.feedPricePerBag
  const fingerlingCost = stockedFish * i.fingerlingPrice
  const sales = harvestKg * i.salePricePerKg
  const margin = sales - feedCost - fingerlingCost
  const harvestDate = addDays(i.stockOn, days)

  // Month buckets from the stocking month to the harvest month.
  const months: PlanMonth[] = []
  const byMonth = new Map<string, PlanMonth>()
  const bucket = (month: string) => {
    let b = byMonth.get(month)
    if (!b) {
      b = { month, feedKg: 0, abwG: w0, fish: stockedFish, cashOut: 0, harvest: false }
      byMonth.set(month, b)
      months.push(b)
    }
    return b
  }
  bucket(i.stockOn.slice(0, 7)).cashOut += fingerlingCost
  const perKgFeed = feedKg > 0 ? feedCost / feedKg : 0
  for (let d = 0; d <= days; d++) {
    const date = addDays(i.stockOn, d)
    const b = bucket(date.slice(0, 7))
    if (d < days) {
      b.feedKg += daily[d]
      b.cashOut += daily[d] * perKgFeed
    }
    b.abwG = weights[d]
    b.fish = d === days ? fish : countOn(d)
  }
  const last = months[months.length - 1]
  last.harvest = reached
  for (const m of months) {
    m.feedKg = Math.round(m.feedKg * 10) / 10
    m.abwG = Math.round(m.abwG * 10) / 10
    m.fish = Math.round(m.fish)
    m.cashOut = Math.round(m.cashOut)
  }

  const curve = [{ date: i.stockOn, abwG: w0 }]
  for (const m of months) {
    const end = m.harvest || m === last ? harvestDate : lastDayOf(m.month)
    curve.push({ date: end, abwG: m.abwG })
  }

  return {
    reached,
    days,
    harvestDate,
    fish,
    harvestKg: round1(harvestKg),
    stockedFish,
    stockedKg: round1(stockedKg),
    feedKg: round1(feedKg),
    bags,
    feedCost: Math.round(feedCost),
    fingerlingCost: Math.round(fingerlingCost),
    cashNeeded: Math.round(feedCost + fingerlingCost),
    cashLowOn: days > 0 ? addDays(harvestDate, -1) : harvestDate,
    sales: Math.round(sales),
    margin: Math.round(margin),
    marginPct: sales > 0 ? Math.round((margin / sales) * 1000) / 10 : null,
    months,
    curve,
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10)
}

/** Default assumptions for a species when there is no history. */
export function defaultAssumptions(species: SpeciesPrior): PlanAssumptions {
  const group = temperatureGroup(species?.key)
  return {
    speciesKey: species?.key ?? null,
    survivalPct: PLAN_DEFAULTS.survivalPct,
    fcr: species?.targetFcr && species.targetFcr > 0 ? species.targetFcr : FORECAST.defaultFcr,
    tgc: Math.round(priorTgc(species) * 1000) / 1000,
    tempC: FORECAST.defaultTempC[group],
    monthlyTempC: null,
  }
}

/**
 * TGC of a closed cycle from its stocking and harvest weights and its days,
 * with the same temperatures the planner uses going forward.
 */
export function cycleTgc(
  args: { openedOn: string; days: number; startAbwG: number; endAbwG: number },
  a: Pick<PlanAssumptions, 'speciesKey' | 'tempC' | 'monthlyTempC'>,
): number | null {
  if (!(args.startAbwG > 0) || !(args.endAbwG > args.startAbwG) || !(args.days > 0)) return null
  let dd = 0
  for (let d = 0; d < Math.min(args.days, PLAN_LIMITS.maxDays); d++) {
    dd += effectiveTemp(a.speciesKey, tempOn(a, addDays(args.openedOn, d)))
  }
  if (!(dd > 0)) return null
  const tgc = (Math.cbrt(args.endAbwG) - Math.cbrt(args.startAbwG)) / (dd / 1000)
  return finite(tgc) && tgc > 0 ? tgc : null
}

export type ComparedPlan = { name: string; result: PlanResult }

export type CompareNote =
  | { kind: 'same'; name: string }
  | { kind: 'tradeoff'; fast: string; best: string; weeks: number; marginGap: number; perMonthLeader: string; perMonth: number }

/**
 * One deterministic sentence on the trade-off between saved plans: the plan
 * that sells first against the plan with the best margin, and which of the
 * two earns more for each month the fish are in the water. Null with fewer
 * than two plans that reach harvest weight.
 */
export function compareNote(plans: ComparedPlan[]): CompareNote | null {
  const ok = plans.filter((p) => p.result.reached && p.result.days > 0)
  if (ok.length < 2) return null
  const fast = [...ok].sort((x, y) => x.result.harvestDate.localeCompare(y.result.harvestDate) || y.result.margin - x.result.margin)[0]
  const best = [...ok].sort((x, y) => y.result.margin - x.result.margin || x.result.harvestDate.localeCompare(y.result.harvestDate))[0]
  if (fast === best) return { kind: 'same', name: best.name }
  const perMonth = (p: ComparedPlan) => p.result.margin / (p.result.days / 30.4375)
  const leader = perMonth(fast) > perMonth(best) ? fast : best
  return {
    kind: 'tradeoff',
    fast: fast.name,
    best: best.name,
    weeks: Math.max(0, Math.round(daysApart(fast.result.harvestDate, best.result.harvestDate) / 7)),
    marginGap: Math.round(best.result.margin - fast.result.margin),
    perMonthLeader: leader.name,
    perMonth: Math.round(perMonth(leader)),
  }
}

function daysApart(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}
