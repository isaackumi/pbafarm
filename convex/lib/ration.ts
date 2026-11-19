/**
 * Feeding plans (PROD-015): feed tables per species and size class, and the
 * daily ration they suggest. No imports, so the browser and tests share it.
 *
 * A table is a list of contiguous ABW bands: from `minAbwG` (inclusive) up to
 * the next band's `minAbwG`; the last band is open-ended. Each band says how
 * much to feed (% of biomass per day), in how many meals, and pellet size.
 */

export type FeedBand = {
  minAbwG: number
  /** % of standing biomass per day. */
  bodyWeightPct: number
  feedingsPerDay: number
  /** Pellet / crumble size in mm. */
  pelletMm: number
}

export const RATION_LIMITS = {
  bandsPerTable: 20,
  maxBodyWeightPct: 30,
  maxFeedingsPerDay: 24,
  maxPelletMm: 30,
  maxAbwG: 20_000,
  nameLength: 80,
} as const

/**
 * Built-in tables. Typical commercial-feed charts for warm-water grow-out;
 * farms adjust them for their feed, water temperature and appetite.
 */
const TILAPIA: FeedBand[] = [
  { minAbwG: 0, bodyWeightPct: 10, feedingsPerDay: 6, pelletMm: 0.8 },
  { minAbwG: 5, bodyWeightPct: 6, feedingsPerDay: 5, pelletMm: 1.5 },
  { minAbwG: 20, bodyWeightPct: 4, feedingsPerDay: 4, pelletMm: 2 },
  { minAbwG: 50, bodyWeightPct: 3, feedingsPerDay: 3, pelletMm: 3 },
  { minAbwG: 100, bodyWeightPct: 2.5, feedingsPerDay: 3, pelletMm: 4 },
  { minAbwG: 250, bodyWeightPct: 1.8, feedingsPerDay: 2, pelletMm: 4.5 },
  { minAbwG: 450, bodyWeightPct: 1.2, feedingsPerDay: 2, pelletMm: 6 },
]

const CATFISH: FeedBand[] = [
  { minAbwG: 0, bodyWeightPct: 10, feedingsPerDay: 4, pelletMm: 0.8 },
  { minAbwG: 5, bodyWeightPct: 7, feedingsPerDay: 4, pelletMm: 1.5 },
  { minAbwG: 20, bodyWeightPct: 5, feedingsPerDay: 3, pelletMm: 2 },
  { minAbwG: 50, bodyWeightPct: 3.5, feedingsPerDay: 2, pelletMm: 3 },
  { minAbwG: 200, bodyWeightPct: 2.5, feedingsPerDay: 2, pelletMm: 4.5 },
  { minAbwG: 500, bodyWeightPct: 1.5, feedingsPerDay: 2, pelletMm: 6 },
]

/** Species key (lib/species DEFAULT_SPECIES, lib/fishSpecies) → built-in table. */
export const DEFAULT_FEED_TABLES: Record<string, { name: string; bands: FeedBand[] }> = {
  nile_tilapia: { name: 'Tilapia grow-out', bands: TILAPIA },
  red_tilapia: { name: 'Tilapia grow-out', bands: TILAPIA },
  african_catfish: { name: 'Catfish grow-out', bands: CATFISH },
}

export const SPECIES_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

/** Problems with a table as it would be stored; [] when valid. */
export function bandProblems(bands: FeedBand[]): string[] {
  const out: string[] = []
  if (!bands.length) return ['Add at least one size band']
  if (bands.length > RATION_LIMITS.bandsPerTable) out.push(`At most ${RATION_LIMITS.bandsPerTable} size bands`)
  if (bands[0].minAbwG !== 0) out.push('The first band starts at 0 g')
  bands.forEach((b, i) => {
    const n = i + 1
    const finite = [b.minAbwG, b.bodyWeightPct, b.feedingsPerDay, b.pelletMm].every(Number.isFinite)
    if (!finite) {
      out.push(`Band ${n}: every value must be a number`)
      return
    }
    if (b.minAbwG < 0 || b.minAbwG > RATION_LIMITS.maxAbwG) out.push(`Band ${n}: start weight is between 0 and ${RATION_LIMITS.maxAbwG} g`)
    if (i > 0 && b.minAbwG <= bands[i - 1].minAbwG) out.push(`Band ${n}: start weights must increase`)
    if (b.bodyWeightPct <= 0 || b.bodyWeightPct > RATION_LIMITS.maxBodyWeightPct) {
      out.push(`Band ${n}: % body weight is above 0 and at most ${RATION_LIMITS.maxBodyWeightPct}`)
    }
    if (!Number.isInteger(b.feedingsPerDay) || b.feedingsPerDay < 1 || b.feedingsPerDay > RATION_LIMITS.maxFeedingsPerDay) {
      out.push(`Band ${n}: feedings per day is a whole number from 1 to ${RATION_LIMITS.maxFeedingsPerDay}`)
    }
    if (b.pelletMm <= 0 || b.pelletMm > RATION_LIMITS.maxPelletMm) out.push(`Band ${n}: pellet size is above 0 and at most ${RATION_LIMITS.maxPelletMm} mm`)
  })
  return out
}

