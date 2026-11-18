/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as Effect from 'effect/Effect'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { fetchLayer } from './lib/effectHttp'
import { fetchDailyWeather, validCoordinates, weatherLabel, weatherUrl } from './integrations/weatherLogic'
import { checkReading } from './integrations/sensorLogic'

const modules = import.meta.glob('./**/*.ts')

const OPEN_METEO_BODY = {
  daily: {
    time: ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'],
    temperature_2m_max: [31.2, 30.1, 29.5, null],
    temperature_2m_min: [23.4, 22.9, 22.1, 22],
    precipitation_sum: [0, 4.2, 12.5, 0],
    wind_speed_10m_max: [12, 14, 20, 9],
    weather_code: [1, 61, 95, 0],
  },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA = await ctx.db.insert('farmLocations', {
      companyId: companyA, name: 'Volta', active: true, updatedAt: now, latitude: 6.3, longitude: 0.06, timezone: 'Africa/Accra',
    })
    const siteNoCoords = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'Office', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', {
      companyId: companyB, name: 'B', active: true, updatedAt: now, latitude: 5.6, longitude: -0.2,
    })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', { name, status: 'active', companyId, locationId, updatedAt: now })
    const cageA = await cage('A1', companyA, siteA)
    const cageA2 = await cage('A2', companyA, siteNoCoords)
    const cageB = await cage('B1', companyB, siteB)
    return { companyA, companyB, siteA, siteNoCoords, siteB, adminA, staffA, adminB, cageA, cageA2, cageB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}

type S = Awaited<ReturnType<typeof setup>>

async function messageOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    return (err as Error).message
  }
  return 'resolved'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('weather logic', () => {
  test('coordinates and URL', () => {
    expect(validCoordinates(6.3, 0.06)).toBe(true)
    expect(validCoordinates(0, 0)).toBe(false)
    expect(validCoordinates(91, 0)).toBe(false)
    expect(validCoordinates(undefined, 1)).toBe(false)
    const url = new URL(weatherUrl(6.3, 0.06, 'Africa/Accra'))
    expect(url.searchParams.get('past_days')).toBe('1')
    expect(url.searchParams.get('timezone')).toBe('Africa/Accra')
    expect(weatherLabel(61)).toBe('Rain')
    expect(weatherLabel(undefined)).toBe('')
  })

  test('parses days, retries 5xx, reports bad bodies as unavailable', async () => {
    let calls = 0
    const flaky = fetchLayer(async () => {
      calls += 1
      return calls === 1 ? json({ error: true }, 503) : json(OPEN_METEO_BODY)
    })
    const days = await Effect.runPromise(fetchDailyWeather(6.3, 0.06).pipe(Effect.provide(flaky)))
    expect(calls).toBe(2)
    expect(days[1]).toMatchObject({ date: '2026-11-18', tempMaxC: 30.1, precipitationMm: 4.2, weatherCode: 61 })
    expect(days[3].tempMaxC).toBeUndefined()
    const bad = await Effect.runPromise(
      Effect.result(fetchDailyWeather(6.3, 0.06).pipe(Effect.provide(fetchLayer(async () => json({ nope: 1 }))))),
    )
    expect(bad._tag).toBe('Failure')
  })
})

describe('site weather', () => {
  test('cron stores days for sites with coordinates only', async () => {
    const s = await setup()
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return json(OPEN_METEO_BODY)
    }))
    const res = await s.t.action(internal.weather.refreshAll, {})
    expect(res).toEqual({ sites: 2, ok: 2 })
    expect(urls.every((u) => u.startsWith('https://api.open-meteo.com/v1/forecast?'))).toBe(true)
    const rows = await s.t.run((ctx) =>
      ctx.db.query('weatherObservations').withIndex('by_locationId_and_date', (q) => q.eq('locationId', s.siteA)).collect(),
    )
    expect(rows.map((r) => [r.date, r.isForecast])).toEqual([
      ['2026-11-17', false], ['2026-11-18', false], ['2026-11-19', true], ['2026-11-20', true],
    ])
    // A second run replaces, not duplicates.
    await s.t.action(internal.weather.refreshAll, {})
    expect(await s.t.run((ctx) => ctx.db.query('weatherObservations').collect())).toHaveLength(8)

    const view = await s.as(s.staffA).query(api.weather.forSites, { fromDate: '2026-11-18' })
    expect(view.sites.map((x) => x.name).sort()).toEqual(['Office', 'Volta'])
    const volta = view.sites.find((x) => x.name === 'Volta')!
    expect(volta.days.map((d) => d.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20'])
    expect(view.sites.find((x) => x.name === 'Office')!.hasCoordinates).toBe(false)
    const other = await s.as(s.adminB).query(api.weather.forSites, { fromDate: '2026-11-18' })
    expect(other.sites.map((x) => x.name)).toEqual(['B'])
  })

  test('a failing site does not stop the others', async () => {
    const s = await setup()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('latitude=6.3') ? json({}, 400) : json(OPEN_METEO_BODY))))
    expect(await s.t.action(internal.weather.refreshAll, {})).toEqual({ sites: 2, ok: 1 })
  })

  test('refresh now: admins only, needs coordinates, 30-minute cooldown', async () => {
    const s = await setup()
    vi.stubGlobal('fetch', vi.fn(async () => json(OPEN_METEO_BODY)))
    expect(await messageOf(s.as(s.staffA).action(api.weather.refreshSite, { locationId: s.siteA }))).toContain('Insufficient permissions')
    expect(await messageOf(s.as(s.adminA).action(api.weather.refreshSite, { locationId: s.siteNoCoords }))).toContain('latitude')
    expect(await messageOf(s.as(s.adminA).action(api.weather.refreshSite, { locationId: s.siteB }))).toContain('not found')
    expect(await s.as(s.adminA).action(api.weather.refreshSite, { locationId: s.siteA })).toEqual({ ok: true })
    expect(await messageOf(s.as(s.adminA).action(api.weather.refreshSite, { locationId: s.siteA }))).toContain('30 minutes')
  })
})

