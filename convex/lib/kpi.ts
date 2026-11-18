/**
 * One definition of every production KPI (PROD-008, doc 05 §6).
 *
 * Pure functions, no Convex imports, so the server (cage page, dashboard,
 * report, export) and tests share the same formulas. They replace the
 * duplicates listed in doc 09 §2–§3: four FCRs (C6/C7/C8/C25/C28), four
 * mortality/survival figures (C12/C13/C14/C24/C31) and four growth-per-day
 * figures (C4/C26/C29/C40), and the DOC variants (C15).
 *
 * Units: weights in grams, biomass and feed in kg, dates as YYYY-MM-DD.
 */

/** Rounded to `dp` decimals; null for null and non-finite input. */
export function round(n: number | null | undefined, dp: number): number | null {
  if (n == null || !Number.isFinite(n)) return null
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Standing biomass, kg: count × ABW (g) / 1000; 0 when either is missing. */
export const biomassKg = (count: number, abwG: number) =>
  count > 0 && abwG > 0 ? (count * abwG) / 1000 : 0

/**
 * Days of culture between two business dates (noon UTC, so DST and time of
 * day never shift the count). Never negative. The only DOC convention.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms =
    new Date(`${toIso}T12:00:00Z`).getTime() - new Date(`${fromIso}T12:00:00Z`).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.round(ms / 86_400_000))
}

/** Economic FCR: kg feed per kg gained. Null without feed or without gain. */
export function efcr(feedKg: number, gainKg: number): number | null {
  if (!(feedKg > 0) || !(gainKg > 0)) return null
  return feedKg / gainKg
}

/** Old name of {@link efcr}; kept for callers of convex/lib/growth.ts. */
export const fcr = efcr

/** Biological FCR: feed ÷ (gain + estimated biomass of fish that died). */
export function biologicalFcr(feedKg: number, gainKg: number, deadKg: number): number | null {
  return efcr(feedKg, gainKg + Math.max(0, deadKg))
}

/**
 * FCR over several occupancies or a period: Σ feed ÷ Σ gain. Weighted by
 * production, so a 100 kg partial harvest does not count as much as a 10 t
 * one (replaces the unweighted means C25/C28). Rows with no gain still add
 * their feed, so poor performers are not dropped (C7).
 */
export function pooledFcr(rows: Array<{ feedKg: number; gainKg: number }>): number | null {
  let feed = 0
  let gain = 0
  for (const r of rows) {
    feed += r.feedKg || 0
    gain += r.gainKg || 0
  }
  return efcr(feed, gain)
}

/** Specific growth rate, % body weight per day. */
export function sgr(abwStartG: number, abwEndG: number, days: number): number | null {
  if (!(abwStartG > 0) || !(abwEndG > 0) || !(days > 0)) return null
  return ((Math.log(abwEndG) - Math.log(abwStartG)) / days) * 100
}

/** Average daily gain, grams per fish per day (negative growth allowed). */
export function adg(abwStartG: number, abwEndG: number, days: number): number | null {
  if (!(abwStartG > 0) || !(abwEndG > 0) || !(days > 0)) return null
  return (abwEndG - abwStartG) / days
}

/**
 * Growth per day of one occupancy from its samples: first to last sample,
 * same batch in the same cage only (callers never pool cages, C29). Null with
 * fewer than two samples on different days.
 */
export function sampleGrowthPerDay(
  samples: Array<{ date: string; abwG: number }>,
): number | null {
  const s = samples.filter((x) => x.abwG > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (s.length < 2) return null
  return adg(s[0].abwG, s[s.length - 1].abwG, daysBetween(s[0].date, s[s.length - 1].date))
}

/** Mean of non-null values; null when there are none. */
export function mean(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** Fish that entered an occupancy: stocked plus transferred, split or merged in. */
export const fishIn = (f: { stockedCount: number; inCount: number }) =>
  f.stockedCount + f.inCount

/**
 * Survival %: (live + harvested + moved out) ÷ fish in. Harvests and
 * transfers are not losses; top-ups and transfers in are in the base, so it
 * never exceeds 100 % because of them (C14).
 */
export function survivalPct(f: {
  count: number
  harvestedCount: number
  outCount: number
  stockedCount: number
  inCount: number
}): number | null {
  const base = fishIn(f)
  if (!(base > 0)) return null
  return ((f.count + f.harvestedCount + f.outCount) / base) * 100
}

/**
 * Cumulative mortality %: recorded deaths ÷ fish in (C13, C24, C31). Harvested
 * and transferred fish are not deaths.
 */
export function cumulativeMortalityPct(f: {
  mortalityCount: number
  stockedCount: number
  inCount: number
}): number | null {
  const base = fishIn(f)
  if (!(base > 0)) return null
  return (Math.max(0, f.mortalityCount) / base) * 100
}

/** Daily mortality %: the day's deaths ÷ fish at the start of the day (C12). */
export function dailyMortalityPct(deaths: number, countAtStartOfDay: number): number | null {
  if (!(countAtStartOfDay > 0)) return null
  return (Math.max(0, deaths) / countAtStartOfDay) * 100
}

/**
 * Mortality % for a period across cages: deaths ÷ (fish alive at the end +
 * deaths), both over the same cages (fixes the mismatched base of C24).
 */
export function periodMortalityPct(deaths: number, liveAtEnd: number): number | null {
  const base = Math.max(0, liveAtEnd) + Math.max(0, deaths)
  if (!(base > 0)) return null
  return (Math.max(0, deaths) / base) * 100
}

/**
 * Weight gained by an occupancy, kg: what is standing now plus what left
 * alive (harvested, moved out) minus what came in (stocked, moved in). Fish
 * that left were fed here, so their weight counts (doc 05 §7.1, S11).
 */
export function gainKg(f: {
  standingKg: number
  harvestedKg: number
  outKg: number
  stockedKg: number
  inKg: number
}): number {
  return f.standingKg + f.harvestedKg + f.outKg - f.stockedKg - f.inKg
}

/**
 * FCR over a set of harvests (dashboard, report, export). Uses the inputs
 * stored with each harvest (feed and gain from the ledger, PROD-009): per
 * cage and batch only the latest harvest counts, because its inputs are
 * cumulative for the occupancy. Older harvests without inputs fall back to
 * their recorded FCR weighted by harvested kg (never an unweighted mean,
 * never FCR 0, C25/C28).
 */
export function periodHarvestFcr(
  harvests: Array<{
    cageId: string
    batchId?: string
    harvestDate: string
    totalWeight: number
    fcr?: number
    fcrInputs?: { feedKg: number; gainKg: number } | null
  }>,
): number | null {
  const latest = new Map<string, (typeof harvests)[number]>()
  const rows: Array<{ feedKg: number; gainKg: number }> = []
  for (const h of harvests) {
    if (h.fcrInputs && h.batchId) {
      const k = `${h.cageId}|${h.batchId}`
      const prev = latest.get(k)
      if (!prev || h.harvestDate >= prev.harvestDate) latest.set(k, h)
    } else if (h.fcr && h.fcr > 0 && h.totalWeight > 0) {
      rows.push({ feedKg: h.fcr * h.totalWeight, gainKg: h.totalWeight })
    }
  }
  for (const h of latest.values()) rows.push(h.fcrInputs!)
  return pooledFcr(rows)
}

/**
 * Growth per day over a set of samples: the slope of each occupancy (cage
 * and batch; cage alone for untagged samples), then their mean. Samples of
 * different cages or cycles are never joined into one slope (C26, C29).
 */
export function periodGrowthPerDay(
  samples: Array<{ cageId: string; batchId?: string; date: string; abwG: number }>,
): number | null {
  const groups = new Map<string, Array<{ date: string; abwG: number }>>()
  for (const s of samples) {
    const k = `${s.cageId}|${s.batchId ?? ''}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push({ date: s.date, abwG: s.abwG })
  }
  return mean([...groups.values()].map(sampleGrowthPerDay))
}

// ---------------------------------------------------------------------------
// Occupancy KPIs from ledger events
// ---------------------------------------------------------------------------

export type LedgerEvent = {
  type: string
  reversedType?: string
  qtyDelta: number
  biomassKgDelta: number
  abwG?: number
  eventDate: string
  intraDayOrder: number
  recordedAt: number
  component?: string
}

export type Flows = {
  count: number
  stockedCount: number
  stockedKg: number
  inCount: number
  inKg: number
  outCount: number
  outKg: number
  mortalityCount: number
  mortalityKgEst: number
  harvestedCount: number
  harvestedKg: number
  adjustmentCount: number
  /** Fish counted missing when the occupancy was emptied (negative close-outs). */
  unaccountedCount: number
}

export const emptyFlows = (): Flows => ({
  count: 0,
  stockedCount: 0,
  stockedKg: 0,
  inCount: 0,
  inKg: 0,
  outCount: 0,
  outKg: 0,
  mortalityCount: 0,
  mortalityKgEst: 0,
  harvestedCount: 0,
  harvestedKg: 0,
  adjustmentCount: 0,
  unaccountedCount: 0,
})

/** Ledger order: date, then same-day order, then recording time. */
export function compareEvents(a: LedgerEvent, b: LedgerEvent) {
  if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1
  if (a.intraDayOrder !== b.intraDayOrder) return a.intraDayOrder - b.intraDayOrder
  return a.recordedAt - b.recordedAt
}

/**
 * Add one event (or reversal) to running flows. A reversal carries the type it
 * reverses and the opposite sign, so it subtracts from the same bucket.
 */
export function addToFlows(f: Flows, e: LedgerEvent): Flows {
  const type = e.type === 'reversal' ? e.reversedType ?? 'count_adjustment' : e.type
  const q = e.qtyDelta
  const kg = e.biomassKgDelta
  // For split/merge the bucket follows the sign of the original event.
  const originalSign = e.type === 'reversal' ? -Math.sign(q) : Math.sign(q)
  f.count += q
  switch (type) {
    case 'stock_in':
      f.stockedCount += q
      f.stockedKg += kg
      break
    case 'transfer_in':
      f.inCount += q
      f.inKg += kg
      break
    case 'transfer_out':
      f.outCount -= q
      f.outKg -= kg
      break
    case 'grading_split':
    case 'merge':
      if (originalSign > 0) {
        f.inCount += q
        f.inKg += kg
      } else {
        f.outCount -= q
        f.outKg -= kg
      }
      break
    case 'mortality':
      f.mortalityCount -= q
      f.mortalityKgEst -= kg
      break
    case 'harvest':
      f.harvestedCount -= q
      f.harvestedKg -= kg
      break
    default:
      f.adjustmentCount += q
      if (e.component === 'closeout') f.unaccountedCount -= q
  }
  return f
}

export function flowsOf(events: LedgerEvent[], asOf?: string): Flows {
  const f = emptyFlows()
  for (const e of events) {
    if (asOf && e.eventDate > asOf) continue
    addToFlows(f, e)
  }
  return f
}

export type Sample = { date: string; abwG: number }

/**
 * ABW (g) of an occupancy as of a date: the latest sample on or before it,
 * else the count-weighted ABW of the fish that came in (stock-in, transfer in,
 * merge). Never another occupancy's sample (TD-044).
 */
export function abwAsOf(
  events: LedgerEvent[],
  samples: Sample[],
  asOf: string,
): { abwG: number | null; date: string | null; measured: boolean } {
  const ordered = events.filter((e) => e.eventDate <= asOf).sort(compareEvents)
  let count = 0
  let abw: number | null = null
  let abwDate: string | null = null
  const sampleList = samples
    .filter((s) => s.date <= asOf && s.abwG > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  let si = 0
  let measured = false
  for (const e of ordered) {
    // Samples dated before this event set the ABW first.
    while (si < sampleList.length && sampleList[si].date < e.eventDate) {
      abw = sampleList[si].abwG
      abwDate = sampleList[si].date
      measured = true
      si++
    }
    const inflow = e.qtyDelta > 0 && e.type !== 'reversal' && e.type !== 'count_adjustment'
    if (inflow && e.abwG && e.abwG > 0) {
      abw = count > 0 && abw ? (count * abw + e.qtyDelta * e.abwG) / (count + e.qtyDelta) : e.abwG
      abwDate = e.eventDate
      measured = false
    }
    count += e.qtyDelta
  }
  while (si < sampleList.length) {
    abw = sampleList[si].abwG
    abwDate = sampleList[si].date
    measured = true
    si++
  }
  return { abwG: abw, date: abwDate, measured }
}

export type OccupancyKpis = {
  opened_on: string | null
  closed_on: string | null
  days_of_culture: number | null
  count: number
  stocked_count: number
  in_count: number
  out_count: number
  harvested_count: number
  harvested_kg: number
  mortality: number
  unaccounted: number
  initial_abw_g: number | null
  current_abw_g: number | null
  abw_measured_on: string | null
  stocked_biomass_kg: number
  current_biomass_kg: number
  gain_kg: number
  feed_kg: number
  feed_cost: number
  efcr: number | null
  biological_fcr: number | null
  survival_pct: number | null
  mortality_pct: number | null
  sgr_pct_day: number | null
  adg_g_day: number | null
}

/**
 * Every KPI of one occupancy (one batch in one cage), as of a date, from its
 * ledger events, its samples and its feed. The single derivation used by the
 * cage page, dashboard, report and export.
 */
export function occupancyKpis(input: {
  events: LedgerEvent[]
  samples: Sample[]
  feedKg: number
  feedCost?: number
  asOf: string
}): OccupancyKpis {
  const events = input.events.filter((e) => e.eventDate <= input.asOf).sort(compareEvents)
  const f = flowsOf(events)
  const openedOn = events.find((e) => e.qtyDelta > 0)?.eventDate ?? null
  const closed = events.length > 0 && f.count <= 0
  const closedOn = closed ? events[events.length - 1].eventDate : null
  const endDate = closedOn ?? input.asOf

  const firstInflow = events.find((e) => e.qtyDelta > 0 && e.abwG && e.abwG > 0)
  const initialAbw = firstInflow?.abwG ?? null
  const abw = abwAsOf(events, input.samples, endDate)
  const standingKg = biomassKg(Math.max(0, f.count), abw.abwG ?? 0)
  const gain = gainKg({
    standingKg,
    harvestedKg: f.harvestedKg,
    outKg: f.outKg,
    stockedKg: f.stockedKg,
    inKg: f.inKg,
  })
  const growthDays = openedOn && abw.date ? daysBetween(openedOn, abw.date) : 0

  return {
    opened_on: openedOn,
    closed_on: closedOn,
    days_of_culture: openedOn ? daysBetween(openedOn, endDate) : null,
    count: f.count,
    stocked_count: f.stockedCount,
    in_count: f.inCount,
    out_count: f.outCount,
    harvested_count: f.harvestedCount,
    harvested_kg: round(f.harvestedKg, 1) ?? 0,
    mortality: f.mortalityCount,
    unaccounted: f.unaccountedCount,
    initial_abw_g: round(initialAbw, 1),
    current_abw_g: round(abw.abwG, 1),
    abw_measured_on: abw.measured ? abw.date : null,
    stocked_biomass_kg: round(f.stockedKg + f.inKg, 1) ?? 0,
    current_biomass_kg: round(standingKg, 1) ?? 0,
    gain_kg: round(gain, 1) ?? 0,
    feed_kg: round(input.feedKg, 1) ?? 0,
    feed_cost: round(input.feedCost ?? 0, 2) ?? 0,
    efcr: round(efcr(input.feedKg, gain), 2),
    biological_fcr: round(biologicalFcr(input.feedKg, gain, f.mortalityKgEst), 2),
    survival_pct: round(survivalPct(f), 1),
    mortality_pct: round(cumulativeMortalityPct(f), 1),
    sgr_pct_day: round(sgr(initialAbw ?? 0, abw.abwG ?? 0, growthDays), 2),
    adg_g_day: round(adg(initialAbw ?? 0, abw.abwG ?? 0, growthDays), 2),
  }
}