/** The band an ABW falls in (bands sorted by minAbwG), or null. */
export function bandFor(bands: FeedBand[], abwG: number): { band: FeedBand; index: number; maxAbwG: number | null } | null {
  if (!Number.isFinite(abwG) || abwG < 0 || !bands.length) return null
  let index = -1
  for (let i = 0; i < bands.length; i++) if (abwG >= bands[i].minAbwG) index = i
  if (index < 0) return null
  return { band: bands[index], index, maxAbwG: bands[index + 1]?.minAbwG ?? null }
}

export type Ration =
  | {
      ok: true
      biomassKg: number
      kgPerDay: number
      kgPerFeeding: number
      feedingsPerDay: number
      pelletMm: number
      bodyWeightPct: number
      bandIndex: number
      bandMinAbwG: number
      bandMaxAbwG: number | null
    }
  | { ok: false; reason: 'no_fish' | 'no_abw' | 'no_plan' }

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places

/** Suggested ration for `count` fish of `abwG` grams with a feed table. */
export function rationFor(args: { count: number | null | undefined; abwG: number | null | undefined; bands: FeedBand[] | null | undefined }): Ration {
  const { count, abwG, bands } = args
  if (!count || count <= 0) return { ok: false, reason: 'no_fish' }
  if (abwG == null || !(abwG > 0)) return { ok: false, reason: 'no_abw' }
  const hit = bands ? bandFor(bands, abwG) : null
  if (!hit) return { ok: false, reason: 'no_plan' }
  const biomassKg = (count * abwG) / 1000
  const kgPerDay = (biomassKg * hit.band.bodyWeightPct) / 100
  return {
    ok: true,
    biomassKg: round(biomassKg, 1),
    kgPerDay: round(kgPerDay, 1),
    kgPerFeeding: round(kgPerDay / hit.band.feedingsPerDay, 2),
    feedingsPerDay: hit.band.feedingsPerDay,
    pelletMm: hit.band.pelletMm,
    bodyWeightPct: hit.band.bodyWeightPct,
    bandIndex: hit.index,
    bandMinAbwG: hit.band.minAbwG,
    bandMaxAbwG: hit.maxAbwG,
  }
}

// ---------------------------------------------------------------------------
// Feeding recommendation (AI-002): biomass × feed rate by size and water
// temperature, with the reasons spelled out. A suggestion only: nothing here
// writes feed records, and the UI never fills the feed input with it.
// ---------------------------------------------------------------------------

/** A temperature band: from `minC` (inclusive) up to the next band; factor × the table's %BW. */
export type TempBand = { minC: number; factor: number }

/**
 * Appetite by water temperature for warm-water species: 1 in the optimal
 * range, lower when colder or hotter (tilapia stop eating below ~15 °C).
 * Typical extension-service charts; farms adjust the %BW tables themselves.
 */
export const TEMPERATURE_FACTORS: Record<'tilapia' | 'catfish', TempBand[]> = {
  tilapia: [
    { minC: -Infinity, factor: 0 },
    { minC: 15, factor: 0.3 },
    { minC: 20, factor: 0.5 },
    { minC: 22, factor: 0.7 },
    { minC: 24, factor: 0.85 },
    { minC: 26, factor: 1 },
    { minC: 30, factor: 0.9 },
    { minC: 32, factor: 0.7 },
    { minC: 34, factor: 0.4 },
  ],
  catfish: [
    { minC: -Infinity, factor: 0.2 },
    { minC: 18, factor: 0.5 },
    { minC: 22, factor: 0.8 },
    { minC: 25, factor: 1 },
    { minC: 32, factor: 0.8 },
    { minC: 34, factor: 0.5 },
  ],
}

export function temperatureGroup(speciesKey: string | null | undefined): 'tilapia' | 'catfish' {
  return /catfish|clarias|heterobranchus/i.test(speciesKey ?? '') ? 'catfish' : 'tilapia'
}

