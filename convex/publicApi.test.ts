/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { cleanEventData, DOMAIN_EVENT_TYPES } from './lib/events'
import { parseBearer, domainErrorMessage } from './integrations/apiHttp'
import { API_ROUTES } from './integrations/openapi'
import { API_RESOURCES } from './publicApi'
import { randomBase62, timingSafeEqual } from './integrations/apiScopes'

const modules = import.meta.glob('./**/*.ts')

/**
 * INT-004 public API and the domain-event outbox. Two approved companies,
 * two sites in A, cages in each, a feed type with stock.
 */
async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA1 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const siteA2 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'South', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B site', active: true, updatedAt: now })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10,
        stockingDate: '2026-10-01', companyId, locationId, updatedAt: now,
      })
    const cageA1 = await cage('A1', companyA, siteA1)
    const cageA2 = await cage('A2', companyA, siteA2)
    const cageB1 = await cage('B1', companyB, siteB)
    const feedA = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 100, minimumStock: 60, pricePerKg: 10, active: true,
      bagSizeKg: 20, companyId: companyA, updatedAt: now,
    })
    return { companyA, companyB, siteA1, siteA2, siteB, adminA, staffA, adminB, cageA1, cageA2, cageB1, feedA }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}

type S = Awaited<ReturnType<typeof setup>>

async function newKey(s: S, scopes: string[], extra: { locationIds?: Id<'farmLocations'>[]; admin?: Id<'users'> } = {}) {
  return await s.as(extra.admin ?? s.adminA).action(api.apiKeys.create, {
    name: 'Partner', scopes, locationIds: extra.locationIds,
  })
}

function get(s: S, path: string, key?: string) {
  return s.t.fetch(path, { method: 'GET', headers: key ? { Authorization: `Bearer ${key}` } : {} })
}

function post(s: S, path: string, key: string, body: unknown, idem?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  if (idem) headers['Idempotency-Key'] = idem
  return s.t.fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function messageOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    return (err as Error).message
  }
  return 'resolved'
}

afterEach(() => {
  vi.useRealTimers()
})

describe('helpers', () => {
  test('bearer parsing, random keys, constant-time compare', () => {
    const key = `pbk_${randomBase62(10)}_${randomBase62(32)}`
    expect(parseBearer(`Bearer ${key}`)).toEqual({ prefix: key.slice(4, 14), key })
    expect(parseBearer('Bearer pbk_short_x')).toBeNull()
    expect(parseBearer(null)).toBeNull()
    expect(parseBearer(`Basic ${key}`)).toBeNull()
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'ab')).toBe(false)
  })

  test('domain error messages are cleaned', () => {
    expect(domainErrorMessage(new Error('[CONVEX M(x)] [Request ID: 1] Server Error\nUncaught Error: Line 1: cage not found\n    at foo'))).toBe('Line 1: cage not found')
    expect(domainErrorMessage(new Error('plain'))).toBe('plain')
  })

  test('event data is flat, capped and refuses objects', () => {
    expect(cleanEventData({ a: 1, b: undefined, c: 'x'.repeat(900) })).toEqual({ a: 1, c: 'x'.repeat(500) })
    expect(() => cleanEventData({ a: {} as unknown as string })).toThrow('must be a string')
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i]))
    expect(() => cleanEventData(many)).toThrow('at most 40')
  })
})

describe('API keys (admin)', () => {
  test('created once, stored hashed, never returned', async () => {
    const s = await setup()
    const created = await newKey(s, ['cages:read'])
    expect(created.key).toMatch(/^pbk_[A-Za-z0-9]{10}_[A-Za-z0-9]{32}$/)
    const overview = await s.as(s.adminA).query(api.apiKeys.overview, {})
    expect(overview.keys).toHaveLength(1)
    expect(overview.keys[0]).toMatchObject({ name: 'Partner', scopes: ['cages:read'], status: 'active' })
    const stored = await s.t.run((ctx) => ctx.db.get(created.id))
    const json = JSON.stringify(overview)
    expect(json).not.toContain(created.key)
    expect(json).not.toContain(stored!.hash)
    expect(stored!.hash).not.toContain(created.key.slice(15))
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(JSON.stringify(audit)).not.toContain(created.key)
  })

  test('non-admins, unknown scopes and other companies\' sites are refused', async () => {
    const s = await setup()
    expect(await messageOf(s.as(s.staffA).action(api.apiKeys.create, { name: 'x', scopes: ['cages:read'] }))).toContain('Insufficient permissions')
    expect(await messageOf(s.as(s.staffA).query(api.apiKeys.overview, {}))).toContain('Insufficient permissions')
    expect(await messageOf(newKey(s, ['root']))).toContain('Unknown permission')
    expect(await messageOf(newKey(s, []))).toContain('at least one')
    expect(await messageOf(newKey(s, ['cages:read'], { locationIds: [s.siteB] }))).toContain('Site not found')
    const k = await newKey(s, ['cages:read'])
    expect(await messageOf(s.as(s.adminB).mutation(api.apiKeys.revoke, { keyId: k.id }))).toContain('not found')
  })

  test('revoked key stops working at once', async () => {
    const s = await setup()
    const k = await newKey(s, ['cages:read'])
    expect((await get(s, '/api/v1/cages', k.key)).status).toBe(200)
    await s.as(s.adminA).mutation(api.apiKeys.revoke, { keyId: k.id })
    const res = await get(s, '/api/v1/cages', k.key)
    expect(res.status).toBe(401)
    expect((await s.as(s.adminA).query(api.apiKeys.overview, {})).keys[0].status).toBe('revoked')
  })
})

