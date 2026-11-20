/**
 * Charts in Ask Anowa answers. A chart is data the server produced from the
 * member's own records (a read tool's result); the model can only point at
 * one by its id (attachChart), never write points itself. Every chart is
 * checked against this schema before it is shown or saved: line, bar or area,
 * at most MAX_CHART_SERIES series of at most MAX_CHART_POINTS finite numbers,
 * short text everywhere. Pure (no ctx).
 */
import { v, type Infer } from 'convex/values'

export const MAX_CHART_POINTS = 200
export const MAX_CHART_SERIES = 4
/** Charts one answer may carry. */
export const MAX_CHARTS = 3
const MAX_TEXT = 80
const MAX_X = 24

const point = v.object({
  x: v.string(),
  y: v.union(v.number(), v.null()),
  /** Band (forecast range) around y, when the series has one. */
  lo: v.optional(v.number()),
  hi: v.optional(v.number()),
})

export const answerChartValidator = v.object({
  type: v.union(v.literal('line'), v.literal('bar'), v.literal('area')),
  title: v.string(),
  /** What the x values are: dates (YYYY-MM-DD or YYYY-MM) or labels. */
  xKind: v.union(v.literal('date'), v.literal('category')),
  series: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      unit: v.string(),
      band: v.optional(v.boolean()),
      points: v.array(point),
    }),
  ),
  /** Where the numbers come from, e.g. "Samplings, C-07". */
  source: v.optional(v.string()),
})

export type AnswerChart = Infer<typeof answerChartValidator>
export type ChartPoint = Infer<typeof point>
export type ChartSeries = AnswerChart['series'][number]

const isText = (s: unknown, max = MAX_TEXT): s is string => typeof s === 'string' && s.length > 0 && s.length <= max
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e13
const SAFE_TEXT = /[<>\u0000-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/

/**
 * The chart when it passes the schema and the limits, else null. Unknown
 * fields are dropped, so a chart shape cannot smuggle anything else through.
 */
export function validateChart(raw: unknown): AnswerChart | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (c.type !== 'line' && c.type !== 'bar' && c.type !== 'area') return null
  if (c.xKind !== 'date' && c.xKind !== 'category') return null
  if (!isText(c.title) || SAFE_TEXT.test(c.title)) return null
  if (c.source !== undefined && (!isText(c.source, 120) || SAFE_TEXT.test(c.source))) return null
  if (!Array.isArray(c.series) || c.series.length === 0 || c.series.length > MAX_CHART_SERIES) return null
  const series: ChartSeries[] = []
  const keys = new Set<string>()
  for (const s of c.series as unknown[]) {
    if (!s || typeof s !== 'object') return null
    const r = s as Record<string, unknown>
    if (!isText(r.key, 24) || !/^[a-z][a-zA-Z0-9]*$/.test(r.key) || keys.has(r.key)) return null
    if (!isText(r.label) || SAFE_TEXT.test(r.label)) return null
    if (typeof r.unit !== 'string' || r.unit.length > 16 || SAFE_TEXT.test(r.unit)) return null
    if (r.band !== undefined && typeof r.band !== 'boolean') return null
    if (!Array.isArray(r.points) || r.points.length === 0 || r.points.length > MAX_CHART_POINTS) return null
    const points: ChartPoint[] = []
    for (const p of r.points as unknown[]) {
      if (!p || typeof p !== 'object') return null
      const q = p as Record<string, unknown>
      if (!isText(q.x, MAX_X) || SAFE_TEXT.test(q.x)) return null
      if (q.y !== null && !isNum(q.y)) return null
      if (q.lo !== undefined && !isNum(q.lo)) return null
      if (q.hi !== undefined && !isNum(q.hi)) return null
      points.push({
        x: q.x,
        y: q.y as number | null,
        ...(q.lo !== undefined ? { lo: q.lo as number } : {}),
        ...(q.hi !== undefined ? { hi: q.hi as number } : {}),
      })
    }
    keys.add(r.key)
    series.push({ key: r.key, label: r.label, unit: r.unit, ...(r.band ? { band: true } : {}), points })
  }
  return {
    type: c.type,
    title: c.title,
    xKind: c.xKind,
    series,
    ...(c.source !== undefined ? { source: c.source as string } : {}),
  }
}