/** Appetite factor at `tempC` (1 when unknown). */
export function temperatureFactor(speciesKey: string | null | undefined, tempC: number | null | undefined): number {
  if (tempC == null || !Number.isFinite(tempC)) return 1
  const bands = TEMPERATURE_FACTORS[temperatureGroup(speciesKey)]
  let f = bands[0].factor
  for (const b of bands) if (tempC >= b.minC) f = b.factor
  return f
}

/** Ledger fish flows of an occupancy (batchStats kpis). */
export type CountFlows = {
  stocked: number
  transferredIn: number
  transferredOut: number
  harvested: number
  mortality: number
  unaccounted: number
}

/** Estimated live fish: stocked + transfers in − transfers out − harvested − deaths − unaccounted. */
export function liveCount(f: CountFlows): number {
  return Math.max(0, f.stocked + f.transferredIn - f.transferredOut - f.harvested - f.mortality - f.unaccounted)
}

export type Recommendation =
  | (Extract<Ration, { ok: true }> & {
      /** %BW from the feed table before the temperature factor. */
      tablePct: number
      tempFactor: number
      tempC: number | null
    })
  | Extract<Ration, { ok: false }>

/** Daily ration from count, ABW, the species' table and water temperature. */
export function recommendRation(args: {
  count: number | null | undefined
  abwG: number | null | undefined
  bands: FeedBand[] | null | undefined
  speciesKey?: string | null
  tempC?: number | null
}): Recommendation {
  const base = rationFor(args)
  if (!base.ok) return base
  const tempC = args.tempC != null && Number.isFinite(args.tempC) ? args.tempC : null
  const tempFactor = temperatureFactor(args.speciesKey, tempC)
  const pct = round(base.bodyWeightPct * tempFactor, 2)
  const biomassKg = ((args.count as number) * (args.abwG as number)) / 1000
  const kgPerDay = (biomassKg * pct) / 100
  return {
    ...base,
    bodyWeightPct: pct,
    kgPerDay: round(kgPerDay, 1),
    kgPerFeeding: round(kgPerDay / base.feedingsPerDay, 2),
    tablePct: base.bodyWeightPct,
    tempFactor,
    tempC,
  }
}

const fmt = (x: number, lang: 'en' | 'fr', dp = 1) =>
  Number(x).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: dp })

/**
 * The reasons behind a recommendation, one sentence, in EN or FR, e.g.
 * "ABW 180 g (sampled 2026-11-02), 9,420 fish, 28 °C → 2.5% BW → 42.4 kg/day,
 * split in 3 meals of 14.13 kg."
 */
export function rationReasons(
  r: Recommendation,
  ctx: { count: number; abwG: number; abwMeasuredOn?: string | null; tempSource?: 'sensor' | 'manual' | null },
  lang: 'en' | 'fr' = 'en',
): string {
  if (!r.ok) return ''
  const fr = lang === 'fr'
  const abw = `${fr ? 'PMI' : 'ABW'} ${fmt(ctx.abwG, lang)} g` +
    (ctx.abwMeasuredOn ? (fr ? ` (échantillon du ${ctx.abwMeasuredOn})` : ` (sampled ${ctx.abwMeasuredOn})`) : '')
  const fish = `${fmt(ctx.count, lang, 0)} ${fr ? 'poissons' : 'fish'}`
  const temp =
    r.tempC == null
      ? fr
        ? 'température inconnue'
        : 'no water temperature'
      : `${fmt(r.tempC, lang)} °C${ctx.tempSource === 'sensor' ? (fr ? ' (capteur)' : ' (sensor)') : ''}`
  const p = (x: number) => (fr ? `${fmt(x, lang, 2)} %` : `${fmt(x, lang, 2)}%`)
  const pct =
    r.tempFactor === 1
      ? `${p(r.bodyWeightPct)} ${fr ? 'PV' : 'BW'}`
      : `${p(r.tablePct)} × ${fmt(r.tempFactor, lang, 2)} = ${p(r.bodyWeightPct)} ${fr ? 'PV' : 'BW'}`
  const split = fr
    ? `en ${r.feedingsPerDay} repas de ${fmt(r.kgPerFeeding, lang, 2)} kg`
    : `split in ${r.feedingsPerDay} meals of ${fmt(r.kgPerFeeding, lang, 2)} kg`
  const line = `${abw}, ${fish}, ${temp} → ${pct} → ${fmt(r.kgPerDay, lang)} kg/${fr ? 'jour' : 'day'}, ${split}.`
  return r.kgPerDay === 0 && r.tempC != null
    ? `${line} ${fr ? "Trop froid pour nourrir : attendre que l'eau se réchauffe." : 'Too cold to feed: wait for the water to warm up.'}`
    : line
}
