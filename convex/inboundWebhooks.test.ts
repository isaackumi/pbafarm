/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { toBase64 } from './lib/crypto'
import { checkSignature, eventIdentity, signInbound } from './integrations/inboundLogic'

const modules = import.meta.glob('./**/*.ts')
const TEST_KEY = toBase64(new Uint8Array(32).map((_, i) => i + 3))

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    return { companyA, companyB, adminA, staffA, adminB }
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

async function createHook(s: S) {
  const created = await s.as(s.adminA).action(api.inboundWebhooks.create, { name: 'Lab results' })
  const overview = await s.as(s.adminA).query(api.inboundWebhooks.overview, {})
  const hook = overview.webhooks.find((w) => w.id === created.id)!
  return { ...created, path: hook.path }
}

async function post(s: S, path: string, body: string, headers: Record<string, string>) {
  return await s.t.fetch(path, { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } })
}

const eventsOf = (s: S) => s.t.run((ctx) => ctx.db.query('inboundWebhookEvents').collect())

beforeEach(() => vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', TEST_KEY))
afterEach(() => vi.unstubAllEnvs())

describe('inbound signature rules', () => {
  test('accepts a fresh signature, rejects tampering, staleness and junk', async () => {
    const now = 1_800_000_000_000
    const body = '{"id":"e1"}'
    const header = await signInbound('whsec_x', body, now)
    expect(await checkSignature('whsec_x', body, header, now)).toEqual({ ok: true, signedAt: now / 1000 })
    expect(await checkSignature('whsec_x', body + ' ', header, now)).toMatchObject({ reason: 'bad_signature' })
    expect(await checkSignature('whsec_y', body, header, now)).toMatchObject({ reason: 'bad_signature' })
    expect(await checkSignature('whsec_x', body, header, now + 301_000)).toMatchObject({ reason: 'stale_timestamp' })
    expect(await checkSignature('whsec_x', body, header, now - 301_000)).toMatchObject({ reason: 'stale_timestamp' })
    expect(await checkSignature('whsec_x', body, null, now)).toMatchObject({ reason: 'missing_signature' })
    expect(await checkSignature('whsec_x', body, 't=abc,v1=zz', now)).toMatchObject({ reason: 'malformed_signature' })
    // Several v1 values (sender rotating its secret): one match is enough.
    const v1 = header.split('v1=')[1]
    const multi = `t=${now / 1000},v1=${'0'.repeat(64)},v1=${v1}`
    expect(await checkSignature('whsec_x', body, multi, now)).toMatchObject({ ok: true })
  })

  test('event id from the header, else the body', () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null })
    expect(eventIdentity(h({ 'X-PBA-Event-Id': 'abc' }), { id: 'other' })).toMatchObject({ ok: true, externalId: 'abc' })
    expect(eventIdentity(h({}), { id: 42, type: 'lab.result' })).toEqual({ ok: true, externalId: '42', eventType: 'lab.result' })
    expect(eventIdentity(h({}), {})).toMatchObject({ ok: false })
    expect(eventIdentity(h({}), { id: 'bad id with spaces' })).toMatchObject({ ok: false })
  })
})

