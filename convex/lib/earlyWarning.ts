/**
 * Anomaly and mortality early-warning engine (AI-001). Pure and import-free,
 * so the Convex job, the browser (alert text) and tests share it.
 *
 * Explainable rules plus robust statistics over one unit's recent days
 * (rollups, sensor and manual water readings, samples). Each rule returns a
 * candidate with its evidence numbers; `decide` then applies dedupe and
 * cool-down against the unit's previous alert for the same rule. Thresholds
 * live in RULES so they are visible in tests and docs
 * (docs/architecture/22-insights-engine.md).
 */

export const ALERT_RULES = [
  'mortality_spike',
  'feed_drop',
  'missing_entries',
  'low_oxygen',
  'temperature_out_of_range',
  'fcr_deterioration',
  'growth_stall',
] as const
export type AlertRule = (typeof ALERT_RULES)[number]
export type Severity = 'info' | 'warning' | 'critical'
export type AlertStatus = 'open' | 'acknowledged' | 'resolved'
export type Evidence = Record<string, string | number | null>
export type Lang = 'en' | 'fr'

export const RULES = {
  /** Days of history read per unit (baseline + today). */
  lookbackDays: 21,
  mortality: {
    /** Baseline window before the evaluated day. */
    baselineDays: 14,
    /** Fewer days with entries than this: only the absolute threshold applies. */
    minBaselineDays: 7,
    /** Never alert on fewer deaths than this in a day (small-number noise). */
    minDeaths: 5,
    /** …or below this daily rate (fraction of the fish). */
    minRate: 0.0005,
    zThreshold: 3,
    /** Floor on the baseline standard deviation, so a flat zero history is not infinitely sensitive. */
    sdFloor: 0.0005,
    /** Daily rate that alerts without any history. */
    absoluteRate: 0.005,
    /** Daily rate that makes it critical, or this z when also above the absolute rate. */
    criticalRate: 0.01,
    criticalZ: 6,
    ewmaLambda: 0.3,
  },
  feed: {
    medianDays: 7,
    minDaysWithFeed: 4,
    minMedianKg: 2,
    dropShare: 0.2,
    criticalDropShare: 0.6,
  },
  missing: { minDays: 2 },
  water: {
    windowDays: 3,
    minBreachDays: 2,
    /** A single day this far below the DO minimum is critical on its own. */
    severeDoShare: 0.75,
    /** Falling 3 days in a row and within this share above the minimum. */
    trendMarginShare: 0.1,
    /** Temperature rising/falling 3 days in a row and within this many °C of a limit. */
    trendMarginC: 1,
  },
  fcr: { risingWeeks: 3, minIncrease: 0.1 },
  growth: { minGapDays: 7, maxSampleAgeDays: 45 },
} as const

/** Expected minimum SGR (% per day) by size; below half of it is a stall. */
export function expectedSgr(abwG: number): number {
  if (abwG < 50) return 2
  if (abwG < 200) return 1
  if (abwG < 500) return 0.5
  return 0.3
}

/** Days before the same rule may raise a new alert on the same unit. */
export const COOLDOWN_DAYS: Record<AlertRule, number> = {
  mortality_spike: 3,
  feed_drop: 3,
  missing_entries: 2,
  low_oxygen: 1,
  temperature_out_of_range: 2,
  fcr_deterioration: 7,
  growth_stall: 14,
}

export type DayInput = {
  date: string
  /** A daily record exists for the day. */
  hasEntry: boolean
  feedKg: number
  deaths: number
  /** Fish at the start of the day (ledger), null when unknown. */
  startCount: number | null
  /** Lowest DO of the day (sensor or manual), mg/L. */
  doMin: number | null
  tempMin: number | null
  tempMax: number | null
}

export type UnitInput = {
  unitId: string
  unitName: string
  /** The evaluated (complete) business day. */
  asOf: string
  /** Stocking date of the open cycle. */
  stockedOn: string | null
  /** Any order; missing days count as "no entry". */
  days: DayInput[]
  /** Cycle-to-date FCR at each week end, any order. */
  weeklyFcr: Array<{ weekEnd: string; fcr: number | null }>
  samples: Array<{ date: string; abwG: number }>
  thresholds: { doMin?: number; tempMin?: number; tempMax?: number }
}

