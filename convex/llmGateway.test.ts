/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { toBase64 } from './lib/crypto'
import { estimateCostUsd, gatewayModel, messagesProblem, modelProblem } from './lib/llmGateway'

const modules = import.meta.glob('./**/*.ts')
const TEST_KEY = toBase64(new Uint8Array(32).map((_, i) => i + 11))
const ORG_KEY = 'sk-org-secret-1234567890'

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River', code: 'RIVER', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', name: 'Ama', role: 'admin', companyId: companyA })
    const managerA = await ctx.db.insert('users', { email: 'm@a.com', role: 'user', companyId: companyA })
    const viewerA = await ctx.db.insert('users', { email: 'v@a.com', role: 'user', companyId: companyA })
    await ctx.db.insert('memberships', {
      userId: viewerA, companyId: companyA, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: now,
    })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    return { companyA, companyB, adminA, managerA, viewerA, adminB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

type Step = (url: string, init?: RequestInit) => Response | Promise<Response>
function stubFetch(steps: Step[]) {
  const calls: { url: string; headers: any; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers, body: init?.body ? JSON.parse(String(init.body)) : null })
    return steps[Math.min(calls.length - 1, steps.length - 1)](String(url), init)
  })
  return calls
}
const json = (status: number, body: unknown): Step => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const OPENAI_OK = json(200, { usage: { prompt_tokens: 1000, completion_tokens: 500 }, choices: [{ message: { content: 'FCR is 1.4' } }] })

const MESSAGES = [
  { role: 'system' as const, content: 'Farm context' },
  { role: 'user' as const, content: 'What is my FCR?' },
]

async function saveKey(s: S, providerId = 'openai', model = 'gpt-4o-mini') {
  return await s.as(s.adminA).action(api.llmGateway.saveCredential, { providerId, model, apiKey: ORG_KEY })
}
const usageRows = (s: S) => s.t.run((ctx) => ctx.db.query('llmUsage').collect())

beforeEach(() => vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', TEST_KEY))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('gateway rules', () => {
  test('models, caps and cost estimate', () => {
    expect(gatewayModel('openai', 'gpt-4o-mini', 'gpt-4o')).toBe('gpt-4o')
    expect(gatewayModel('openai', 'gpt-4o-mini', 'evil-model')).toBe('gpt-4o-mini')
    expect(gatewayModel('custom', 'my-model', 'other')).toBe('my-model')
    expect(modelProblem('openai', 'gpt-4o')).toBeNull()
    expect(modelProblem('openai', 'nope')).toContain('not offered')
    expect(modelProblem('custom', 'llama3:8b')).toBeNull()
    expect(modelProblem('nope', 'x')).toBe('Unknown provider')
    expect(messagesProblem([])).toBe('messages are required')
    expect(messagesProblem([{ role: 'user', content: 'x'.repeat(60_001) }])).toContain('too long')
    expect(messagesProblem([{ role: 'system', content: 'x'.repeat(100_000) }, { role: 'user', content: 'q' }])).toBeNull()
    expect(messagesProblem([{ role: 'system', content: 'x'.repeat(400_001) }])).toContain('too large')
    expect(estimateCostUsd('gpt-4o-mini', 1000, 500)).toBeCloseTo(0.00045, 8)
    expect(estimateCostUsd('unknown', 1000, 500)).toBeUndefined()
  })
})

describe('organization keys', () => {
  test('admins only; stored encrypted; hints only; other company sees nothing', async () => {
    const s = await setup()
    await expect(
      s.as(s.managerA).action(api.llmGateway.saveCredential, { providerId: 'openai', model: 'gpt-4o-mini', apiKey: ORG_KEY }),
    ).rejects.toThrow()
    const { id } = await saveKey(s)
    const secrets = await s.t.run((ctx) => ctx.db.query('integrationSecrets').collect())
    expect(secrets).toHaveLength(1)
    expect(JSON.stringify(secrets)).not.toContain(ORG_KEY)
    const mine = await s.as(s.adminA).query(api.llmGateway.overview, { since: 0 })
    expect(mine.credentials).toHaveLength(1)
    expect(mine.credentials[0]).toMatchObject({ providerId: 'openai', isDefault: true, enabled: true })
    expect(JSON.stringify(mine)).not.toContain(ORG_KEY)
    const theirs = await s.as(s.adminB).query(api.llmGateway.overview, { since: 0 })
    expect(theirs.credentials).toHaveLength(0)
    await expect(s.as(s.adminB).mutation(api.llmGateway.removeCredential, { credentialId: id })).rejects.toThrow('not found')
    await expect(
      s.as(s.adminB).mutation(api.llmGateway.updateCredential, { credentialId: id, enabled: false }),
    ).rejects.toThrow('not found')
  })

  test('custom providers need a public https base URL; models are checked', async () => {
    const s = await setup()
    await expect(
      s.as(s.adminA).action(api.llmGateway.saveCredential, { providerId: 'custom', model: 'm', apiKey: ORG_KEY, baseUrl: 'http://10.0.0.1/v1' }),
    ).rejects.toThrow()
    await expect(
      s.as(s.adminA).action(api.llmGateway.saveCredential, { providerId: 'openai', model: 'made-up', apiKey: ORG_KEY }),
    ).rejects.toThrow()
    await s.as(s.adminA).action(api.llmGateway.saveCredential, {
      providerId: 'custom', model: 'llama3', apiKey: ORG_KEY, baseUrl: 'https://llm.example.com/v1/',
    })
    const calls = stubFetch([OPENAI_OK])
    await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    expect(calls[0].url).toBe('https://llm.example.com/v1/chat/completions')
  })
})