describe('inbound webhooks', () => {
  test('admins only; another company cannot see or change it', async () => {
    const s = await setup()
    expect(await messageOf(s.as(s.staffA).action(api.inboundWebhooks.create, { name: 'X' }))).not.toBe('resolved')
    const hook = await createHook(s)
    expect(hook.secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/)
    expect(hook.path).toMatch(/^\/webhooks\/in\/inw_[A-Za-z0-9]{24}$/)
    const other = await s.as(s.adminB).query(api.inboundWebhooks.overview, {})
    expect(other.webhooks).toHaveLength(0)
    expect(
      await messageOf(
        s.as(s.adminB).query(api.inboundWebhooks.events, { webhookId: hook.id, paginationOpts: { numItems: 10, cursor: null } }),
      ),
    ).toContain('not found')
    expect(await messageOf(s.as(s.adminB).mutation(api.inboundWebhooks.remove, { webhookId: hook.id }))).toContain('not found')
    expect(await messageOf(s.as(s.adminB).action(api.inboundWebhooks.rotateSecret, { webhookId: hook.id }))).toContain('not found')
    // The secret is stored encrypted, never in plain text.
    const secrets = await s.t.run((ctx) => ctx.db.query('integrationSecrets').collect())
    expect(secrets).toHaveLength(1)
    expect(JSON.stringify(secrets)).not.toContain(hook.secret)
  })

  test('a signed event is stored once, emits a domain event, and is audited', async () => {
    const s = await setup()
    const hook = await createHook(s)
    const body = JSON.stringify({ id: 'evt_1', type: 'lab.result', data: { cage: 'A1' } })
    const sig = await signInbound(hook.secret, body, Date.now())
    const first = await post(s, hook.path, body, { 'X-PBA-Signature': sig })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ received: true, duplicate: false, id: 'evt_1' })
    // The same event again (sender retry): 200, duplicate, nothing new.
    const again = await post(s, hook.path, body, { 'X-PBA-Signature': sig })
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ duplicate: true })
    const events = await eventsOf(s)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ status: 'accepted', externalId: 'evt_1', eventType: 'lab.result', duplicates: 1, companyId: s.companyA })
    const domain = await s.t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(domain.map((d) => d.type)).toEqual(['inbound.webhook.received'])
    expect(domain[0].companyId).toBe(s.companyA)
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(audit.some((a) => a.actionType === 'inbound_webhook_received' && a.companyId === s.companyA)).toBe(true)
  })

  test('bad, stale or missing signatures are 401 and logged without the body', async () => {
    const s = await setup()
    const hook = await createHook(s)
    const body = JSON.stringify({ id: 'evt_2' })
    const wrong = await signInbound('whsec_wrong', body, Date.now())
    expect((await post(s, hook.path, body, { 'X-PBA-Signature': wrong })).status).toBe(401)
    const stale = await signInbound(hook.secret, body, Date.now() - 10 * 60_000)
    const res = await post(s, hook.path, body, { 'X-PBA-Signature': stale })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('invalid_signature')
    expect((await post(s, hook.path, body, {})).status).toBe(401)
    const events = await eventsOf(s)
    expect(events.map((e) => e.reason).sort()).toEqual(['bad_signature', 'missing_signature', 'stale_timestamp'])
    expect(events.every((e) => e.status === 'rejected' && !e.payload && !e.externalId)).toBe(true)
    expect(await s.t.run((ctx) => ctx.db.query('domainEvents').collect())).toHaveLength(0)
  })

  test('a signature from another webhook (another company) does not verify', async () => {
    const s = await setup()
    const hookA = await createHook(s)
    const hookB = await s.as(s.adminB).action(api.inboundWebhooks.create, { name: 'B' })
    const body = JSON.stringify({ id: 'evt_x' })
    const signedWithB = await signInbound(hookB.secret, body, Date.now())
    expect((await post(s, hookA.path, body, { 'X-PBA-Signature': signedWithB })).status).toBe(401)
  })

  test('rotation retires the old secret; disabled and unknown hooks are 404', async () => {
    const s = await setup()
    const hook = await createHook(s)
    const { secret: next } = await s.as(s.adminA).action(api.inboundWebhooks.rotateSecret, { webhookId: hook.id })
    const body = JSON.stringify({ id: 'evt_3' })
    expect((await post(s, hook.path, body, { 'X-PBA-Signature': await signInbound(hook.secret, body, Date.now()) })).status).toBe(401)
    expect((await post(s, hook.path, body, { 'X-PBA-Signature': await signInbound(next, body, Date.now()) })).status).toBe(200)
    await s.as(s.adminA).mutation(api.inboundWebhooks.update, { webhookId: hook.id, enabled: false })
    const body2 = JSON.stringify({ id: 'evt_4' })
    expect((await post(s, hook.path, body2, { 'X-PBA-Signature': await signInbound(next, body2, Date.now()) })).status).toBe(404)
    expect((await post(s, '/webhooks/in/inw_nope', body2, {})).status).toBe(404)
  })

  test('a signed body without an event id is 400', async () => {
    const s = await setup()
    const hook = await createHook(s)
    const body = JSON.stringify({ hello: 'world' })
    const res = await post(s, hook.path, body, { 'X-PBA-Signature': await signInbound(hook.secret, body, Date.now()) })
    expect(res.status).toBe(400)
    const withHeader = await post(s, hook.path, body, {
      'X-PBA-Signature': await signInbound(hook.secret, body, Date.now()),
      'X-PBA-Event-Id': 'hdr-1',
    })
    expect(withHeader.status).toBe(200)
  })

  test('events list is paginated per webhook for the owning company', async () => {
    const s = await setup()
    const hook = await createHook(s)
    for (const id of ['a', 'b']) {
      const body = JSON.stringify({ id })
      await post(s, hook.path, body, { 'X-PBA-Signature': await signInbound(hook.secret, body, Date.now()) })
    }
    const page = await s.as(s.adminA).query(api.inboundWebhooks.events, {
      webhookId: hook.id,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page.map((e) => e.externalId).sort()).toEqual(['a', 'b'])
    expect(page.page[0].payloadPreview).toContain('"id"')
  })
})