export type Candidate = {
  rule: AlertRule
  severity: Severity
  date: string
  evidence: Evidence
  score: number
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysApart(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

const r = (x: number | null | undefined, dp: number): number | null =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function meanSd(values: number[]): { mean: number; sd: number } | null {
  if (!values.length) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return { mean, sd: Math.sqrt(variance) }
}

/** Exponentially weighted moving average, oldest value first. */
export function ewma(values: number[], lambda: number): number | null {
  if (!values.length) return null
  let e = values[0]
  for (let i = 1; i < values.length; i++) e = lambda * values[i] + (1 - lambda) * e
  return e
}

/** Day rows keyed by date over [asOf - n + 1, asOf], filling gaps with empty days. */
function window(u: UnitInput, n: number): DayInput[] {
  const byDate = new Map(u.days.map((d) => [d.date, d]))
  const out: DayInput[] = []
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(u.asOf, -i)
    out.push(
      byDate.get(date) ?? { date, hasEntry: false, feedKg: 0, deaths: 0, startCount: null, doMin: null, tempMin: null, tempMax: null },
    )
  }
  return out
}

const stocked = (u: UnitInput, date: string) => !u.stockedOn || u.stockedOn <= date

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------

export function mortalitySpike(u: UnitInput, R = RULES.mortality): Candidate | null {
  const days = window(u, R.baselineDays + 1)
  const today = days[days.length - 1]
  if (!today.startCount || today.startCount <= 0) return null
  if (today.deaths < R.minDeaths) return null
  const rate = today.deaths / today.startCount
  if (rate < R.minRate) return null

  const base = days
    .slice(0, -1)
    .filter((d) => stocked(u, d.date) && (d.hasEntry || d.deaths > 0) && d.startCount && d.startCount > 0)
    .map((d) => d.deaths / d.startCount!)
  const stats = base.length >= R.minBaselineDays ? meanSd(base) : null
  const z = stats ? (rate - stats.mean) / Math.max(stats.sd, R.sdFloor) : null
  const smoothed = ewma([...base, rate], R.ewmaLambda)

  const statistical = z != null && z >= R.zThreshold
  const absolute = rate >= R.absoluteRate && (stats == null || rate >= 2 * stats.mean)
  if (!statistical && !absolute) return null
  const critical = rate >= R.criticalRate || (z != null && z >= R.criticalZ && rate >= R.absoluteRate)
  return {
    rule: 'mortality_spike',
    severity: critical ? 'critical' : 'warning',
    date: u.asOf,
    evidence: {
      deaths: today.deaths,
      fish: today.startCount,
      rate_pct: r(rate * 100, 2),
      baseline_pct: stats ? r(stats.mean * 100, 2) : null,
      baseline_days: base.length,
      z: r(z, 1),
      ewma_pct: r((smoothed ?? 0) * 100, 2),
    },
    score: rate * 100,
  }
}

export function feedDrop(u: UnitInput, R = RULES.feed): Candidate | null {
  const days = window(u, R.medianDays + 1)
  const today = days[days.length - 1]
  if (!today.hasEntry) return null
  const fed = days.slice(0, -1).filter((d) => d.hasEntry && d.feedKg > 0).map((d) => d.feedKg)
  if (fed.length < R.minDaysWithFeed) return null
  const med = median(fed)!
  if (med < R.minMedianKg) return null
  const drop = 1 - today.feedKg / med
  if (drop < R.dropShare) return null
  return {
    rule: 'feed_drop',
    severity: drop >= R.criticalDropShare ? 'critical' : 'warning',
    date: u.asOf,
    evidence: {
      feed_kg: r(today.feedKg, 1),
      median_kg: r(med, 1),
      drop_pct: Math.round(drop * 100),
      days: fed.length,
    },
    score: drop,
  }
}

export function missingEntries(u: UnitInput, R = RULES.missing): Candidate | null {
  const days = window(u, RULES.lookbackDays)
  let missing = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].hasEntry || !stocked(u, days[i].date)) break
    missing++
  }
  if (missing < R.minDays) return null
  const last = [...days].reverse().find((d) => d.hasEntry)
  return {
    rule: 'missing_entries',
    severity: 'warning',
    date: u.asOf,
    evidence: { days_missing: missing, last_entry: last?.date ?? null },
    score: missing,
  }
}

