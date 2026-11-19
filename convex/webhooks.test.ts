/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { toBase64 } from './lib/crypto'
import {
  MAX_ATTEMPTS,
  nextRetryDelay,
  signatureHeader,
  verifySignature,
  webhookUrlProblem,
} from './integrations/webhookLogic'

const modules = import.meta.glob('./**/*.ts')
const TEST_KEY = toBase64(new Uint8Array(32).map((_, i) => i + 7))
const URL_OK = 'https://hooks.example.com/anowa'

type Call = { url: string; init: RequestInit }

function fakeFetch(status = 200) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response('{"ok":true}', { status })
  })
  vi.stubGlobal('fetch', impl)
  return calls
}

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B', active: true, updatedAt: now })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10,
        stockingDate: '2026-10-01', companyId, locationId, updatedAt: now,
      })
    const cageA = await cage('A1', companyA, siteA)
    const cageB = await cage('B1', companyB, siteB)
    return { companyA, companyB, adminA, staffA, adminB, cageA, cageB }
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

async function addEndpoint(s: S, eventTypes = ['daily.recorded'], admin?: Id<'users'>) {
  return await s.as(admin ?? s.adminA).action(api.webhooks.create, { url: URL_OK, eventTypes })
}

async function recordDaily(s: S, user: Id<'users'>, cageId: Id<'cages'>, date = '2026-11-15') {
  await s.as(user).mutation(api.dailyRecords.createBatch, {
    date, records: [{ cageId, feedAmount: 0, mortality: 1 }],
  })
}

const realTick = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Run scheduled work to completion with fake time. Only timers and Date are
 * faked (setImmediate stays real), so Web Crypto and Effect's own yields make
 * progress; time advances until no scheduled function is pending or running.
 */
async function settle(t: S['t']) {
  for (let i = 0; i < 3000; i += 1) {
    await realTick()
    const busy = await t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).some(
        (f) => f.state.kind === 'pending' || f.state.kind === 'inProgress',
      ),
    )
    if (!busy) return
    await vi.advanceTimersByTimeAsync(60_000)
  }
  throw new Error('scheduled work did not finish')
}

async function drain(s: S) {
  await settle(s.t)
}

const deliveriesOf = (s: S) => s.t.run((ctx) => ctx.db.query('webhookDeliveries').collect())

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', TEST_KEY)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('webhook rules', () => {
  test('URL policy: https, public host names, standard ports', () => {
    expect(webhookUrlProblem(URL_OK)).toBeNull()
    expect(webhookUrlProblem('https://hooks.example.com:8443/x')).toBeNull()
    expect(webhookUrlProblem('http://hooks.example.com/x')).toContain('https')
    expect(webhookUrlProblem('https://127.0.0.1/x')).toContain('IP')
    expect(webhookUrlProblem('https://10.0.0.5/x')).toContain('IP')
    expect(webhookUrlProblem('https://[::1]/x')).toContain('IP')
    expect(webhookUrlProblem('https://2130706433/x')).toContain('IP')
    expect(webhookUrlProblem('https://localhost/x')).toContain('public')
    expect(webhookUrlProblem('https://db.internal/x')).toContain('public')
    expect(webhookUrlProblem('https://intranet/x')).toContain('public')
    expect(webhookUrlProblem('https://hooks.example.com:22/x')).toContain('port')
    expect(webhookUrlProblem('https://u:p@hooks.example.com/x')).toContain('password')
    expect(webhookUrlProblem('not a url')).toContain('full URL')
  })

  test('signatures verify, and fail when tampered or stale', async () => {
    const now = Date.UTC(2026, 10, 18, 12)
    const header = await signatureHeader('whsec_abc', '{"a":1}', now)
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
    expect(await verifySignature('whsec_abc', '{"a":1}', header, now)).toBe(true)
    expect(await verifySignature('whsec_abc', '{"a":2}', header, now)).toBe(false)
    expect(await verifySignature('whsec_xyz', '{"a":1}', header, now)).toBe(false)
    expect(await verifySignature('whsec_abc', '{"a":1}', header, now + 10 * 60_000)).toBe(false)
  })

  test('backoff schedule', () => {
    expect(nextRetryDelay(1)).toBe(60_000)
    expect(nextRetryDelay(MAX_ATTEMPTS - 1)).toBeGreaterThan(0)
    expect(nextRetryDelay(MAX_ATTEMPTS)).toBeNull()
  })
})

