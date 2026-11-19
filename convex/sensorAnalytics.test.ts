/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { breachCounts, bucketize, pickBucketMs, stats, worstValue } from './lib/sensorAnalytics'

const modules = import.meta.glob('./**/*.ts')
const HOUR = 3_600_000

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now } as any)
    const otherCompanyId = await ctx.db.insert('companies', { name: 'River', code: 'RIV', status: 'approved', createdAt: now } as any)
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'A', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'B', active: true, updatedAt: now })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffB = await ctx.db.insert('users', { email: 'b@x.com', role: 'user', companyId, locationIds: [siteB] })
    await ctx.db.insert('memberships', {
      userId: staffB, companyId, roleKey: 'field_staff', allLocations: false, locationIds: [siteB], status: 'active', updatedAt: now,
    })
    const quietId = await ctx.db.insert('users', { email: 'q@x.com', role: 'user', companyId })
    await ctx.db.insert('notificationPreferences', { userId: quietId, inApp: false, sms: false, whatsapp: false, email: true, updatedAt: now })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cageA = await ctx.db.insert('cages', { name: 'C1', status: 'active', currentCount: 1, companyId, locationId: siteA, updatedAt: now })
    const pondB = await ctx.db.insert('cages', {
      name: 'P1', unitType: 'pond', status: 'active', currentCount: 1, companyId, locationId: siteB, updatedAt: now,
    })
    const apiKeyId = await ctx.db.insert('apiKeys', {
      companyId, name: 'gw', prefix: 'p', hash: 'h', scopes: ['ingest:write'], createdBy: adminId, createdAt: now,
    })
    return { companyId, siteA, siteB, adminId, staffB, quietId, outsiderId, cageA, pondB, apiKeyId }
  })
  const as = (id: Id<'users'>) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

// Breach alerts schedule notification sends; keep them from running after a test.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

let seq = 0
function ingest(s: S, cageId: Id<'cages'>, parameter: string, values: number[], start: number, stepMs = 60_000) {
  return s.t.run((ctx) =>
    ctx.runMutation(internal.sensors.ingest, {
      apiKeyId: s.apiKeyId,
      readings: values.map((value, i) => ({
        index: i, deviceId: `probe-${(seq += 1)}`, parameter, value, measuredAt: start + i * stepMs, cageId,
      })),
    }),
  )
}
const notifications = (s: S) => s.t.run((ctx) => ctx.db.query('notifications').collect())
const dispatches = (s: S) => s.t.run((ctx) => ctx.db.query('notificationDispatches').collect())

describe('rollup helpers', () => {
  test('buckets, stats, breaches and the worst value', () => {
    const pts = [
      { value: 5, measuredAt: 0 },
      { value: 3, measuredAt: 30_000 },
      { value: 7, measuredAt: 70_000 },
    ]
    expect(bucketize(pts, 60_000)).toEqual([
      { t: 0, min: 3, max: 5, avg: 4, count: 2 },
      { t: 60_000, min: 7, max: 7, avg: 7, count: 1 },
    ])
    expect(stats(pts)).toEqual({ count: 3, min: 3, max: 7, avg: 5, last: 7, lastAt: 70_000 })
    expect(stats([])).toBeNull()
    expect(breachCounts(pts, { min: 4, max: 6 })).toEqual({ low: 1, high: 1 })
    expect(worstValue(pts, { min: 4 })).toBe(3)
    expect(worstValue(pts, { min: 1 })).toBe(7)
    expect(pickBucketMs(HOUR)).toBe(60_000)
    expect(pickBucketMs(7 * 24 * HOUR)).toBe(HOUR)
    expect(pickBucketMs(1000 * 24 * HOUR)).toBe(24 * HOUR)
  })
})