export function lowOxygen(u: UnitInput, R = RULES.water): Candidate | null {
  const min = u.thresholds.doMin
  if (min == null) return null
  const days = window(u, R.windowDays)
  const values = days.map((d) => d.doMin)
  const latest = [...values].reverse().find((x) => x != null) ?? null
  if (latest == null) return null
  const breachDays = values.filter((x) => x != null && x < min).length
  const severe = latest < min * R.severeDoShare
  const known = values.filter((x): x is number => x != null)
  const falling = known.length === R.windowDays && known[0] > known[1] && known[1] > known[2] && known[2] <= min * (1 + R.trendMarginShare)
  if (breachDays < R.minBreachDays && !severe && !falling) return null
  return {
    rule: 'low_oxygen',
    severity: severe || breachDays >= R.minBreachDays ? 'critical' : 'warning',
    date: u.asOf,
    evidence: {
      do_mg_l: r(latest, 2),
      min_mg_l: min,
      breach_days: breachDays,
      window_days: R.windowDays,
      trend: falling ? 'falling' : null,
    },
    score: min - latest,
  }
}

export function temperatureOutOfRange(u: UnitInput, R = RULES.water): Candidate | null {
  const { tempMin, tempMax } = u.thresholds
  if (tempMin == null && tempMax == null) return null
  const days = window(u, R.windowDays)
  const highs = days.map((d) => d.tempMax)
  const lows = days.map((d) => d.tempMin)
  const highBreach = tempMax == null ? 0 : highs.filter((x) => x != null && x > tempMax).length
  const lowBreach = tempMin == null ? 0 : lows.filter((x) => x != null && x < tempMin).length
  const kh = highs.filter((x): x is number => x != null)
  const kl = lows.filter((x): x is number => x != null)
  const rising = tempMax != null && kh.length === R.windowDays && kh[0] < kh[1] && kh[1] < kh[2] && kh[2] >= tempMax - R.trendMarginC
  const falling = tempMin != null && kl.length === R.windowDays && kl[0] > kl[1] && kl[1] > kl[2] && kl[2] <= tempMin + R.trendMarginC
  const high = highBreach >= R.minBreachDays || rising
  const low = lowBreach >= R.minBreachDays || falling
  if (!high && !low) return null
  const direction = high && (!low || highBreach >= lowBreach) ? 'high' : 'low'
  const value = direction === 'high' ? kh[kh.length - 1] : kl[kl.length - 1]
  const breaches = direction === 'high' ? highBreach : lowBreach
  return {
    rule: 'temperature_out_of_range',
    severity: 'warning',
    date: u.asOf,
    evidence: {
      temp_c: r(value ?? null, 1),
      min_c: tempMin ?? null,
      max_c: tempMax ?? null,
      direction,
      breach_days: breaches,
      window_days: R.windowDays,
      trend: breaches < R.minBreachDays ? (direction === 'high' ? 'rising' : 'falling') : null,
    },
    score: breaches,
  }
}

export function fcrDeterioration(u: UnitInput, R = RULES.fcr): Candidate | null {
  const s = [...u.weeklyFcr].filter((w) => w.weekEnd <= u.asOf).sort((a, b) => a.weekEnd.localeCompare(b.weekEnd))
  let rises = 0
  for (let i = s.length - 1; i > 0; i--) {
    const now = s[i].fcr
    const before = s[i - 1].fcr
    if (now == null || before == null || !(now > before)) break
    rises++
  }
  if (rises < R.risingWeeks) return null
  const from = s[s.length - 1 - rises]
  const to = s[s.length - 1]
  const increase = to.fcr! - from.fcr!
  if (increase < R.minIncrease) return null
  return {
    rule: 'fcr_deterioration',
    severity: 'warning',
    date: u.asOf,
    evidence: { weeks: rises, fcr_from: r(from.fcr, 2), fcr_to: r(to.fcr, 2), week_from: from.weekEnd, week_to: to.weekEnd },
    score: increase,
  }
}

