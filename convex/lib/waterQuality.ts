/**
 * Water-quality parameters, default thresholds by unit type and breach
 * evaluation (Phase 6: POND-002, RAS-001, PROD-014 context). Pure.
 *
 * Readings are wide rows (one field per parameter) in `waterQualityReadings`;
 * sensor readings stay in `sensorReadings` (one row per parameter) and map to
 * the same fields through SENSOR_TO_FIELD.
 */
import type { UnitType } from './farmRules'

export const WQ_PARAMETERS = {
  dissolvedOxygen: { label: 'Dissolved oxygen', short: 'DO', unit: 'mg/L', min: 0, max: 30 },
  temperatureC: { label: 'Water temperature', short: 'Temp', unit: '°C', min: -5, max: 50 },
  ph: { label: 'pH', short: 'pH', unit: '', min: 0, max: 14 },
  ammonia: { label: 'Ammonia (TAN)', short: 'NH₃/NH₄', unit: 'mg/L', min: 0, max: 100 },
  nitrite: { label: 'Nitrite', short: 'NO₂', unit: 'mg/L', min: 0, max: 100 },
  nitrate: { label: 'Nitrate', short: 'NO₃', unit: 'mg/L', min: 0, max: 1000 },
  salinity: { label: 'Salinity', short: 'Sal', unit: 'ppt', min: 0, max: 60 },
  turbidityNtu: { label: 'Turbidity', short: 'Turb', unit: 'NTU', min: 0, max: 5000 },
  secchiCm: { label: 'Secchi depth', short: 'Secchi', unit: 'cm', min: 0, max: 1000 },
  alkalinity: { label: 'Alkalinity', short: 'Alk', unit: 'mg/L CaCO₃', min: 0, max: 1000 },
  co2: { label: 'Carbon dioxide', short: 'CO₂', unit: 'mg/L', min: 0, max: 200 },
} as const

export type WqParameter = keyof typeof WQ_PARAMETERS
export const WQ_KEYS = Object.keys(WQ_PARAMETERS) as WqParameter[]

/** sensorReadings.parameter → reading field. */
export const SENSOR_TO_FIELD: Record<string, WqParameter> = {
  dissolved_oxygen: 'dissolvedOxygen',
  temperature_c: 'temperatureC',
  ph: 'ph',
  ammonia: 'ammonia',
  nitrite: 'nitrite',
  salinity: 'salinity',
  turbidity: 'turbidityNtu',
  secchi_cm: 'secchiCm',
}

export type Range = { min?: number; max?: number }
export type Thresholds = Partial<Record<WqParameter, Range>>

/**
 * Defaults for warm-water finfish (tilapia, catfish). RAS tanks run tighter
 * on oxygen and tolerate more nitrate; ponds expect a green bloom (Secchi
 * 25–45 cm). Organizations override any of these per unit type.
 */
const BASE: Thresholds = {
  dissolvedOxygen: { min: 4 },
  temperatureC: { min: 22, max: 32 },
  ph: { min: 6.5, max: 9 },
  ammonia: { max: 1 },
  nitrite: { max: 0.5 },
}

export const DEFAULT_THRESHOLDS: Record<UnitType, Thresholds> = {
  cage: { ...BASE },
  pond: { ...BASE, dissolvedOxygen: { min: 3 }, secchiCm: { min: 25, max: 45 } },
  tank: { ...BASE, dissolvedOxygen: { min: 5 }, nitrate: { max: 150 }, co2: { max: 20 }, alkalinity: { min: 50 } },
  raceway: { ...BASE, dissolvedOxygen: { min: 5 }, nitrate: { max: 150 } },
  hatchery_tank: { ...BASE, dissolvedOxygen: { min: 5 }, ammonia: { max: 0.5 }, nitrite: { max: 0.2 } },
  incubator: { ...BASE, dissolvedOxygen: { min: 6 }, ammonia: { max: 0.5 }, nitrite: { max: 0.2 } },
  hapa: { ...BASE },
}

export type ThresholdOverride = {
  unitType: UnitType | 'all'
  parameter: string
  min?: number | null
  max?: number | null
}

/**
 * Effective thresholds for a unit type: the default, then the org's 'all'
 * overrides, then its overrides for this type (most specific wins). An
 * override with neither min nor max turns the parameter's alert off.
 */
export function effectiveThresholds(unitType: UnitType, overrides: ThresholdOverride[]): Thresholds {
  const out: Thresholds = {}
  for (const [k, r] of Object.entries(DEFAULT_THRESHOLDS[unitType] ?? BASE)) out[k as WqParameter] = { ...r }
  for (const scope of ['all', unitType] as const) {
    for (const o of overrides) {
      if (o.unitType !== scope || !(o.parameter in WQ_PARAMETERS)) continue
      const range: Range = {}
      if (o.min != null) range.min = o.min
      if (o.max != null) range.max = o.max
      if (range.min === undefined && range.max === undefined) delete out[o.parameter as WqParameter]
      else out[o.parameter as WqParameter] = range
    }
  }
  return out
}

export type Breach = {
  parameter: WqParameter
  label: string
  value: number
  unit: string
  direction: 'low' | 'high'
  limit: number
}

export type WqValues = Partial<Record<WqParameter, number | undefined | null>>

/** Parameters outside their range. */
export function evaluateBreaches(values: WqValues, thresholds: Thresholds): Breach[] {
  const out: Breach[] = []
  for (const key of WQ_KEYS) {
    const value = values[key]
    const range = thresholds[key]
    if (value == null || !Number.isFinite(value) || !range) continue
    const spec = WQ_PARAMETERS[key]
    if (range.min != null && value < range.min) {
      out.push({ parameter: key, label: spec.label, value, unit: spec.unit, direction: 'low', limit: range.min })
    } else if (range.max != null && value > range.max) {
      out.push({ parameter: key, label: spec.label, value, unit: spec.unit, direction: 'high', limit: range.max })
    }
  }
  return out
}

/** "DO 2.8 mg/L (min 4); pH 9.4 (max 9)" */
export function breachSummary(breaches: Breach[]): string {
  return breaches
    .map((b) => {
      const spec = WQ_PARAMETERS[b.parameter]
      return `${spec.short} ${b.value}${b.unit ? ` ${b.unit}` : ''} (${b.direction === 'low' ? 'min' : 'max'} ${b.limit})`
    })
    .join('; ')
}

/** Refuse values outside the physically possible range; returns the cleaned values. */
export function checkValues(values: WqValues): Partial<Record<WqParameter, number>> {
  const out: Partial<Record<WqParameter, number>> = {}
  for (const key of WQ_KEYS) {
    const v = values[key]
    if (v == null) continue
    const spec = WQ_PARAMETERS[key]
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
      throw new Error(`${spec.label} must be between ${spec.min} and ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}`)
    }
    out[key] = v
  }
  if (Object.keys(out).length === 0) throw new Error('Enter at least one water-quality value')
  return out
}
