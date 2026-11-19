import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { unitTypeOf } from './lib/farmRules'
import { SENSOR_PARAMETERS } from './integrations/sensorLogic'
import { effectiveThresholds, SENSOR_TO_FIELD, type Range, type ThresholdOverride } from './lib/waterQuality'
import { ALERT_PARAMETERS, breachCounts, bucketize, pickBucketMs, stats, type Point } from './lib/sensorAnalytics'
import { overridesFor } from './waterQuality'

/**
 * Sensor analytics (ANLY-006) over `sensorReadings` (INT-007): a time series
 * per unit and parameter (min/max/avg per bucket) and a site rollup with
 * threshold breach counts. `production.view`, company and site scoped.
 * Reads are bounded: a long or busy window is flagged `truncated`.
 */

const DAY = 24 * 60 * 60 * 1000
const MAX_SPAN_MS = 92 * DAY
/** Raw readings one series reads (newest first when cut). */
const MAX_SERIES_READINGS = 8000
/** Raw readings the rollup reads across the company. */
const MAX_SUMMARY_READINGS = 8000

function checkWindow(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw userError('VALIDATION', 'Choose a valid time range')
  if (to - from > MAX_SPAN_MS) throw userError('VALIDATION', 'The time range can be at most 92 days')
}

function canSeeUnit(m: MemberContext, unit: Doc<'cages'> | null): unit is Doc<'cages'> {
  if (!unit || !m.companyId || unit.companyId !== m.companyId) return false
  if (m.siteScope === 'all' || !unit.locationId) return true
  return m.siteScope.has(unit.locationId)
}

function parameterMeta(parameter: string) {
  const spec = SENSOR_PARAMETERS[parameter as keyof typeof SENSOR_PARAMETERS]
  return spec ? { label: spec.label, unit: spec.unit } : { label: parameter, unit: '' }
}

function rangeFor(unit: Doc<'cages'>, parameter: string, overrides: ThresholdOverride[]): Range | undefined {
  const field = SENSOR_TO_FIELD[parameter]
  return field ? effectiveThresholds(unitTypeOf(unit), overrides)[field] : undefined
}

/** One unit and parameter over a window, bucketed for a chart. */
export const series = query({
  args: { unitId: v.id('cages'), parameter: v.string(), from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    checkWindow(args.from, args.to)
    if (!(args.parameter in SENSOR_PARAMETERS)) throw userError('VALIDATION', 'Unknown sensor parameter')
    const unit = await ctx.db.get(args.unitId)
    if (!canSeeUnit(m, unit)) return null
    const rows = await ctx.db
      .query('sensorReadings')
      .withIndex('by_cageId_and_parameter_and_measuredAt', (q) =>
        q.eq('cageId', unit._id).eq('parameter', args.parameter).gte('measuredAt', args.from).lte('measuredAt', args.to),
      )
      .order('desc')
      .take(MAX_SERIES_READINGS + 1)
    const truncated = rows.length > MAX_SERIES_READINGS
    const points: Point[] = rows.slice(0, MAX_SERIES_READINGS).map((r) => ({ value: r.value, measuredAt: r.measuredAt }))
    const range = rangeFor(unit, args.parameter, await overridesFor(ctx, m.companyId!))
    const bucketMs = pickBucketMs(args.to - args.from)
    return {
      unitId: unit._id,
      unitName: unit.name,
      unitType: unitTypeOf(unit),
      parameter: args.parameter,
      ...parameterMeta(args.parameter),
      range: range ?? null,
      bucketMs,
      buckets: bucketize(points, bucketMs),
      stats: stats(points),
      breaches: breachCounts(points, range),
      truncated,
    }
  },
})

type SummaryRow = {
  unitId: Id<'cages'>
  unitName: string
  locationId: Id<'farmLocations'> | null
  parameter: string
  label: string
  unit: string
  alert: boolean
  count: number
  min: number
  max: number
  avg: number
  last: number
  lastAt: number
  range: Range | null
  low: number
  high: number
}

/** Min/max/avg and breaches per unit and parameter for a window (optionally one site). */
export const summary = query({
  args: { from: v.number(), to: v.number(), locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.view', locationId: args.locationId })
    checkWindow(args.from, args.to)
    if (!m.companyId) return { rows: [] as SummaryRow[], truncated: false, units: 0, breachingUnits: 0 }
    const companyId = m.companyId
    const readings = await ctx.db
      .query('sensorReadings')
      .withIndex('by_companyId_and_measuredAt', (q) =>
        q.eq('companyId', companyId).gte('measuredAt', args.from).lte('measuredAt', args.to),
      )
      .order('desc')
      .take(MAX_SUMMARY_READINGS + 1)
    const truncated = readings.length > MAX_SUMMARY_READINGS
    const units = new Map<string, Doc<'cages'> | null>()
    const groups = new Map<string, { unit: Doc<'cages'>; parameter: string; points: Point[] }>()
    for (const r of readings.slice(0, MAX_SUMMARY_READINGS)) {
      if (!r.cageId) continue
      if (args.locationId && r.locationId !== args.locationId) continue
      const key = String(r.cageId)
      if (!units.has(key)) {
        const unit = await ctx.db.get(r.cageId)
        units.set(key, canSeeUnit(m, unit) ? unit : null)
      }
      const unit = units.get(key)
      if (!unit) continue
      const g = `${key}:${r.parameter}`
      const group = groups.get(g) ?? { unit, parameter: r.parameter, points: [] }
      group.points.push({ value: r.value, measuredAt: r.measuredAt })
      groups.set(g, group)
    }
    const overrides = await overridesFor(ctx, companyId)
    const rows: SummaryRow[] = []
    for (const { unit, parameter, points } of groups.values()) {
      const s = stats(points)
      if (!s) continue
      const range = rangeFor(unit, parameter, overrides)
      rows.push({
        unitId: unit._id,
        unitName: unit.name,
        locationId: unit.locationId ?? null,
        parameter,
        ...parameterMeta(parameter),
        alert: (ALERT_PARAMETERS as readonly string[]).includes(parameter),
        ...s,
        range: range ?? null,
        ...breachCounts(points, range),
      })
    }
    rows.sort((a, b) => a.unitName.localeCompare(b.unitName) || a.parameter.localeCompare(b.parameter))
    const unitIds = new Set(rows.map((r) => String(r.unitId)))
    const breaching = new Set(rows.filter((r) => r.alert && r.low + r.high > 0).map((r) => String(r.unitId)))
    return { rows, truncated, units: unitIds.size, breachingUnits: breaching.size }
  },
})