export function growthStall(u: UnitInput, R = RULES.growth): Candidate | null {
  const s = [...u.samples]
    .filter((x) => x.date <= u.asOf && x.abwG > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (s.length < 2) return null
  const last = s[s.length - 1]
  if (daysApart(last.date, u.asOf) > R.maxSampleAgeDays) return null
  const prev = [...s].reverse().find((x) => daysApart(x.date, last.date) >= R.minGapDays)
  if (!prev) return null
  const days = daysApart(prev.date, last.date)
  const sgr = ((Math.log(last.abwG) - Math.log(prev.abwG)) / days) * 100
  const expected = expectedSgr(prev.abwG)
  if (sgr >= expected / 2) return null
  return {
    rule: 'growth_stall',
    severity: 'warning',
    date: u.asOf,
    evidence: {
      abw_from_g: r(prev.abwG, 1),
      abw_to_g: r(last.abwG, 1),
      sample_from: prev.date,
      sample_to: last.date,
      days,
      sgr_pct: r(sgr, 2),
      expected_sgr_pct: expected,
    },
    score: expected - sgr,
  }
}

/** Every rule on one unit. */
export function evaluateUnit(u: UnitInput): Candidate[] {
  return [
    mortalitySpike(u),
    feedDrop(u),
    missingEntries(u),
    lowOxygen(u),
    temperatureOutOfRange(u),
    fcrDeterioration(u),
    growthStall(u),
  ].filter((c): c is Candidate => c != null)
}

// ---------------------------------------------------------------------------
// dedupe and cool-down
// ---------------------------------------------------------------------------

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }

export type PriorAlert = { date: string; lastSeenDate: string; severity: Severity; status: AlertStatus }

export type Decision =
  | { action: 'insert' }
  /** Update the prior alert's evidence (same day re-run, or still active). */
  | { action: 'refresh'; escalated: boolean }
  | { action: 'suppress' }

/**
 * What to do with a candidate given the unit's latest alert for the rule:
 * - same evaluated day → refresh (the job is idempotent per unit/day/rule);
 * - prior still open or acknowledged → refresh it (one live alert per rule);
 * - prior resolved within the cool-down → suppress unless more severe;
 * - otherwise → a new alert.
 * `escalated` (severity went up) is the only refresh that notifies again.
 */
export function decide(prior: PriorAlert | null, c: Candidate): Decision {
  if (!prior) return { action: 'insert' }
  const escalated = SEVERITY_RANK[c.severity] > SEVERITY_RANK[prior.severity]
  if (prior.lastSeenDate === c.date || prior.date === c.date) return { action: 'refresh', escalated }
  if (prior.status !== 'resolved') return { action: 'refresh', escalated }
  const since = daysApart(prior.lastSeenDate, c.date)
  if (since < COOLDOWN_DAYS[c.rule] && !escalated) return { action: 'suppress' }
  return { action: 'insert' }
}

// ---------------------------------------------------------------------------
// text (EN/FR); numbers are copied from the evidence, never recomputed
// ---------------------------------------------------------------------------

const n = (x: string | number | null | undefined) => (x == null ? '—' : String(x))

