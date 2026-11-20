/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { toBase64 } from './lib/crypto'
import { estimateCostUsd, messagesProblem, modelProblem } from './lib/llmGateway'

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
const json = (status: number, body: unknown): Step => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** What GET .../models answers (live model lists, D-022). */
const OPENAI_MODELS = { data: [{ id: 'gpt-4o-mini', created: 1 }, { id: 'gpt-4o', created: 2 }, { id: 'text-embedding-3-small', created: 3 }] }
let listStep: Step = json(200, OPENAI_MODELS)
let listCalls: { url: string; headers: any }[] = []

/** Scripted provider: model-list GETs go to `listStep`, chat calls to `steps` in order. */
function stubFetch(steps: Step[]) {
  const calls: { url: string; headers: any; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET' && /\/models(\?|$)/.test(String(url))) {
      listCalls.push({ url: String(url), headers: init?.headers })
      return listStep(String(url), init)
    }
    calls.push({ url: String(url), headers: init?.headers, body: init?.body ? JSON.parse(String(init.body)) : null })
    return steps[Math.min(calls.length - 1, steps.length - 1)](String(url), init)
  })
  return calls
}
const OPENAI_OK = json(200, { usage: { prompt_tokens: 1000, completion_tokens: 500 }, choices: [{ message: { content: 'FCR is 1.4' } }] })

const MESSAGES = [
  { role: 'system' as const, content: 'Farm context' },
  { role: 'user' as const, content: 'What is my FCR?' },
]

async function saveKey(s: S, providerId = 'openai', model = 'gpt-4o-mini') {
  return await s.as(s.adminA).action(api.llmGateway.saveCredential, { providerId, model, apiKey: ORG_KEY })
}
const usageRows = (s: S) => s.t.run((ctx) => ctx.db.query('llmUsage').collect())