describe('GET /api/v1', () => {
  test('authentication and scopes', async () => {
    const s = await setup()
    expect((await get(s, '/api/v1/cages')).status).toBe(401)
    expect((await get(s, '/api/v1/cages', `pbk_${'a'.repeat(10)}_${'b'.repeat(32)}`)).status).toBe(401)
    const k = await newKey(s, ['daily:read'])
    // Right prefix, wrong secret.
    expect((await get(s, '/api/v1/daily-records', `${k.key.slice(0, -1)}${k.key.endsWith('a') ? 'b' : 'a'}`)).status).toBe(401)
    const forbidden = await get(s, '/api/v1/cages', k.key)
    expect(forbidden.status).toBe(403)
    expect((await forbidden.json()).error.code).toBe('insufficient_scope')
    // Organization suspended: refused.
    await s.t.run((ctx) => ctx.db.patch(s.companyA, { status: 'rejected' }))
    expect((await get(s, '/api/v1/daily-records', k.key)).status).toBe(403)
  })

  test('a key reads only its organization, paginated', async () => {
    const s = await setup()
    const k = await newKey(s, ['cages:read'])
    const page1 = await (await get(s, '/api/v1/cages?limit=1', k.key)).json()
    expect(page1.data).toHaveLength(1)
    expect(page1.hasMore).toBe(true)
    const page2 = await (await get(s, `/api/v1/cages?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`, k.key)).json()
    expect(page2.data).toHaveLength(1)
    const names = [...page1.data, ...page2.data].map((c: { name: string }) => c.name).sort()
    expect(names).toEqual(['A1', 'A2'])
    expect((await get(s, `/api/v1/cages/${s.cageA1}`, k.key)).status).toBe(200)
    expect((await get(s, `/api/v1/cages/${s.cageB1}`, k.key)).status).toBe(404)
    expect((await get(s, '/api/v1/cages/not-an-id', k.key)).status).toBe(404)
    expect((await get(s, '/api/v1/cages?limit=500', k.key)).status).toBe(400)
    const lastUsed = await s.t.run((ctx) => ctx.db.get(k.id))
    expect(lastUsed!.lastUsedAt).toBeTypeOf('number')
  })

  test('site-restricted key sees only its sites', async () => {
    const s = await setup()
    const k = await newKey(s, ['cages:read'], { locationIds: [s.siteA1] })
    const body = await (await get(s, '/api/v1/cages', k.key)).json()
    expect(body.data.map((c: { name: string }) => c.name)).toEqual(['A1'])
    expect((await get(s, `/api/v1/cages/${s.cageA2}`, k.key)).status).toBe(404)
  })

  test('every resource answers with a page; date filters apply', async () => {
    const s = await setup()
    const k = await newKey(s, ['cages:read', 'daily:read', 'sampling:read', 'harvest:read', 'inventory:read', 'sales:read'])
    await s.t.run(async (ctx) => {
      for (const date of ['2026-11-01', '2026-11-10']) {
        await ctx.db.insert('dailyRecords', {
          cageId: s.cageA1, date, feedAmount: 5, feedPrice: 10, feedCost: 50, mortality: 1,
          companyId: s.companyA, locationId: s.siteA1,
        })
      }
      await ctx.db.insert('sales', {
        saleDate: '2026-11-05', weightKg: 10, pricePerKg: 30, totalAmount: 300,
        companyId: s.companyA, locationId: s.siteA1, updatedAt: Date.now(),
      })
    })
    for (const resource of API_RESOURCES) {
      const res = await get(s, `/api/v1/${resource}`, k.key)
      expect(res.status, resource).toBe(200)
      expect(Array.isArray((await res.json()).data)).toBe(true)
    }
    const daily = await (await get(s, '/api/v1/daily-records?from=2026-11-05', k.key)).json()
    expect(daily.data.map((d: { date: string }) => d.date)).toEqual(['2026-11-10'])
    expect((await get(s, '/api/v1/daily-records?from=11/05/2026', k.key)).status).toBe(400)
    const feed = await (await get(s, '/api/v1/feed-stock', k.key)).json()
    expect(feed.data[0]).toMatchObject({ name: 'Grower', currentStockKg: 100, minimumStockKg: 60, low: false })
  })

  test('rate limited per key with Retry-After', async () => {
    const s = await setup()
    const k = await newKey(s, ['cages:read'])
    let last: Response | undefined
    for (let i = 0; i < 61; i += 1) last = await get(s, '/api/v1/cages', k.key)
    expect(last!.status).toBe(429)
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  test('OpenAPI document describes every route', async () => {
    const s = await setup()
    const res = await get(s, '/api/v1/openapi.json')
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.openapi).toBe('3.1.0')
    for (const resource of API_RESOURCES) {
      expect(doc.paths[`/api/v1/${resource}`]?.get, resource).toBeTruthy()
      expect(doc.paths[`/api/v1/${resource}/{id}`]?.get, resource).toBeTruthy()
    }
    expect(doc.paths['/api/v1/daily-records'].post).toBeTruthy()
    expect(doc.paths['/api/v1/sampling'].post).toBeTruthy()
    expect(API_ROUTES.map((r) => r.resource).sort()).toEqual([...API_RESOURCES].sort())
  })
})

describe('POST /api/v1 writes', () => {
  const daily = (s: S, extra: Record<string, unknown> = {}) => ({
    date: '2026-11-15',
    records: [{ cageId: s.cageA1, feedKg: 10, feedTypeId: s.feedA, mortality: 2, ...extra }],
  })

  test('daily records: created through farm rules, audited and evented as the API', async () => {
    const s = await setup()
    const k = await newKey(s, ['daily:write'])
    const res = await post(s, '/api/v1/daily-records', k.key, daily(s), 'req-1')
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data[0]).toMatchObject({ cageId: s.cageA1, feedKg: 10, mortality: 2, feedCost: 100 })
    const state = await s.t.run(async (ctx) => ({
      feed: await ctx.db.get(s.feedA),
      cage: await ctx.db.get(s.cageA1),
      audit: await ctx.db.query('auditLogs').collect(),
      events: await ctx.db.query('domainEvents').collect(),
    }))
    expect(state.feed!.currentStock).toBe(90)
    expect(state.cage!.currentCount).toBe(998)
    expect(state.audit.some((a) => a.apiKeyId === k.id && a.tableName === 'daily_records')).toBe(true)
    const ev = state.events.find((e) => e.type === 'daily.batch.recorded')
    expect(ev).toMatchObject({ origin: 'api', actorApiKeyId: k.id, companyId: s.companyA, businessDate: '2026-11-15' })
    expect(ev!.data).toMatchObject({ lines: 1, totalMortality: 2, totalFeedKg: 10 })
  })

  test('idempotency: replay returns the first response; another body is refused', async () => {
    const s = await setup()
    const k = await newKey(s, ['daily:write'])
    const first = await post(s, '/api/v1/daily-records', k.key, daily(s), 'same')
    const again = await post(s, '/api/v1/daily-records', k.key, daily(s), 'same')
    expect(again.status).toBe(201)
    expect(again.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await again.json()).toEqual(await first.json())
    const records = await s.t.run((ctx) => ctx.db.query('dailyRecords').collect())
    expect(records).toHaveLength(1)
    const other = await post(s, '/api/v1/daily-records', k.key, daily(s, { mortality: 3 }), 'same')
    expect(other.status).toBe(422)
    expect((await other.json()).error.code).toBe('idempotency_key_reused')
    expect((await post(s, '/api/v1/daily-records', k.key, daily(s))).status).toBe(400)
  })

  test('domain refusals are 422 and write nothing', async () => {
    const s = await setup()
    const k = await newKey(s, ['daily:write'])
    await post(s, '/api/v1/daily-records', k.key, daily(s), 'a')
    const dup = await post(s, '/api/v1/daily-records', k.key, daily(s), 'b')
    expect(dup.status).toBe(422)
    expect((await dup.json()).error.message).toContain('already exists')
    const foreign = await post(s, '/api/v1/daily-records', k.key, { date: '2026-11-15', records: [{ cageId: s.cageB1, feedKg: 0, mortality: 0 }] }, 'c')
    expect(foreign.status).toBe(422)
    const tooMuch = await post(s, '/api/v1/daily-records', k.key, { date: '2026-11-16', records: [{ cageId: s.cageA2, feedKg: 500, feedTypeId: s.feedA, mortality: 0 }] }, 'd')
    expect(tooMuch.status).toBe(422)
    expect((await tooMuch.json()).error.message).toContain('Insufficient stock')
    const bad = await post(s, '/api/v1/daily-records', k.key, { date: '2026-11-16', records: [{ cageId: 1 }] }, 'e')
    expect(bad.status).toBe(400)
    const idem = await s.t.run((ctx) => ctx.db.query('apiIdempotencyKeys').collect())
    expect(idem.map((r) => r.key)).toEqual(['a'])
  })

  test('site-restricted key cannot write to other sites; read scope cannot write', async () => {
    const s = await setup()
    const k = await newKey(s, ['daily:write'], { locationIds: [s.siteA1] })
    const res = await post(s, '/api/v1/daily-records', k.key, { date: '2026-11-15', records: [{ cageId: s.cageA2, feedKg: 0, mortality: 0 }] }, 'x')
    expect(res.status).toBe(422)
    const r = await newKey(s, ['daily:read'])
    expect((await post(s, '/api/v1/daily-records', r.key, daily(s), 'y')).status).toBe(403)
  })

  test('sampling create', async () => {
    const s = await setup()
    const k = await newKey(s, ['sampling:write'])
    const res = await post(s, '/api/v1/sampling', k.key, {
      date: '2026-11-15', records: [{ cageId: s.cageA1, fishCount: 50, totalWeightG: 5000 }],
    }, 's-1')
    expect(res.status).toBe(201)
    expect((await res.json()).data[0]).toMatchObject({ averageBodyWeightG: 100, fishCount: 50 })
    const events = await s.t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(events.map((e) => e.type)).toContain('sampling.recorded')
  })
})