const TEXT: Record<Lang, Record<AlertRule, (unit: string, e: Evidence) => { title: string; detail: string }>> = {
  en: {
    mortality_spike: (u, e) => ({
      title: `${u}: deaths up`,
      detail:
        `${n(e.deaths)} deaths on ${n(e.fish)} fish (${n(e.rate_pct)}% in a day)` +
        (e.baseline_pct == null
          ? ', with too little history for a baseline.'
          : ` against a ${n(e.baseline_days)}-day baseline of ${n(e.baseline_pct)}% a day (z = ${n(e.z)}).`),
    }),
    feed_drop: (u, e) => ({
      title: `${u}: feed intake down ${n(e.drop_pct)}%`,
      detail: `${n(e.feed_kg)} kg fed against a median of ${n(e.median_kg)} kg over the previous ${n(e.days)} feeding days.`,
    }),
    missing_entries: (u, e) => ({
      title: `${u}: no daily entry for ${n(e.days_missing)} days`,
      detail: e.last_entry ? `Last entry on ${n(e.last_entry)}.` : 'No entry in the last 3 weeks.',
    }),
    low_oxygen: (u, e) => ({
      title: `${u}: low dissolved oxygen`,
      detail:
        `Lowest DO ${n(e.do_mg_l)} mg/L against a minimum of ${n(e.min_mg_l)} mg/L; below it on ${n(e.breach_days)} of the last ${n(e.window_days)} days` +
        (e.trend === 'falling' ? ', and falling.' : '.'),
    }),
    temperature_out_of_range: (u, e) => ({
      title: `${u}: water temperature ${e.direction === 'high' ? 'high' : 'low'}`,
      detail:
        `${n(e.temp_c)} °C against a range of ${n(e.min_c)}–${n(e.max_c)} °C; outside it on ${n(e.breach_days)} of the last ${n(e.window_days)} days` +
        (e.trend ? `, ${e.trend === 'rising' ? 'rising' : 'falling'} toward the limit.` : '.'),
    }),
    fcr_deterioration: (u, e) => ({
      title: `${u}: FCR rising ${n(e.weeks)} weeks in a row`,
      detail: `Cycle FCR went from ${n(e.fcr_from)} (week ending ${n(e.week_from)}) to ${n(e.fcr_to)} (week ending ${n(e.week_to)}).`,
    }),
    growth_stall: (u, e) => ({
      title: `${u}: growth has slowed`,
      detail: `ABW ${n(e.abw_from_g)} g → ${n(e.abw_to_g)} g in ${n(e.days)} days (SGR ${n(e.sgr_pct)}%/day, expected about ${n(e.expected_sgr_pct)}%/day at this size).`,
    }),
  },
  fr: {
    mortality_spike: (u, e) => ({
      title: `${u} : mortalité en hausse`,
      detail:
        `${n(e.deaths)} morts sur ${n(e.fish)} poissons (${n(e.rate_pct)} % en un jour)` +
        (e.baseline_pct == null
          ? ', historique insuffisant pour une référence.'
          : ` contre une référence de ${n(e.baseline_pct)} % par jour sur ${n(e.baseline_days)} jours (z = ${n(e.z)}).`),
    }),
    feed_drop: (u, e) => ({
      title: `${u} : prise d'aliment en baisse de ${n(e.drop_pct)} %`,
      detail: `${n(e.feed_kg)} kg distribués contre une médiane de ${n(e.median_kg)} kg sur les ${n(e.days)} jours d'alimentation précédents.`,
    }),
    missing_entries: (u, e) => ({
      title: `${u} : aucune saisie depuis ${n(e.days_missing)} jours`,
      detail: e.last_entry ? `Dernière saisie le ${n(e.last_entry)}.` : 'Aucune saisie ces 3 dernières semaines.',
    }),
    low_oxygen: (u, e) => ({
      title: `${u} : oxygène dissous bas`,
      detail:
        `OD minimal ${n(e.do_mg_l)} mg/L pour un minimum de ${n(e.min_mg_l)} mg/L ; en dessous ${n(e.breach_days)} des ${n(e.window_days)} derniers jours` +
        (e.trend === 'falling' ? ', et en baisse.' : '.'),
    }),
    temperature_out_of_range: (u, e) => ({
      title: `${u} : température de l'eau ${e.direction === 'high' ? 'élevée' : 'basse'}`,
      detail:
        `${n(e.temp_c)} °C pour une plage de ${n(e.min_c)}–${n(e.max_c)} °C ; hors plage ${n(e.breach_days)} des ${n(e.window_days)} derniers jours` +
        (e.trend ? `, ${e.trend === 'rising' ? 'en hausse' : 'en baisse'} vers la limite.` : '.'),
    }),
    fcr_deterioration: (u, e) => ({
      title: `${u} : IC en hausse ${n(e.weeks)} semaines de suite`,
      detail: `L'IC du cycle est passé de ${n(e.fcr_from)} (semaine au ${n(e.week_from)}) à ${n(e.fcr_to)} (semaine au ${n(e.week_to)}).`,
    }),
    growth_stall: (u, e) => ({
      title: `${u} : croissance ralentie`,
      detail: `PMI ${n(e.abw_from_g)} g → ${n(e.abw_to_g)} g en ${n(e.days)} jours (TCS ${n(e.sgr_pct)} %/jour, environ ${n(e.expected_sgr_pct)} %/jour attendu à cette taille).`,
    }),
  },
}

