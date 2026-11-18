/**
 * Sensor ingestion rules (INT-007): parameter catalog, ranges and per-reading
 * validation with Effect Schema (D-019). Pure: `now` is passed in.
 */
import * as Exit from 'effect/Exit'
import * as Schema from 'effect/Schema'

export const SENSOR_PARAMETERS = {
  dissolved_oxygen: { label: 'Dissolved oxygen', unit: 'mg/L', min: 0, max: 30 },
  temperature_c: { label: 'Water temperature', unit: '°C', min: -5, max: 50 },
  ph: { label: 'pH', unit: '', min: 0, max: 14 },
  ammonia: { label: 'Ammonia (TAN)', unit: 'mg/L', min: 0, max: 100 },
  nitrite: { label: 'Nitrite', unit: 'mg/L', min: 0, max: 100 },
  salinity: { label: 'Salinity', unit: 'ppt', min: 0, max: 60 },
  turbidity: { label: 'Turbidity', unit: 'NTU', min: 0, max: 5000 },
  secchi_cm: { label: 'Secchi depth', unit: 'cm', min: 0, max: 1000 },
  conductivity: { label: 'Conductivity', unit: 'µS/cm', min: 0, max: 100000 },
} as const

export type SensorParameter = keyof typeof SENSOR_PARAMETERS

export const MAX_READINGS_PER_BATCH = 500
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const MAX_FUTURE_MS = 5 * 60 * 1000

export const RawReading = Schema.Struct({
  deviceId: Schema.String,
  parameter: Schema.String,
  value: Schema.Number,
  /** ISO 8601 string or epoch milliseconds. */
  measuredAt: Schema.Union([Schema.String, Schema.Number]),
  cageId: Schema.optional(Schema.String),
  siteId: Schema.optional(Schema.String),
})

export const ReadingsBody = Schema.Struct({ readings: Schema.Array(Schema.Unknown) })

export type CleanReading = {
  deviceId: string
  parameter: SensorParameter
  value: number
  measuredAt: number
  cageId?: string
  siteId?: string
}

/** A checked reading, or the reason it was refused. */
export function checkReading(raw: unknown, now: number): { ok: true; reading: CleanReading } | { ok: false; reason: string } {
  const exit = Schema.decodeUnknownExit(RawReading)(raw)
  if (Exit.isFailure(exit)) {
    return { ok: false, reason: 'Needs deviceId, parameter, value (number) and measuredAt' }
  }
  const r = exit.value
  const deviceId = r.deviceId.trim()
  if (!deviceId || deviceId.length > 100) return { ok: false, reason: 'deviceId must be 1–100 characters' }
  if (!Object.prototype.hasOwnProperty.call(SENSOR_PARAMETERS, r.parameter)) {
    return { ok: false, reason: `Unknown parameter "${String(r.parameter).slice(0, 40)}"` }
  }
  const parameter = r.parameter as SensorParameter
  const spec = SENSOR_PARAMETERS[parameter]
  if (!Number.isFinite(r.value) || r.value < spec.min || r.value > spec.max) {
    return { ok: false, reason: `${spec.label} must be between ${spec.min} and ${spec.max}` }
  }
  const measuredAt = typeof r.measuredAt === 'number' ? r.measuredAt : Date.parse(r.measuredAt)
  if (!Number.isFinite(measuredAt)) return { ok: false, reason: 'measuredAt is not a valid time' }
  if (measuredAt > now + MAX_FUTURE_MS) return { ok: false, reason: 'measuredAt is in the future' }
  if (measuredAt < now - MAX_AGE_MS) return { ok: false, reason: 'measuredAt is older than 90 days' }
  return {
    ok: true,
    reading: {
      deviceId,
      parameter,
      value: r.value,
      measuredAt: Math.round(measuredAt),
      cageId: r.cageId || undefined,
      siteId: r.siteId || undefined,
    },
  }
}