describe('domain events', () => {
  test('UI daily batch emits one event per save; dispatch marks it', async () => {
    const s = await setup()
    await s.as(s.staffA).mutation(api.dailyRecords.createBatch, {
      date: '2026-11-15',
      records: [
        { cageId: s.cageA1, feedAmount: 0, mortality: 1 },
        { cageId: s.cageA2, feedAmount: 0, mortality: 0 },
      ],
    })
    const events = await s.t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'daily.batch.recorded', origin: 'user', actorUserId: s.staffA, dispatchStatus: 'pending' })
    expect(events[0].data).toMatchObject({ lines: 2, cages: 2 })
    expect(await s.t.mutation(internal.events.dispatchPending, {})).toBe(1)
    expect((await s.t.run((ctx) => ctx.db.get(events[0]._id)))!.dispatchStatus).toBe('dispatched')
    expect(await s.t.mutation(internal.events.dispatchPending, {})).toBe(0)
  })

  test('low stock is edge-triggered', async () => {
    const s = await setup()
    const admin = s.as(s.staffA)
    // 100 → 70: above the minimum of 60, no event.
    await admin.mutation(api.dailyRecords.createBatch, { date: '2026-11-14', records: [{ cageId: s.cageA1, feedAmount: 30, feedTypeId: s.feedA, mortality: 0 }] })
    // 70 → 50: crosses, one event.
    await admin.mutation(api.dailyRecords.createBatch, { date: '2026-11-15', records: [{ cageId: s.cageA1, feedAmount: 20, feedTypeId: s.feedA, mortality: 0 }] })
    // 50 → 40: already low, no new event.
    await admin.mutation(api.dailyRecords.createBatch, { date: '2026-11-16', records: [{ cageId: s.cageA1, feedAmount: 10, feedTypeId: s.feedA, mortality: 0 }] })
    const low = (await s.t.run((ctx) => ctx.db.query('domainEvents').collect())).filter((e) => e.type === 'inventory.stock.low')
    expect(low).toHaveLength(1)
    expect(low[0].data).toMatchObject({ feedTypeName: 'Grower', stockKg: 50, minimumKg: 60 })
  })

  test('harvest emits stock.harvested', async () => {
    const s = await setup()
    await s.as(s.adminA).mutation(api.harvest.create, {
      cageId: s.cageA1, harvestDate: '2026-11-15', averageBodyWeight: 400, totalWeight: 400,
      estimatedCount: 1000, fcr: 1.4,
    })
    const events = await s.t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(events.find((e) => e.type === 'stock.harvested')?.data).toMatchObject({ cageName: 'A1', totalWeightKg: 400 })
  })

  test('the catalog lists every type with a label', () => {
    for (const [type, label] of Object.entries(DOMAIN_EVENT_TYPES)) {
      expect(type).toMatch(/^[a-z]+(\.[a-z]+)+$/)
      expect(label.length).toBeGreaterThan(3)
    }
  })
})