const ACTIONS: Record<Lang, Record<AlertRule, string[]>> = {
  en: {
    mortality_spike: ['Check DO, temperature and ammonia today', 'Inspect fish for lesions, gasping or erratic swimming', 'Record the cause of each death', 'Reduce feeding until the cause is known'],
    feed_drop: ['Check DO and temperature: fish eat less in poor water', 'Watch the fish at the next feeding for signs of disease', 'Confirm the feed amount was entered correctly'],
    missing_entries: ['Enter the missing daily records (feed and deaths)', 'Check the unit is still stocked and assigned'],
    low_oxygen: ['Run aerators, especially before dawn', 'Cut or pause feeding until DO recovers', 'Check stocking density and water exchange'],
    temperature_out_of_range: ['Adjust feeding to the temperature (see the feeding plan)', 'Check shade, depth or water exchange', 'Watch for stress and disease signs'],
    fcr_deterioration: ['Check the feeding rate against the feeding plan', 'Take a fresh sample to confirm growth', 'Look for feed waste and uneaten pellets'],
    growth_stall: ['Take a fresh sample to confirm the weight', 'Check feed quality, rate and water quality', 'Consider grading or density'],
  },
  fr: {
    mortality_spike: ["Contrôler l'OD, la température et l'ammoniac aujourd'hui", 'Examiner les poissons (lésions, halètement, nage anormale)', 'Noter la cause de chaque mort', "Réduire l'alimentation jusqu'à connaître la cause"],
    feed_drop: ["Contrôler l'OD et la température : les poissons mangent moins dans une eau dégradée", 'Observer les poissons au prochain repas (signes de maladie)', "Vérifier que la quantité d'aliment saisie est correcte"],
    missing_entries: ['Saisir les relevés journaliers manquants (aliment et morts)', "Vérifier que l'unité est toujours empoissonnée et affectée"],
    low_oxygen: ["Faire tourner les aérateurs, surtout avant l'aube", "Réduire ou suspendre l'alimentation jusqu'au retour de l'OD", "Vérifier la densité et le renouvellement de l'eau"],
    temperature_out_of_range: ["Adapter l'alimentation à la température (voir le plan d'alimentation)", "Vérifier l'ombrage, la profondeur ou le renouvellement de l'eau", 'Surveiller les signes de stress et de maladie'],
    fcr_deterioration: ["Comparer le taux d'alimentation au plan d'alimentation", 'Faire un nouvel échantillonnage pour confirmer la croissance', "Chercher le gaspillage d'aliment et les granulés non consommés"],
    growth_stall: ['Faire un nouvel échantillonnage pour confirmer le poids', "Vérifier la qualité et le taux d'aliment, et la qualité de l'eau", 'Envisager un tri ou une baisse de densité'],
  },
}

export function langOf(locale: string | null | undefined): Lang {
  return String(locale ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

/** Title, detail and suggested actions of an alert in a language. */
export function alertText(
  a: { rule: AlertRule; unitName: string; evidence: Evidence },
  lang: Lang = 'en',
): { title: string; detail: string; actions: string[] } {
  const l = TEXT[lang] ? lang : 'en'
  return { ...TEXT[l][a.rule](a.unitName, a.evidence), actions: ACTIONS[l][a.rule] }
}