describe('gateway chat', () => {
  test('no org key: not handled, nothing called, no limit spent', async () => {
    const s = await setup()
    const calls = stubFetch([OPENAI_OK])
    expect(await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).toEqual({ handled: false })
    expect(calls).toHaveLength(0)
    expect(await usageRows(s)).toHaveLength(0)
  })

  test('org key: provider called with the org key, usage logged with tokens and cost', async () => {
    const s = await setup()
    await saveKey(s)
    const calls = stubFetch([OPENAI_OK])
    const reply = await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES, model: 'gpt-4o' })
    expect(reply).toMatchObject({ handled: true, text: 'FCR is 1.4', providerId: 'openai', model: 'gpt-4o', inputTokens: 1000 })
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(calls[0].headers.Authorization).toBe(`Bearer ${ORG_KEY}`)
    const rows = await usageRows(s)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      companyId: s.companyA, userId: s.managerA, source: 'org_key', feature: 'chat', ok: true, model: 'gpt-4o', inputTokens: 1000, outputTokens: 500,
    })
    expect(rows[0].costUsd).toBeCloseTo(0.0075, 8)
    // Another company's members never use this key.
    const callsB = stubFetch([OPENAI_OK])
    expect(await s.as(s.adminB).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).toEqual({ handled: false })
    expect(callsB).toHaveLength(0)
  })

  test('4xx: provider message as UPSTREAM, no retry, failure logged', async () => {
    const s = await setup()
    await saveKey(s)
    const calls = stubFetch([json(401, { error: { message: 'Incorrect API key' } })])
    await expect(s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).rejects.toThrow()
    try {
      await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    } catch (err: any) {
      expect(typeof err.data === 'string' ? JSON.parse(err.data) : err.data).toMatchObject({ code: 'UPSTREAM', message: 'Incorrect API key' })
    }
    expect(calls).toHaveLength(2)
    const rows = await usageRows(s)
    expect(rows.every((r) => !r.ok && r.error === 'Incorrect API key')).toBe(true)
  })

  test('5xx is retried, then succeeds', async () => {
    const s = await setup()
    await saveKey(s)
    const calls = stubFetch([json(503, {}), OPENAI_OK])
    const reply = await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'insights', messages: MESSAGES })
    expect(reply).toMatchObject({ handled: true, text: 'FCR is 1.4' })
    expect(calls).toHaveLength(2)
    expect((await usageRows(s))[0]).toMatchObject({ ok: true, feature: 'insights' })
  })

  test('a 2xx body without text is a decode failure', async () => {
    const s = await setup()
    await saveKey(s)
    stubFetch([json(200, { choices: [] })])
    await expect(s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).rejects.toThrow()
    expect((await usageRows(s))[0]).toMatchObject({ ok: false, error: 'Empty response from model' })
  })

  test('SEC-004 on the org key: ai.use, company switch, message caps, rate limits', async () => {
    const s = await setup()
    await saveKey(s)
    stubFetch([OPENAI_OK])
    await expect(s.as(s.viewerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).rejects.toThrow()
    await expect(
      s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: Array(25).fill(MESSAGES[1]) }),
    ).rejects.toThrow('Too many messages')
    for (let i = 0; i < 10; i += 1) await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    await expect(s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).rejects.toThrow(
      'Too many assistant requests',
    )
    await s.t.run((ctx) => ctx.db.patch(s.companyA, { settings: { aiAssistantEnabled: false } } as any))
    await expect(s.as(s.adminA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).rejects.toThrow('disabled')
  })

  test('disabled or removed keys fall back to the server key', async () => {
    const s = await setup()
    const { id } = await saveKey(s)
    await s.as(s.adminA).mutation(api.llmGateway.updateCredential, { credentialId: id, enabled: false })
    expect(await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).toEqual({ handled: false })
    await s.as(s.adminA).mutation(api.llmGateway.removeCredential, { credentialId: id })
    expect(await s.t.run((ctx) => ctx.db.query('integrationSecrets').collect())).toHaveLength(0)
  })
})

describe('server-key usage', () => {
  test('recorded for the caller, company-scoped, viewers refused', async () => {
    const s = await setup()
    await s.as(s.managerA).mutation(api.llmGateway.recordServerUsage, {
      providerId: 'gemini', model: 'gemini-2.0-flash', feature: 'chat', ok: true, inputTokens: 2000, outputTokens: 100,
    })
    await expect(
      s.as(s.viewerA).mutation(api.llmGateway.recordServerUsage, { providerId: 'gemini', model: 'gemini-2.0-flash', feature: 'chat', ok: true }),
    ).rejects.toThrow()
    await expect(
      s.as(s.managerA).mutation(api.llmGateway.recordServerUsage, { providerId: 'nope', model: 'x', feature: 'chat', ok: true }),
    ).rejects.toThrow()
    const rows = await usageRows(s)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'server_key', companyId: s.companyA, userId: s.managerA })
    const a = await s.as(s.adminA).query(api.llmGateway.overview, { since: 0 })
    expect(a.usage.calls).toBe(1)
    expect(a.usage.byModel[0]).toMatchObject({ model: 'gemini-2.0-flash', inputTokens: 2000 })
    const b = await s.as(s.adminB).query(api.llmGateway.overview, { since: 0 })
    expect(b.usage.calls).toBe(0)
    const page = await s.as(s.adminA).query(api.llmGateway.usage, { paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page[0]).toMatchObject({ user: 'm@a.com', source: 'server_key' })
    await expect(s.as(s.managerA).query(api.llmGateway.usage, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow()
  })
})
