/**
 * Sensor analytics (ANLY-006): pure helpers over `sensorReadings` (INT-007).
 * Buckets for charts, min/max/avg rollups and threshold breach counts. The
 * Convex queries are in convex/sensorAnalytics.ts.
 */
import type { Range } from './waterQuality'

/** Parameters whose breaches notify people (doc 09 §8): oxygen, temperature, pH, ammonia. */
export const ALERT_PARAMETERS = ['dissolved_oxygen', 'temperature_c', 'ph', 'ammonia'] as const

export type Point = { value: number; measuredAt: number }
export type Stats = { count: number; min: number; max: number; avg: number; last: number; lastAt: number }
export type Bucket = { t: number; min: number; max: number; avg: number; count: number }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** Chart bucket sizes, smallest first. */
export const BUCKET_SIZES = [MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR]

/** Smallest bucket that keeps the chart at or under `target` points. */
export function pickBucketMs(spanMs: number, target = 240): number {
  for (const size of BUCKET_SIZES) if (spanMs / size <= target) return size
  return BUCKET_SIZES[BUCKET_SIZES.length - 1]
}

export function stats(points: Point[]): Stats | null {
  let count = 0
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let last = 0
  let lastAt = -Infinity
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue
    count += 1
    sum += p.value
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
    if (p.measuredAt >= lastAt) {
      lastAt = p.measuredAt
      last = p.value
    }
  }
  if (!count) return null
  return { count, min, max, avg: round(sum / count), last, lastAt }
}

/** Min/max/avg per time bucket, oldest first. Empty buckets are left out. */
export function bucketize(points: Point[], bucketMs: number): Bucket[] {
  const map = new Map<number, { min: number; max: number; sum: number; count: number }>()
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue
    const t = Math.floor(p.measuredAt / bucketMs) * bucketMs
    const b = map.get(t)
    if (!b) map.set(t, { min: p.value, max: p.value, sum: p.value, count: 1 })
    else {
      b.min = Math.min(b.min, p.value)
      b.max = Math.max(b.max, p.value)
      b.sum += p.value
      b.count += 1
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, min: b.min, max: b.max, avg: round(b.sum / b.count), count: b.count }))
}

/** Readings below the minimum and above the maximum. */
export function breachCounts(points: Point[], range: Range | undefined): { low: number; high: number } {
  let low = 0
  let high = 0
  if (!range) return { low, high }
  for (const p of points) {
    if (range.min != null && p.value < range.min) low += 1
    else if (range.max != null && p.value > range.max) high += 1
  }
  return { low, high }
}

/**
 * The value of a batch that is furthest outside the range (the worst one),
 * else the latest. Used so a batch with one bad minute still alerts.
 */
export function worstValue(points: Point[], range: Range | undefined): number | undefined {
  let worst: number | undefined
  let worstGap = 0
  let latest: Point | undefined
  for (const p of points) {
    if (!latest || p.measuredAt >= latest.measuredAt) latest = p
    const gap = !range
      ? 0
      : range.min != null && p.value < range.min
        ? range.min - p.value
        : range.max != null && p.value > range.max
          ? p.value - range.max
          : 0
    if (gap > worstGap) {
      worstGap = gap
      worst = p.value
    }
  }
  return worst ?? latest?.value
}

function round(n: number) {
  return Math.round(n * 1000) / 1000
}
