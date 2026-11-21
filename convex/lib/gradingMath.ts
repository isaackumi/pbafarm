/**
 * Grading math (Paper 52): sample-check statistics, size spread (CV) before
 * and after a grading, class weight bounds, biomass density after grading
 * and weeks to market. Pure: the grading page and convex/grading.ts share it.
 */
import { densityBasis, type DensityStatus, densityStatus } from './farmRules'

/** Draft and grading bounds: classes, weighing rounds per class, fish per round. */
export const GRADING_LIMITS = { classes: 20, rounds: 10, perRound: 200, graderBars: 40, reason: 1000 } as const

export type SampleStats = {
  /** Fish weighed. */
  n: number
  rounds: number
  /** Fish per round when every round weighed the same number, else null. */
  perRound: number | null
  mean: number
  /** Sample standard deviation (n − 1); 0 for a single fish. */
  sd: number
  /** sd ÷ mean × 100. */
  cvPct: number
  min: number
  max: number
}

/** Positive, finite weights of each round; empty rounds dropped. */
export function cleanRounds(rounds: ReadonlyArray<ReadonlyArray<number>> | null | undefined): number[][] {
  return (rounds ?? [])
    .map((r) => r.filter((w) => Number.isFinite(w) && w > 0))
    .filter((r) => r.length > 0)
}

/**
 * Weights typed as text: one weighing round per line, weights (g) separated
 * by spaces, commas or semicolons. Anything that is not a positive number is
 * ignored. A comma between digits with no space ("212,5") is a decimal comma.
 */
export function parseRounds(text: string): number[][] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/(\d),(\d)/g, '$1.$2')
        .split(/[\s,;]+/)
        .map((s) => Number(s))
        .filter((w) => Number.isFinite(w) && w > 0),
    )
    .filter((r) => r.length > 0)
}

/** The text form of rounds, for editing. */
export function formatRounds(rounds: ReadonlyArray<ReadonlyArray<number>> | null | undefined): string {
  return cleanRounds(rounds)
    .map((r) => r.join(' '))
    .join('\n')
}

/** Mean, spread and CV of the fish weighed for one class; null with no fish. */
export function sampleStats(rounds: ReadonlyArray<ReadonlyArray<number>> | null | undefined): SampleStats | null {
  const clean = cleanRounds(rounds)
  const all = clean.flat()
  const n = all.length
  if (n === 0) return null
  const mean = all.reduce((s, w) => s + w, 0) / n
  const sd = n > 1 ? Math.sqrt(all.reduce((s, w) => s + (w - mean) ** 2, 0) / (n - 1)) : 0
  const sizes = new Set(clean.map((r) => r.length))
  return {
    n,
    rounds: clean.length,
    perRound: sizes.size === 1 ? clean[0].length : null,
    mean,
    sd,
    cvPct: mean > 0 ? (sd / mean) * 100 : 0,
    min: Math.min(...all),
    max: Math.max(...all),
  }
}

export type GradedClass = { count: number; stats: SampleStats | null }

/**
 * Size spread before and after grading, from the sample check.
 * Before: the CV of all graded fish together, the count-weighted mixture of
 * the classes (each class's sample mean and spread scaled to its count).
 * After: the count-weighted mean of each class's own CV.
 * Null unless every class with fish has a sample of at least two fish.
 */
export function gradingCv(classes: ReadonlyArray<GradedClass>): { beforePct: number; afterPct: number } | null {
  const rows = classes.filter((c) => c.count > 0)
  if (rows.length === 0 || rows.some((c) => !c.stats || c.stats.n < 2)) return null
  const total = rows.reduce((s, c) => s + c.count, 0)
  const mean = rows.reduce((s, c) => s + c.count * c.stats!.mean, 0) / total
  const second = rows.reduce((s, c) => s + c.count * (c.stats!.sd ** 2 + c.stats!.mean ** 2), 0) / total
  const variance = Math.max(0, second - mean ** 2)
  if (!(mean > 0)) return null
  return {
    beforePct: (Math.sqrt(variance) / mean) * 100,
    afterPct: rows.reduce((s, c) => s + c.count * c.stats!.cvPct, 0) / total,
  }
}

const round10 = (g: number) => Math.round(g / 10) * 10

/**
 * Weight bounds between classes, heaviest first: a bound sits halfway
 * between the lightest fish weighed in the heavier class and the heaviest
 * in the lighter one (the class means when a class has no sample), rounded
 * to 10 g. `classes` is in display order; the result is keyed by index.
 * `above`: the class's fish weigh more than this (null for the lightest);
 * `below`: they weigh less (null for the heaviest). Classes without a
 * weight get no bounds.
 */
export function classBounds(
  classes: ReadonlyArray<{ abw: number | null; stats: SampleStats | null }>,
): Array<{ above: number | null; below: number | null }> {
  const out = classes.map(() => ({ above: null as number | null, below: null as number | null }))
  const order = classes
    .map((c, i) => ({ i, abw: c.abw, stats: c.stats }))
    .filter((c) => c.abw != null && c.abw > 0)
    .sort((a, b) => b.abw! - a.abw!)
  for (let k = 0; k < order.length - 1; k++) {
    const heavy = order[k]
    const light = order[k + 1]
    const lo = heavy.stats ? heavy.stats.min : heavy.abw!
    const hi = light.stats ? light.stats.max : light.abw!
    const bound = round10((lo + hi) / 2)
    out[heavy.i].above = bound
    out[light.i].below = bound
  }
  return out
}

/** Days to grow from `abwG` to `targetG` at a TGC and effective °C; null when it cannot. */
export function daysToTarget(abwG: number, targetG: number, tgc: number, effTempC: number): number | null {
  if (!(abwG > 0) || !(targetG > 0) || !(tgc > 0) || !(effTempC > 0)) return null
  if (abwG >= targetG) return 0
  const degreeDays = ((Math.cbrt(targetG) - Math.cbrt(abwG)) * 1000) / tgc
  return degreeDays / effTempC
}

/** Whole weeks (at least 1) to reach the target; 0 when already there; null when unknown. */
export function weeksToTarget(abwG: number, targetG: number, tgc: number, effTempC: number): number | null {
  const days = daysToTarget(abwG, targetG, tgc, effTempC)
  if (days == null) return null
  if (days === 0) return 0
  return Math.max(1, Math.round(days / 7))
}

export type DensityAfter = {
  unitId: string
  /** kg per m³ (or per m² for area-measured units); null without a size. */
  kgPer: number | null
  measure: 'area' | 'volume'
  /** The unit's fish-count density against its limit (farm rules). */
  fish: DensityStatus
}

/**
 * Density in each destination after grading: the fish and biomass graded
 * into it over its net volume, volume or area (farmRules.densityBasis).
 * Destinations take only graded fish: grading fills empty units and the
 * source unit, which the grading empties first.
 */
export function densityAfter(
  destinations: ReadonlyArray<{ unit: any; count: number; abwG: number }>,
  farmRules: Parameters<typeof densityBasis>[1],
): DensityAfter[] {
  return destinations.map((d) => {
    const basis = densityBasis(d.unit, farmRules)
    const kg = (d.count * d.abwG) / 1000
    return {
      unitId: String(d.unit?._id ?? d.unit?.id ?? ''),
      kgPer: basis.size ? kg / basis.size : null,
      measure: basis.measure,
      fish: densityStatus(d.unit, d.count, farmRules),
    }
  })
}
