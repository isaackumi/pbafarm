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