describe('sensor analytics queries', () => {
  test('series: buckets, stats and breaches against the unit thresholds', async () => {
    const s = await setup()
    const start = Date.now() - 2 * HOUR
    await ingest(s, s.cageA, 'dissolved_oxygen', [6, 5, 3, 7], start)
    const res = await s.as(s.adminId).query(api.sensorAnalytics.series, {
      unitId: s.cageA, parameter: 'dissolved_oxygen', from: start - 1000, to: Date.now(),
    })
    expect(res).toMatchObject({ unitName: 'C1', range: { min: 4 }, bucketMs: 60_000, breaches: { low: 1, high: 0 }, truncated: false })
    expect(res?.stats).toMatchObject({ count: 4, min: 3, max: 7, avg: 5.25, last: 7 })
    expect(res?.buckets).toHaveLength(4)
    await expect(
      s.as(s.adminId).query(api.sensorAnalytics.series, { unitId: s.cageA, parameter: 'nope', from: 0, to: 1 }),
    ).rejects.toThrow('Unknown sensor parameter')
    await expect(
      s.as(s.adminId).query(api.sensorAnalytics.series, { unitId: s.cageA, parameter: 'ph', from: 0, to: 100 * 24 * HOUR }),
    ).rejects.toThrow('92 days')
  })

  test('wrong company and out-of-scope sites see nothing', async () => {
    const s = await setup()
    const start = Date.now() - HOUR
    await ingest(s, s.cageA, 'temperature_c', [28, 29], start)
    await ingest(s, s.pondB, 'temperature_c', [30], start)
    const args = { from: start - 1000, to: Date.now() }
    expect(await s.as(s.outsiderId).query(api.sensorAnalytics.series, { unitId: s.cageA, parameter: 'temperature_c', ...args })).toBeNull()
    expect((await s.as(s.outsiderId).query(api.sensorAnalytics.summary, args)).rows).toHaveLength(0)
    expect(await s.as(s.staffB).query(api.sensorAnalytics.series, { unitId: s.cageA, parameter: 'temperature_c', ...args })).toBeNull()
    const mine = await s.as(s.staffB).query(api.sensorAnalytics.summary, args)
    expect(mine.rows.map((r) => r.unitName)).toEqual(['P1'])
    await expect(s.as(s.staffB).query(api.sensorAnalytics.summary, { ...args, locationId: s.siteA })).rejects.toThrow()
    const all = await s.as(s.adminId).query(api.sensorAnalytics.summary, args)
    expect(all.rows.map((r) => r.unitName)).toEqual(['C1', 'P1'])
    expect(all.rows[0]).toMatchObject({ parameter: 'temperature_c', alert: true, count: 2, min: 28, max: 29, avg: 28.5 })
    const siteB = await s.as(s.adminId).query(api.sensorAnalytics.summary, { ...args, locationId: s.siteB })
    expect(siteB.rows.map((r) => r.unitName)).toEqual(['P1'])
  })
})

describe('threshold breach notifications', () => {
  test('low oxygen notifies site members by preference, once per hour per unit and parameter', async () => {
    const s = await setup()
    const start = Date.now() - 10 * 60_000
    // Worst value of the batch (2.5) breaches even though the latest (6) is fine.
    await ingest(s, s.cageA, 'dissolved_oxygen', [2.5, 6], start)
    let rows = await notifications(s)
    // Admin and the quiet user see site A; staffB is limited to site B. The quiet user has in-app off.
    expect(rows.map((r) => r.userId)).toEqual([s.adminId])
    expect(rows[0]).toMatchObject({ type: 'error', link: `/sensors?unit=${s.cageA}`, companyId: s.companyId })
    expect(rows[0].title).toContain('Low oxygen')
    const sent = await dispatches(s)
    expect(sent).toHaveLength(1)
    expect(sent[0].deliveries.filter((d) => d.channel === 'email').map((d) => d.to).sort()).toEqual(['a@x.com', 'q@x.com'].sort())
    // A second batch within the hour does not alert again.
    await ingest(s, s.cageA, 'dissolved_oxygen', [2], start + 5 * 60_000)
    expect(await notifications(s)).toHaveLength(1)
    expect(await dispatches(s)).toHaveLength(1)
    // The breach event is still emitted for automation.
    const events = await s.t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(events.filter((e) => e.type === 'water.threshold.breached')).toHaveLength(2)
  })

  test('routine parameters go in-app and email only; untracked parameters never alert', async () => {
    const s = await setup()
    await ingest(s, s.pondB, 'ph', [9.8], Date.now() - 60_000)
    const rows = await notifications(s)
    expect(rows.map((r) => r.userId).sort()).toEqual([s.adminId, s.staffB].sort())
    expect(rows[0]).toMatchObject({ type: 'warning' })
    const channels = new Set((await dispatches(s)).flatMap((d) => d.deliveries.map((x) => x.channel)))
    expect([...channels].every((c) => c === 'email')).toBe(true)
    await ingest(s, s.pondB, 'salinity', [59], Date.now() - 30_000)
    expect(await notifications(s)).toHaveLength(2)
  })
})