describe('endpoints (admin)', () => {
  test('secret shown once, stored encrypted, never returned', async () => {
    const s = await setup()
    const { id, secret } = await addEndpoint(s)
    expect(secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/)
    const overview = await s.as(s.adminA).query(api.webhooks.overview, {})
    expect(overview.endpoints[0]).toMatchObject({ id, url: URL_OK, status: 'active', eventTypes: ['daily.recorded'] })
    expect(JSON.stringify(overview)).not.toContain(secret)
    const stored = await s.t.run((ctx) =>
      ctx.db.query('integrationSecrets').withIndex('by_webhookEndpointId', (q) => q.eq('webhookEndpointId', id)).unique(),
    )
    expect(stored!.ciphertext).not.toContain(secret)
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(JSON.stringify(audit)).not.toContain(secret)
  })

  test('refusals: non-admin, bad URL, unknown event, other company, missing key', async () => {
    const s = await setup()
    expect(await messageOf(s.as(s.staffA).action(api.webhooks.create, { url: URL_OK, eventTypes: ['daily.recorded'] }))).toContain('Insufficient permissions')
    expect(await messageOf(s.as(s.adminA).action(api.webhooks.create, { url: 'https://localhost/x', eventTypes: ['daily.recorded'] }))).toContain('public')
    expect(await messageOf(s.as(s.adminA).action(api.webhooks.create, { url: URL_OK, eventTypes: ['nope'] }))).toContain('Unknown event')
    const { id } = await addEndpoint(s)
    expect(await messageOf(s.as(s.adminB).mutation(api.webhooks.update, { endpointId: id, enabled: false }))).toContain('not found')
    expect(await messageOf(s.as(s.adminB).query(api.webhooks.deliveries, { endpointId: id, paginationOpts: { numItems: 5, cursor: null } }))).toContain('not found')
    vi.unstubAllEnvs()
    expect(await messageOf(addEndpoint(s))).toContain('INTEGRATIONS_ENCRYPTION_KEY')
  })
})

