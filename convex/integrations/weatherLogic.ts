/**
 * Open-Meteo daily weather (INT-006). No API key; free for non-commercial
 * and low volume use (https://open-meteo.com). Effect program with timeout,
 * transient-only retry and a Schema check of the response (D-019).
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { requestJsonAs, type Fetch, type HttpError } from '../lib/effectHttp'

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

const nums = Schema.Array(Schema.NullOr(Schema.Number))

export const OpenMeteoDaily = Schema.Struct({
  daily: Schema.Struct({
    time: Schema.Array(Schema.String),
    temperature_2m_max: Schema.optional(nums),
    temperature_2m_min: Schema.optional(nums),
    precipitation_sum: Schema.optional(nums),
    wind_speed_10m_max: Schema.optional(nums),
    weather_code: Schema.optional(nums),
  }),
})

export type WeatherDay = {
  date: string
  tempMaxC?: number
  tempMinC?: number
  precipitationMm?: number
  windMaxKmh?: number
  weatherCode?: number
}

export class WeatherUnavailable extends Data.TaggedError('WeatherUnavailable')<{
  readonly message: string
}> {}

export function validCoordinates(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  )
}

export function weatherUrl(lat: number, lon: number, timezone?: string): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code',
    past_days: '1',
    forecast_days: '3',
    timezone: timezone || 'auto',
  })
  return `${OPEN_METEO_URL}?${p.toString()}`
}

const at = (arr: readonly (number | null)[] | undefined, i: number) => {
  const v = arr?.[i]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Fetch yesterday, today and the next two days for one site. */
export function fetchDailyWeather(
  lat: number,
  lon: number,
  timezone?: string,
): Effect.Effect<WeatherDay[], WeatherUnavailable, Fetch> {
  return requestJsonAs(OpenMeteoDaily, { url: weatherUrl(lat, lon, timezone) }, { timeoutMs: 10_000, retries: 2 }).pipe(
    Effect.map(({ daily }) =>
      daily.time.slice(0, 7).map((date, i) => ({
        date,
        tempMaxC: at(daily.temperature_2m_max, i),
        tempMinC: at(daily.temperature_2m_min, i),
        precipitationMm: at(daily.precipitation_sum, i),
        windMaxKmh: at(daily.wind_speed_10m_max, i),
        weatherCode: at(daily.weather_code, i),
      })),
    ),
    Effect.mapError((e: HttpError) => new WeatherUnavailable({ message: e.message })),
  )
}

/** Short words for a WMO code (https://open-meteo.com/en/docs, "WMO Weather interpretation codes"). */
export function weatherLabel(code: number | undefined): string {
  if (code === undefined) return ''
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Partly cloudy'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Rain showers'
  if (code <= 86) return 'Snow showers'
  return 'Thunderstorm'
}