describe('sensor ingestion', () => {
  const now = Date.UTC(2026, 10, 18, 10)

  test('reading checks', () => {
    const base = { deviceId: 'probe-1', parameter: 'dissolved_oxygen', value: 5.2, measuredAt: '2026-11-18T09:00:00Z' }
    expect(checkReading(base, now)).toMatchObject({ ok: true, reading: { measuredAt: Date.UTC(2026, 10, 18, 9) } })
    expect(checkReading({ ...base, measuredAt: Date.UTC(2026, 10, 18, 9) }, now).ok).toBe(true)
    expect(checkReading({ ...base, parameter: 'radiation' }, now)).toMatchObject({ ok: false, reason: expect.stringContaining('Unknown parameter') })
    expect(checkReading({ ...base, value: 45 }, now)).toMatchObject({ ok: false, reason: expect.stringContaining('between 0 and 30') })
    expect(checkReading({ ...base, measuredAt: '2026-11-19T09:00:00Z' }, now)).toMatchObject({ ok: false, reason: expect.stringContaining('future') })
    expect(checkReading({ ...base, measuredAt: '2026-01-01T00:00:00Z' }, now)).toMatchObject({ ok: false, reason: expect.stringContaining('90 days') })
    expect(checkReading({ ...base, measuredAt: 'yesterday' }, now)).toMatchObject({ ok: false })
    expect(checkReading({ deviceId: 'x' }, now).ok).toBe(false)
    expect(checkReading({ ...base, deviceId: ' ' }, now).ok).toBe(false)
  })

  async function key(s: S, scopes: string[], locationIds?: Id<'farmLocations'>[], admin?: Id<'users'>) {
    return (await s.as(admin ?? s.adminA).action(api.apiKeys.create, { name: 'Gateway', scopes, locationIds })).key
  }

  function post(s: S, k: string, body: unknown) {
    return s.t.fetch('/ingest/v1/readings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const recent = () => new Date(Date.now() - 60_000).toISOString()

  test('stores a batch, reports rejects, dedupes a resend, emits one event', async () => {
    const s = await setup()
    const k = await key(s, ['ingest:write'])
    const at = recent()
    const body = {
      readings: [
        { deviceId: 'probe-1', cageId: s.cageA, parameter: 'dissolved_oxygen', value: 3.1, measuredAt: at },
        { deviceId: 'probe-1', cageId: s.cageA, parameter: 'temperature_c', value: 29.4, measuredAt: at },
        { deviceId: 'probe-2', siteId: s.siteNoCoords, parameter: 'ph', value: 7.2, measuredAt: at },
        { deviceId: 'probe-3', cageId: s.cageB, parameter: 'ph', value: 7, measuredAt: at },
        { deviceId: 'probe-4', parameter: 'ph', value: 99, measuredAt: at },
      ],
    }
    const res = await post(s, k, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      accepted: 3,
      duplicates: 0,
      rejected: [
        { index: 3, reason: 'cage not found' },
        { index: 4, reason: 'pH must be between 0 and 14' },
      ],
    })
    const again = await (await post(s, k, body)).json()
    expect(again).toMatchObject({ accepted: 0, duplicates: 3 })
    const rows = await s.t.run((ctx) => ctx.db.query('sensorReadings').collect())
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.companyId === s.companyA)).toBe(true)
    expect(rows.find((r) => r.parameter === 'ph')!.locationId).toBe(s.siteNoCoords)
    const events = (await s.t.run((ctx) => ctx.db.query('domainEvents').collect())).filter((e) => e.type === 'sensor.readings.recorded')
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ readings: 3, minDissolvedOxygen: 3.1, maxTemperatureC: 29.4, cageNames: 'A1' })

    const latest = await s.as(s.staffA).query(api.sensors.latest, {})
    expect(latest.readings.map((r) => `${r.source}:${r.parameter}`).sort()).toEqual([
      'A1:dissolved_oxygen', 'A1:temperature_c', 'probe-2:ph',
    ])
    expect((await s.as(s.adminB).query(api.sensors.latest, {})).readings).toHaveLength(0)
  })

  test('scope, site limits, batch size and all-rejected', async () => {
    const s = await setup()
    const readOnly = await key(s, ['cages:read'])
    expect((await post(s, readOnly, { readings: [] })).status).toBe(403)
    const k = await key(s, ['ingest:write'], [s.siteA])
    const outside = await post(s, k, { readings: [{ deviceId: 'p', cageId: s.cageA2, parameter: 'ph', value: 7, measuredAt: recent() }] })
    expect(outside.status).toBe(422)
    expect((await outside.json()).rejected[0].reason).toContain('sites')
    expect((await post(s, k, { readings: [] })).status).toBe(400)
    const many = Array.from({ length: 501 }, () => ({ deviceId: 'p', parameter: 'ph', value: 7, measuredAt: recent() }))
    expect((await post(s, k, { readings: many })).status).toBe(400)
    expect((await post(s, k, { nope: true })).status).toBe(400)
  })
})