describe('delivery', () => {
  test('a subscribed event is POSTed once, signed with the endpoint secret', async () => {
    const s = await setup()
    const calls = fakeFetch(200)
    const { id, secret } = await addEndpoint(s)
    await recordDaily(s, s.staffA, s.cageA)
    await drain(s)
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe(URL_OK)
    const headers = init.headers as Record<string, string>
    const body = String(init.body)
    expect(await verifySignature(secret, body, headers['X-PBA-Signature'], Date.now(), 10 ** 9)).toBe(true)
    expect(init.redirect).toBe('manual')
    const payload = JSON.parse(body)
    expect(payload).toMatchObject({ type: 'daily.recorded', companyId: s.companyA, data: { cageName: 'A1', mortality: 1 } })
    expect(headers['X-PBA-Event-Id']).toBe(payload.id)
    const [d] = await deliveriesOf(s)
    expect(d).toMatchObject({ endpointId: id, status: 'succeeded', attempts: 1, responseStatus: 200 })
    // Dispatch is idempotent: running the consumer again adds nothing.
    await s.t.mutation(internal.webhooks.fanOut, { eventId: payload.id })
    expect(await deliveriesOf(s)).toHaveLength(1)
    const event = await s.t.run((ctx) => ctx.db.get(payload.id as Id<'domainEvents'>))
    expect(event!.processedBy).toEqual(['webhooks'])
  })

  test('unsubscribed types, other companies and turned-off endpoints get nothing', async () => {
    const s = await setup()
    const calls = fakeFetch(200)
    await addEndpoint(s, ['inventory.stock.low'])
    const b = await addEndpoint(s, ['daily.recorded'], s.adminB)
    await s.as(s.adminB).mutation(api.webhooks.update, { endpointId: b.id, enabled: false })
    await recordDaily(s, s.staffA, s.cageA)
    await recordDaily(s, s.adminB, s.cageB)
    await drain(s)
    expect(calls).toHaveLength(0)
    expect(await deliveriesOf(s)).toHaveLength(0)
  })

  test('failures retry with backoff, then fail; redeliver sends again', async () => {
    const s = await setup()
    const calls = fakeFetch(400)
    const { id } = await addEndpoint(s)
    await recordDaily(s, s.staffA, s.cageA)
    await drain(s)
    expect(calls).toHaveLength(MAX_ATTEMPTS)
    const [d] = await deliveriesOf(s)
    expect(d).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, responseStatus: 400 })
    expect(d.lastError).toContain('400')
    const endpoint = await s.t.run((ctx) => ctx.db.get(id))
    expect(endpoint!.consecutiveFailures).toBe(MAX_ATTEMPTS)

    fakeFetch(202)
    await s.as(s.adminA).mutation(api.webhooks.redeliver, { deliveryId: d._id })
    await settle(s.t)
    const all = await deliveriesOf(s)
    expect(all).toHaveLength(2)
    const again = all.find((x) => x.redeliveryOf === d._id)
    expect(again).toMatchObject({ status: 'succeeded', payload: d.payload, eventId: d.eventId })
    expect((await s.t.run((ctx) => ctx.db.get(id)))!.consecutiveFailures).toBe(0)
    const log = await s.as(s.adminA).query(api.webhooks.deliveries, { endpointId: id, paginationOpts: { numItems: 10, cursor: null } })
    expect(log.page).toHaveLength(2)
    expect(JSON.stringify(log)).not.toContain('payload')
  })

  test('20 failures in a row turn the endpoint off and tell the admins', async () => {
    const s = await setup()
    fakeFetch(500)
    const { id } = await addEndpoint(s)
    await s.t.run((ctx) => ctx.db.patch(id, { consecutiveFailures: 19 }))
    await s.as(s.adminA).mutation(api.webhooks.sendTest, { endpointId: id })
    await settle(s.t)
    const endpoint = await s.t.run((ctx) => ctx.db.get(id))
    expect(endpoint).toMatchObject({ status: 'disabled' })
    expect(endpoint!.disabledReason).toContain('failed')
    const notes = await s.t.run((ctx) => ctx.db.query('notifications').collect())
    expect(notes.some((n) => n.userId === s.adminA && n.title === 'Webhook turned off')).toBe(true)
    // Pending retries stop once the endpoint is off.
    const [d] = await deliveriesOf(s)
    expect(d.status).toBe('failed')
    // Turning it back on resets the counter.
    await s.as(s.adminA).mutation(api.webhooks.update, { endpointId: id, enabled: true })
    expect((await s.t.run((ctx) => ctx.db.get(id)))!.consecutiveFailures).toBe(0)
  })

  test('rotating the secret signs with the new one', async () => {
    const s = await setup()
    const calls = fakeFetch(200)
    const { id, secret } = await addEndpoint(s)
    const { secret: next } = await s.as(s.adminA).action(api.webhooks.rotateSecret, { endpointId: id })
    expect(next).not.toBe(secret)
    await s.as(s.adminA).mutation(api.webhooks.sendTest, { endpointId: id })
    await settle(s.t)
    const headers = calls[0].init.headers as Record<string, string>
    expect(await verifySignature(next, String(calls[0].init.body), headers['X-PBA-Signature'], Date.now(), 10 ** 9)).toBe(true)
    expect(await verifySignature(secret, String(calls[0].init.body), headers['X-PBA-Signature'], Date.now(), 10 ** 9)).toBe(false)
  })

  test('automation "call webhook" action sends the event with the rule', async () => {
    const s = await setup()
    const calls = fakeFetch(200)
    // Endpoint subscribed to nothing relevant: only the rule sends.
    const { id } = await addEndpoint(s, ['inventory.stock.low'])
    await s.as(s.adminA).mutation(api.automation.rules.save, {
      name: 'Mortality to partner', enabled: true,
      trigger: { kind: 'event', eventType: 'daily.recorded' },
      conditions: [], actions: [{ kind: 'webhook', endpointId: id }],
    })
    await recordDaily(s, s.staffA, s.cageA)
    await settle(s.t)
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0].init.body))
    expect(body).toMatchObject({ type: 'daily.recorded', rule: { name: 'Mortality to partner' }, data: { cageName: 'A1' } })
    const b = await addEndpoint(s, ['daily.recorded'], s.adminB)
    expect(
      await messageOf(s.as(s.adminA).mutation(api.automation.rules.save, {
        name: 'x', enabled: true, trigger: { kind: 'event', eventType: 'daily.recorded' },
        conditions: [], actions: [{ kind: 'webhook', endpointId: b.id }],
      })),
    ).toContain('not found')
  })
})