/** At most `max` points, evenly spread, always keeping the first and last. */
export function capPoints<T>(xs: T[], max = MAX_CHART_POINTS): T[] {
  if (xs.length <= max) return xs
  const out: T[] = []
  const step = (xs.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(xs[Math.round(i * step)])
  return out
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const clip = (s: string, max = MAX_TEXT) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Build and check a chart; null when nothing is left to draw. */
function chart(c: AnswerChart): AnswerChart | null {
  const series = c.series
    .map((s) => ({ ...s, label: clip(s.label), points: capPoints(s.points) }))
    .filter((s) => s.points.some((p) => p.y !== null))
  if (!series.length) return null
  return validateChart({ ...c, title: clip(c.title), series })
}

// ── Builders (one per read tool that has a trend) ─────────────────────────

/** Growth forecast: expected ABW with its earliest-latest band. */
export function forecastChart(unit: string, band: { date: string; low: number; expected: number; high: number }[]) {
  return chart({
    type: 'area',
    title: `ABW forecast, ${unit}`,
    xKind: 'date',
    series: [
      {
        key: 'abw',
        label: 'Expected ABW',
        unit: 'g',
        band: true,
        points: band.map((p) => ({ x: p.date, y: r1(p.expected), lo: r1(p.low), hi: r1(p.high) })),
      },
    ],
    source: 'Growth forecast',
  })
}

/** Sampling ABW trend. */
export function abwChart(label: string, samples: { date: string; abwG: number | null }[]) {
  return chart({
    type: 'line',
    title: `ABW trend, ${label}`,
    xKind: 'date',
    series: [{ key: 'abw', label: 'ABW', unit: 'g', points: samples.map((s) => ({ x: s.date, y: s.abwG })) }],
    source: 'Samplings',
  })
}

/** Daily average DO and temperature from water readings. */
export function waterChart(unit: string, rows: { date: string; doMgL?: number | null; tempC?: number | null }[]) {
  const byDay = new Map<string, { do: number[]; t: number[] }>()
  for (const r of rows) {
    const d = byDay.get(r.date) ?? { do: [], t: [] }
    if (r.doMgL != null && Number.isFinite(r.doMgL)) d.do.push(r.doMgL)
    if (r.tempC != null && Number.isFinite(r.tempC)) d.t.push(r.tempC)
    byDay.set(r.date, d)
  }
  const days = [...byDay.keys()].sort()
  const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((s, x) => s + x, 0) / xs.length) : null)
  return chart({
    type: 'line',
    title: `Water quality, ${unit}`,
    xKind: 'date',
    series: [
      { key: 'do', label: 'Dissolved oxygen (daily avg)', unit: 'mg/L', points: days.map((d) => ({ x: d, y: avg(byDay.get(d)!.do) })) },
      { key: 'temp', label: 'Temperature (daily avg)', unit: '°C', points: days.map((d) => ({ x: d, y: avg(byDay.get(d)!.t) })) },
    ],
    source: 'Water readings',
  })
}

/** Week (Monday) or month bucket of a YYYY-MM-DD date. */
export function bucketOf(date: string, by: 'week' | 'month') {
  if (by === 'month') return date.slice(0, 7)
  const d = new Date(`${date}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/** Revenue, costs and profit per week (or month for long periods). */
export function moneyChart(
  from: string,
  to: string,
  currency: string | null,
  rows: { date: string; revenue?: number; cost?: number }[],
) {
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  const by = spanDays > 93 ? 'month' : 'week'
  const buckets = new Map<string, { revenue: number; cost: number }>()
  for (let d = from; d <= to; ) {
    const k = bucketOf(d, by)
    if (!buckets.has(k)) buckets.set(k, { revenue: 0, cost: 0 })
    const next = new Date(`${d}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + (by === 'month' ? 28 : 7))
    d = next.toISOString().slice(0, 10)
  }
  const last = bucketOf(to, by)
  if (!buckets.has(last)) buckets.set(last, { revenue: 0, cost: 0 })
  for (const r of rows) {
    const k = bucketOf(r.date, by)
    const b = buckets.get(k) ?? { revenue: 0, cost: 0 }
    b.revenue += r.revenue || 0
    b.cost += r.cost || 0
    buckets.set(k, b)
  }
  const keys = [...buckets.keys()].sort()
  const unit = (currency || '').slice(0, 8)
  return chart({
    type: 'bar',
    title: `Revenue and costs by ${by}`,
    xKind: by === 'month' ? 'category' : 'date',
    series: [
      { key: 'revenue', label: 'Revenue', unit, points: keys.map((k) => ({ x: k, y: r2(buckets.get(k)!.revenue) })) },
      { key: 'costs', label: 'Costs', unit, points: keys.map((k) => ({ x: k, y: r2(buckets.get(k)!.cost) })) },
      {
        key: 'profit',
        label: 'Profit',
        unit,
        points: keys.map((k) => ({ x: k, y: r2(buckets.get(k)!.revenue - buckets.get(k)!.cost) })),
      },
    ],
    source: 'Sales, expenses and feed at list price',
  })
}

/** Feed fed per day (kg). */
export function feedChart(rows: { date: string; feedKg: number }[], label = 'all units in scope') {
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + (r.feedKg || 0))
  const days = [...byDay.keys()].sort()
  return chart({
    type: 'area',
    title: `Feed used per day, ${label}`,
    xKind: 'date',
    series: [{ key: 'feed', label: 'Feed', unit: 'kg', points: days.map((d) => ({ x: d, y: r1(byDay.get(d)!) })) }],
    source: 'Daily records',
  })
}
