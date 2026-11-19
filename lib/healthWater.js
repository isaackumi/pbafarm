/**
 * Pure helpers for Health & water (Paper 07): the latest reading per unit
 * checked against its unit type's thresholds, the 7-day dissolved-oxygen
 * trend from daily records, and which treatments count as active.
 */
import { addDays } from './format'

/** Columns of the water log, in Paper order. */
export const WATER_LOG_PARAMS = ['dissolvedOxygen', 'temperatureC', 'ph', 'ammonia', 'secchiCm']

export function unitTypeOf(unit) {
  return unit?.unitType || unit?.unit_type || 'cage'
}

/** 'low' | 'high' | null for one value against a `{ min, max }` range. */
export function breachOf(value, range) {
  if (value == null || !Number.isFinite(Number(value)) || !range) return null
  if (range.min != null && Number(value) < range.min) return 'low'
  if (range.max != null && Number(value) > range.max) return 'high'
  return null
}

/**
 * One row per unit: its latest reading and the parameters out of range.
 * Out-of-range units first, then by name.
 */
export function waterRows(units, latest, thresholdsByType = {}) {
  if (!units) return []
  const byUnit = new Map((latest || []).map((r) => [r.unitId, r]))
  return units
    .map((unit) => {
      const reading = byUnit.get(unit.id || unit._id) || null
      const limits = thresholdsByType[unitTypeOf(unit)] || {}
      const breaches = {}
      for (const [param, value] of Object.entries(reading?.values || {})) {
        const b = breachOf(value, limits[param])
        if (b) breaches[param] = b
      }
      const breachCount = Math.max(Object.keys(breaches).length, reading?.breachCount ?? 0)
      return { unit, reading, breaches, breachCount }
    })
    .sort(
      (a, b) =>
        b.breachCount - a.breachCount ||
        String(a.unit.name).localeCompare(String(b.unit.name), undefined, { numeric: true }),
    )
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const numbers = (xs) => xs.filter((x) => x != null && Number.isFinite(Number(x))).map(Number)

/** KPI figures over the latest reading of each unit. */
export function waterSummary(rows) {
  const withReading = rows.filter((r) => r.reading)
  const dos = numbers(withReading.map((r) => r.reading.values?.dissolvedOxygen))
  const temps = numbers(withReading.map((r) => r.reading.values?.temperatureC))
  return {
    avgDo: mean(dos),
    avgTemp: mean(temps),
    lowDoUnits: rows.filter((r) => r.breaches.dissolvedOxygen === 'low').length,
    logged: withReading.length,
    outOfRange: rows.filter((r) => r.breachCount > 0).length,
  }
}

/** The unit type most units share (its DO limit is the chart's threshold line). */
export function mainUnitType(units) {
  const counts = new Map()
  for (const u of units || []) counts.set(unitTypeOf(u), (counts.get(unitTypeOf(u)) || 0) + 1)
  let best = 'cage'
  let n = 0
  for (const [type, c] of counts) if (c > n) [best, n] = [type, c]
  return best
}

/**
 * Daily dissolved oxygen for the `days` days ending `today`: the average
 * over units and the lowest unit. Days without a reading are null.
 */
export function doTrend(records, today, days = 7) {
  const byDate = new Map()
  for (const r of records || []) {
    const v = Number(r.dissolved_oxygen)
    if (r.dissolved_oxygen == null || !Number.isFinite(v)) continue
    if (!byDate.has(r.date)) byDate.set(r.date, [])
    byDate.get(r.date).push(v)
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - (days - 1))
    const vals = byDate.get(date) || []
    return {
      date,
      avg: vals.length ? Math.round(mean(vals) * 100) / 100 : null,
      min: vals.length ? Math.min(...vals) : null,
    }
  })
}

/**
 * Active treatments: still in withdrawal on `today`, or given in the last
 * `recentDays` days. Withdrawals first (soonest end first), then newest.
 */
export function activeTreatments(treatments, today, recentDays = 7) {
  const since = addDays(today, -recentDays)
  return (treatments || [])
    .map((t) => ({ ...t, inWithdrawal: Boolean(t.withdrawal_until && t.withdrawal_until >= today) }))
    .filter((t) => t.inWithdrawal || t.date >= since)
    .sort(
      (a, b) =>
        Number(b.inWithdrawal) - Number(a.inWithdrawal) ||
        (a.inWithdrawal ? a.withdrawal_until.localeCompare(b.withdrawal_until) : b.date.localeCompare(a.date)),
    )
}

/** Units under a withdrawal hold and the last day of the longest one. */
export function withdrawalSummary(withdrawals) {
  const list = withdrawals || []
  const units = new Set(list.map((w) => w.cage_id))
  const lastUntil = list.reduce((m, w) => (w.withdrawal_until && w.withdrawal_until > m ? w.withdrawal_until : m), '')
  return { units: units.size, lastUntil: lastUntil || null }
}