beforeEach(() => {
  vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', TEST_KEY)
  listStep = json(200, OPENAI_MODELS)
  listCalls = []
  stubFetch([json(500, {})])
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('gateway rules', () => {
  test('models, caps and cost estimate', () => {
    // Syntax only: whether the provider offers it is checked against the live list.
    expect(modelProblem('openai', 'gpt-4o')).toBeNull()
    expect(modelProblem('openai', '')).toBeNull()
    expect(modelProblem('openai', 'bad id with spaces')).toBe('Enter a model id')
    expect(modelProblem('custom', 'llama3:8b')).toBeNull()
    expect(modelProblem('nope', 'x')).toBe('Unknown provider')
    expect(messagesProblem([])).toBe('messages are required')
    expect(messagesProblem([{ role: 'user', content: 'x'.repeat(60_001) }])).toContain('too long')
    expect(messagesProblem([{ role: 'system', content: 'x'.repeat(100_000) }, { role: 'user', content: 'q' }])).toBeNull()
    expect(messagesProblem([{ role: 'system', content: 'x'.repeat(400_001) }])).toContain('too large')
    // No built-in price table: unknown unless listed (OpenRouter) or set in LLM_MODEL_PRICES.
    expect(estimateCostUsd('gpt-4o-mini', 1000, 500, undefined, '')).toBeUndefined()
    expect(estimateCostUsd('gpt-4o-mini', 1000, 500, { inputPerM: 0.15, outputPerM: 0.6 }, '')).toBeCloseTo(0.00045, 8)
    expect(estimateCostUsd('gpt-4o-mini', 1000, 500, { inputPerM: 9, outputPerM: 9 }, '{"gpt-4o-mini":[0.15,0.6]}')).toBeCloseTo(0.00045, 8)
    expect(estimateCostUsd('gpt-4o-mini', 1000, 500, undefined, 'not json')).toBeUndefined()
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
    listStep = json(200, { data: [{ id: 'llama3' }] })
    await s.as(s.adminA).action(api.llmGateway.saveCredential, {
      providerId: 'custom', model: 'llama3', apiKey: ORG_KEY, baseUrl: 'https://llm.example.com/v1/',
    })
    expect(listCalls[listCalls.length - 1]?.url).toBe('https://llm.example.com/v1/models')
    const calls = stubFetch([OPENAI_OK])
    await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    expect(calls[0].url).toBe('https://llm.example.com/v1/chat/completions')
    expect(calls[0].body.model).toBe('llama3')
  })

  test('a key the provider refuses (4xx on the model list) is not saved; the list is not retried', async () => {
    const s = await setup()
    listStep = json(401, { error: { message: 'Incorrect API key provided' } })
    await expect(saveKey(s)).rejects.toThrow('Incorrect API key provided')
    expect(listCalls).toHaveLength(1)
    expect(await s.t.run((ctx) => ctx.db.query('llmCredentials').collect())).toHaveLength(0)
  })

  test('an unreachable provider does not block saving', async () => {
    const s = await setup()
    listStep = json(503, {})
    await saveKey(s)
    expect(listCalls).toHaveLength(3) // first try + 2 retries on 5xx
    expect(await s.t.run((ctx) => ctx.db.query('llmCredentials').collect())).toHaveLength(1)
  })

  test('automatic model: empty saved model uses the live default', async () => {
    const s = await setup()
    await saveKey(s, 'openai', '')
    const calls = stubFetch([OPENAI_OK])
    const reply = await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    expect(reply).toMatchObject({ handled: true, model: 'gpt-4o-mini', fallback: false })
    expect(calls[0].body.model).toBe('gpt-4o-mini')
  })
})

describe('live model list on the org key (D-022)', () => {
  test('a stale requested or saved id falls back to the default and the reply says so', async () => {
    const s = await setup()
    await saveKey(s, 'openai', 'gpt-4o')
    // The provider retires gpt-4o after it was saved.
    await s.t.run(async (ctx) => {
      for (const r of await ctx.db.query('llmModelCache').collect()) {
        await ctx.db.patch(r._id, { models: [{ id: 'gpt-4o-mini', vision: true, created: 1 }] })
      }
    })
    const calls = stubFetch([OPENAI_OK])
    const reply = await s.as(s.managerA).action(api.llmGateway.chat, {
      feature: 'chat', messages: MESSAGES, model: 'gemini-1.5-flash',
    })
    expect(reply).toMatchObject({ handled: true, model: 'gpt-4o-mini', fallback: true, requestedModel: 'gemini-1.5-flash' })
    expect(calls[0].body.model).toBe('gpt-4o-mini')
    expect((await usageRows(s))[0]).toMatchObject({ model: 'gpt-4o-mini' })
  })

  test('allow-list: an id the provider does not list is never sent; LLM_EXTRA_MODELS adds one', async () => {
    const s = await setup()
    await saveKey(s)
    let calls = stubFetch([OPENAI_OK])
    await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES, model: 'gpt-5-pro-expensive' })
    expect(calls[0].body.model).toBe('gpt-4o-mini')
    vi.stubEnv('LLM_EXTRA_MODELS', 'my-finetune')
    calls = stubFetch([OPENAI_OK])
    await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES, model: 'my-finetune' })
    expect(calls[0].body.model).toBe('my-finetune')
  })

  test('cache: the list fetched when the key was saved serves later calls (no second fetch)', async () => {
    const s = await setup()
    await saveKey(s)
    expect(listCalls).toHaveLength(1)
    stubFetch([OPENAI_OK])
    await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    expect(listCalls).toHaveLength(1)
    const rows = await s.t.run((ctx) => ctx.db.query('llmModelCache').collect())
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(ORG_KEY)
    expect(rows[0].models.map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-4o'])
  })

  test('unreachable provider: clear error without an env default, the env default with one', async () => {
    const s = await setup()
    await saveKey(s)
    await s.t.run(async (ctx) => {
      for (const r of await ctx.db.query('llmModelCache').collect()) await ctx.db.delete(r._id)
    })
    listStep = () => {
      throw new TypeError('fetch failed')
    }
    let calls = stubFetch([OPENAI_OK])
    await expect(s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })).rejects.toThrow(
      "Can't reach ChatGPT (OpenAI) to list models; set LLM_DEFAULT_MODEL_OPENAI",
    )
    expect(calls).toHaveLength(0)
    vi.stubEnv('LLM_DEFAULT_MODEL_OPENAI', 'gpt-4o')
    calls = stubFetch([OPENAI_OK])
    const reply = await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES, model: 'gpt-4o-mini' })
    expect(reply).toMatchObject({ model: 'gpt-4o', fallback: true })
  })

  test('tenant isolation: lists are per company and per key; members only; no key in the reply', async () => {
    const s = await setup()
    await saveKey(s)
    const mine = await s.as(s.managerA).action(api.llmModels.list, {})
    expect(mine).toMatchObject({ hasOrgKey: true })
    expect(mine.providers[0]).toMatchObject({ id: 'openai', model: 'gpt-4o-mini', error: null })
    expect(mine.providers[0].models.map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-4o'])
    expect(JSON.stringify(mine)).not.toContain(ORG_KEY)
    // Company B sees none of A's keys or lists.
    expect(await s.as(s.adminB).action(api.llmModels.list, {})).toEqual({ hasOrgKey: false, providers: [] })
    // Viewers (no ai.use) are refused.
    await expect(s.as(s.viewerA).action(api.llmModels.list, {})).rejects.toThrow()
    // B saving the very same key does not reuse A's cached list.
    const before = listCalls.length
    await s.as(s.adminB).action(api.llmGateway.saveCredential, { providerId: 'openai', model: '', apiKey: ORG_KEY })
    expect(listCalls.length).toBe(before + 1)
    expect(await s.t.run((ctx) => ctx.db.query('llmModelCache').collect())).toHaveLength(2)
  })

  test('preview lists a pasted key for admins only and stores nothing', async () => {
    const s = await setup()
    await expect(
      s.as(s.managerA).action(api.llmModels.preview, { providerId: 'openai', apiKey: ORG_KEY }),
    ).rejects.toThrow()
    const r = await s.as(s.adminA).action(api.llmModels.preview, { providerId: 'openai', apiKey: ORG_KEY })
    expect(r).toEqual({
      models: [
        { id: 'gpt-4o-mini', label: null, vision: true },
        { id: 'gpt-4o', label: null, vision: true },
      ],
      defaultModel: 'gpt-4o-mini',
      error: null,
    })
    expect(listCalls[0].headers.Authorization).toBe(`Bearer ${ORG_KEY}`)
    expect(await s.t.run((ctx) => ctx.db.query('llmCredentials').collect())).toHaveLength(0)
    await expect(
      s.as(s.adminA).action(api.llmModels.preview, { providerId: 'custom', apiKey: ORG_KEY, baseUrl: 'http://169.254.169.254/v1' }),
    ).rejects.toThrow('Base URL')
  })

  test('OpenRouter: listed prices drive the cost estimate', async () => {
    const s = await setup()
    listStep = json(200, {
      data: [
        {
          id: 'acme/fast-mini',
          created: 10,
          pricing: { prompt: '0.000001', completion: '0.000002' },
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        },
      ],
    })
    await saveKey(s, 'openrouter', '')
    stubFetch([OPENAI_OK])
    await s.as(s.managerA).action(api.llmGateway.chat, { feature: 'chat', messages: MESSAGES })
    const row = (await usageRows(s))[0]
    expect(row.model).toBe('acme/fast-mini')
    expect(row.costUsd).toBeCloseTo((1000 * 1 + 500 * 2) / 1_000_000, 8)
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
    vi.stubEnv('LLM_MODEL_PRICES', '{"gpt-4o":[2.5,10]}')
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
