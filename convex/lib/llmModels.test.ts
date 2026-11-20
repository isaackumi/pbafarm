import { describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import { fetchLayer, type FetchFn } from './effectHttp'
import {
  type ListTarget,
  type ModelInfo,
  createModelCache,
  envDefaultModel,
  envModelPrices,
  listModels,
  modelFingerprint,
  pickDefaultModel,
  pickerModels,
  resolveModel,
} from './llmModels'

/** Scripted fetch: one step per call (the last repeats). Records url + headers. */
function fake(steps: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    return steps[Math.min(calls.length - 1, steps.length - 1)](url, init)
  }
  return { fn, calls }
}
const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const run = (t: ListTarget, fn: FetchFn) =>
  Effect.runPromise(Effect.result(listModels(t).pipe(Effect.provide(fetchLayer(fn)))))

const GEMINI: ListTarget = { providerId: 'gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIza-k' }
const OPENAI: ListTarget = { providerId: 'openai', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-k' }
const ANTHROPIC: ListTarget = { providerId: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-k' }
const GROQ: ListTarget = { providerId: 'groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_k' }
const OPENROUTER: ListTarget = { providerId: 'openrouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-k' }
const CUSTOM: ListTarget = { providerId: 'custom', kind: 'openai', baseUrl: 'https://llm.example.com/v1/', apiKey: 'k-123456' }

const ids = (r: Result.Result<ModelInfo[], unknown>) => (Result.isSuccess(r) ? r.success.map((m) => m.id) : r)

describe('listing per provider (parse + filter)', () => {
  it('Gemini: paginates, keeps generateContent models, strips models/, drops embeddings/tts/image-gen; key in a header', async () => {
    const { fn, calls } = fake([
      json(200, {
        models: [
          { name: 'models/gemini-9-flash', displayName: 'Gemini 9 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-9-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
        ],
        nextPageToken: 'p2',
      }),
      json(200, {
        models: [
          { name: 'models/gemini-9-flash-image', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-9-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/aqa', supportedGenerationMethods: ['generateAnswer'] },
        ],
      }),
    ])
    const r = await run(GEMINI, fn)
    expect(ids(r)).toEqual(['gemini-9-flash', 'gemini-9-pro'])
    if (Result.isSuccess(r)) expect(r.success[0]).toMatchObject({ label: 'Gemini 9 Flash', vision: true })
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toContain('pageToken=p2')
    expect(calls.every((c) => !c.url.includes('AIza-k') && c.headers['x-goog-api-key'] === 'AIza-k')).toBe(true)
  })

  it('OpenAI: chat-completions models only, vision by family', async () => {
    const { fn, calls } = fake([
      json(200, {
        data: [
          { id: 'gpt-9-mini', created: 5 },
          { id: 'text-embedding-3-large', created: 1 },
          { id: 'whisper-1', created: 1 },
          { id: 'tts-1', created: 1 },
          { id: 'dall-e-3', created: 1 },
          { id: 'omni-moderation-latest', created: 1 },
          { id: 'gpt-4o-realtime-preview', created: 1 },
          { id: 'gpt-3.5-turbo-instruct', created: 1 },
          { id: 'gpt-9-pro', created: 1 },
          { id: 'davinci-002', created: 1 },
          { id: 'o9', created: 4 },
        ],
      }),
    ])
    const r = await run(OPENAI, fn)
    expect(ids(r)).toEqual(['gpt-9-mini', 'o9'])
    expect(calls[0]).toMatchObject({ url: 'https://api.openai.com/v1/models', headers: { Authorization: 'Bearer sk-k' } })
  })

  it('Anthropic: paginates with after_id; x-api-key and anthropic-version headers', async () => {
    const { fn, calls } = fake([
      json(200, { data: [{ id: 'claude-haiku-9', display_name: 'Claude Haiku 9', created_at: '2026-10-01T00:00:00Z' }], has_more: true, last_id: 'claude-haiku-9' }),
      json(200, { data: [{ id: 'claude-opus-9', created_at: '2026-09-01T00:00:00Z' }], has_more: false }),
    ])
    const r = await run(ANTHROPIC, fn)
    expect(ids(r)).toEqual(['claude-haiku-9', 'claude-opus-9'])
    expect(calls[0].headers).toMatchObject({ 'x-api-key': 'sk-ant-k', 'anthropic-version': '2023-06-01' })
    expect(calls[1].url).toContain('after_id=claude-haiku-9')
    if (Result.isSuccess(r)) expect(r.success[0].created).toBe(Date.parse('2026-10-01T00:00:00Z') / 1000)
  })

  it('Groq: drops inactive, speech and guard models', async () => {
    const { fn, calls } = fake([
      json(200, {
        data: [
          { id: 'llama-9-8b-instant', created: 2, active: true },
          { id: 'whisper-large-v3', created: 2, active: true },
          { id: 'meta-llama/llama-guard-4-12b', created: 2, active: true },
          { id: 'playai-tts', created: 2, active: true },
          { id: 'old-model', created: 1, active: false },
        ],
      }),
    ])
    expect(ids(await run(GROQ, fn))).toEqual(['llama-9-8b-instant'])
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/models')
  })

  it('OpenRouter: text output only, modalities and prices from the API', async () => {
    const { fn } = fake([
      json(200, {
        data: [
          {
            id: 'acme/vision-mini',
            name: 'Acme Vision Mini',
            created: 9,
            pricing: { prompt: '0.0000002', completion: '0.0000008' },
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          },
          { id: 'acme/painter', architecture: { input_modalities: ['text'], output_modalities: ['image', 'text'] } },
          { id: 'acme/legacy', architecture: { modality: 'text->text' }, pricing: { prompt: '-1', completion: '-1' } },
        ],
      }),
    ])
    const r = await run(OPENROUTER, fn)
    expect(Result.isSuccess(r) && r.success).toEqual([
      { id: 'acme/vision-mini', label: 'Acme Vision Mini', vision: true, created: 9, inputPerM: 0.2, outputPerM: 0.8 },
      { id: 'acme/legacy', label: undefined, vision: false, created: undefined, inputPerM: undefined, outputPerM: undefined },
    ])
  })

  it('custom: {base}/models; a missing base URL fails without a request', async () => {
    const { fn, calls } = fake([json(200, { data: [{ id: 'llama3:8b' }, { id: 'nomic-embed-text' }] })])
    expect(ids(await run(CUSTOM, fn))).toEqual(['llama3:8b'])
    expect(calls[0].url).toBe('https://llm.example.com/v1/models')
    const empty = fake([json(200, { data: [] })])
    const r = await run({ ...CUSTOM, baseUrl: '' }, empty.fn)
    expect(Result.isFailure(r) && r.failure.message).toContain('base URL')
    expect(empty.calls).toHaveLength(0)
  })
})

describe('transport policy', () => {
  it('4xx is not retried and carries the provider message and status', async () => {
    const { fn, calls } = fake([json(401, { error: { message: 'API key not valid' } })])
    const r = await run(OPENAI, fn)
    expect(Result.isFailure(r) && r.failure).toMatchObject({ message: 'API key not valid', status: 401 })
    expect(calls).toHaveLength(1)
  })

  it('5xx is retried, then succeeds', async () => {
    const { fn, calls } = fake([json(503, {}), json(502, {}), json(200, { data: [{ id: 'gpt-9-mini' }] })])
    expect(ids(await run(OPENAI, fn))).toEqual(['gpt-9-mini'])
    expect(calls).toHaveLength(3)
  })

  it('a timeout fails with a readable message after the retries', async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const { fn, calls } = fake([hang])
    const r = await run({ ...OPENAI, policy: { timeoutMs: 20, retries: 2, retryBaseDelayMs: 1 } }, fn)
    expect(Result.isFailure(r) && r.failure.message).toBe('openai did not list its models within 0.02 seconds')
    expect(calls).toHaveLength(3)
  })

  it('a 2xx body of the wrong shape is a decode failure (not retried)', async () => {
    const { fn, calls } = fake([json(200, { models: 'nope' })])
    const r = await run(OPENAI, fn)
    expect(Result.isFailure(r) && r.failure.message).toBe('Unexpected model list from openai')
    expect(calls).toHaveLength(1)
  })

  it('an empty key fails without a request', async () => {
    const { fn, calls } = fake([json(200, { data: [] })])
    expect(Result.isFailure(await run({ ...OPENAI, apiKey: ' ' }, fn))).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

const m = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, vision: false, ...extra })

describe('pickDefaultModel (the one rule)', () => {
  it('prefers the newest stable fast tier; never preview/experimental while a stable one exists', () => {
    expect(
      pickDefaultModel([
        m('gemini-9-pro'),
        m('gemini-9-flash-preview-09-2026'),
        m('gemini-8-flash'),
        m('gemini-9-flash'),
        m('gemini-9-flash-lite'),
        m('gemini-10-flash-exp'),
        m('gemini-flash-latest'),
      ]),
    ).toBe('gemini-9-flash')
  })
  it('uses release time when the provider gives it, and the alias over a dated snapshot', () => {
    expect(pickDefaultModel([m('gpt-9-mini', { created: 10 }), m('gpt-8-mini', { created: 20 }), m('gpt-9', { created: 30 })])).toBe('gpt-8-mini')
    expect(pickDefaultModel([m('gpt-9-mini-2026-01-01', { created: 5 }), m('gpt-9-mini', { created: 5 })])).toBe('gpt-9-mini')
  })
  it('falls back to preview only when nothing else, lite before the rest, and filters vision', () => {
    expect(pickDefaultModel([m('x-9-preview'), m('x-8-exp')])).toBe('x-9-preview')
    expect(pickDefaultModel([m('x-9-pro'), m('x-9-lite')])).toBe('x-9-lite')
    expect(pickDefaultModel([m('a-mini'), m('b-pro', { vision: true })], { vision: true })).toBe('b-pro')
    expect(pickDefaultModel([m('a-mini')], { vision: true })).toBeNull()
    expect(pickDefaultModel([])).toBeNull()
    expect(pickDefaultModel([m('openai/gpt-9-mini:free', { created: 9 }), m('openai/gpt-9-mini', { created: 8 })])).toBe('openai/gpt-9-mini')
  })
})

describe('resolveModel', () => {
  const live = [m('gemini-9-flash'), m('gemini-9-pro', { vision: true })]
  it('a stale saved id (gemini-1.5-flash) falls back to the default and is reported', () => {
    expect(resolveModel({ providerId: 'gemini', models: live, requested: 'gemini-1.5-flash', env: {} })).toEqual({
      ok: true, model: 'gemini-9-flash', defaultModel: 'gemini-9-flash', fallback: true, replaced: 'gemini-1.5-flash',
    })
    expect(resolveModel({ providerId: 'gemini', models: live, saved: 'gemini-1.5-flash', env: {} })).toMatchObject({ model: 'gemini-9-flash', fallback: true })
  })
  it('requested beats saved; nothing asked = default, no fallback', () => {
    expect(resolveModel({ providerId: 'gemini', models: live, requested: 'gemini-9-pro', saved: 'gemini-9-flash', env: {} })).toMatchObject({ model: 'gemini-9-pro', fallback: false })
    expect(resolveModel({ providerId: 'gemini', models: live, requested: 'gone', saved: 'gemini-9-pro', env: {} })).toMatchObject({ model: 'gemini-9-pro', fallback: true })
    expect(resolveModel({ providerId: 'gemini', models: live, env: {} })).toMatchObject({ model: 'gemini-9-flash', fallback: false })
  })
  it('allow-list = live list + LLM_EXTRA_MODELS; unknown ids are never returned', () => {
    expect(resolveModel({ providerId: 'gemini', models: live, requested: 'gpt-5-pro-expensive', env: {} })).toMatchObject({ model: 'gemini-9-flash' })
    expect(resolveModel({ providerId: 'gemini', models: live, requested: 'tuned-1', env: { LLM_EXTRA_MODELS: ' tuned-1 , x' } })).toMatchObject({ model: 'tuned-1', fallback: false })
  })
  it('env default wins when listed; ignored when not', () => {
    expect(resolveModel({ providerId: 'gemini', models: live, env: { LLM_DEFAULT_MODEL_GEMINI: 'gemini-9-pro' } })).toMatchObject({ defaultModel: 'gemini-9-pro' })
    expect(resolveModel({ providerId: 'gemini', models: live, env: { LLM_DEFAULT_MODEL: 'gemini-9-pro' } })).toMatchObject({ defaultModel: 'gemini-9-pro' })
    expect(resolveModel({ providerId: 'gemini', models: live, env: { LLM_DEFAULT_MODEL_GEMINI: 'gemini-1.5-flash' } })).toMatchObject({ defaultModel: 'gemini-9-flash' })
  })
  it('list unreachable: env default only, else a clear error (never a stale id)', () => {
    expect(resolveModel({ providerId: 'gemini', label: 'Gemini (Google)', models: null, requested: 'gemini-1.5-flash', env: {} })).toEqual({
      ok: false,
      error: "Can't reach Gemini (Google) to list models; set LLM_DEFAULT_MODEL_GEMINI",
    })
    expect(resolveModel({ providerId: 'gemini', models: null, requested: 'gemini-1.5-flash', env: { LLM_DEFAULT_MODEL_GEMINI: 'gemini-9-flash' } })).toMatchObject({
      ok: true, model: 'gemini-9-flash', fallback: true,
    })
    expect(resolveModel({ providerId: 'gemini', models: [], env: {} })).toMatchObject({ ok: false })
  })
  it('vision: only image-capable models; LLM_VISION_MODEL[_<PROVIDER>] override', () => {
    expect(resolveModel({ providerId: 'gemini', models: live, saved: 'gemini-9-flash', env: {}, vision: true })).toMatchObject({ model: 'gemini-9-pro' })
    expect(envDefaultModel('gemini', { LLM_VISION_MODEL_GEMINI: 'v1', LLM_VISION_MODEL: 'v2' }, { vision: true })).toBe('v1')
    expect(envDefaultModel('custom', { BOT_VISION_MODEL: 'v3' }, { vision: true })).toBe('v3')
    expect(resolveModel({ providerId: 'groq', models: [m('llama-9-instant')], env: {}, vision: true })).toMatchObject({ ok: false })
  })
})

describe('cache and prices', () => {
  it('cache hit avoids a second fetch; expires after the TTL', async () => {
    let now = 0
    const cache = createModelCache({ ttlMs: 1000, now: () => now })
    let fetches = 0
    const load = async (fp: string) => {
      const hit = cache.get(fp)
      if (hit) return hit
      fetches += 1
      const models = [m('x')]
      cache.set(fp, models)
      return models
    }
    await load('fp')
    await load('fp')
    expect(fetches).toBe(1)
    now = 1000
    await load('fp')
    expect(fetches).toBe(2)
  })
  it('the fingerprint is a hash: scoped, key-specific, never containing the key', async () => {
    const a = await modelFingerprint(OPENAI, 'server')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toContain('sk-k')
    expect(await modelFingerprint(OPENAI, 'company1')).not.toBe(a)
    expect(await modelFingerprint({ ...OPENAI, apiKey: 'sk-other' }, 'server')).not.toBe(a)
  })
  it('LLM_MODEL_PRICES parsing ignores junk; picker shows extras and an env default', () => {
    expect(envModelPrices('{"a":[1,2],"b":[1],"c":"x"}')).toEqual({ a: { inputPerM: 1, outputPerM: 2 } })
    expect(envModelPrices('{oops')).toEqual({})
    expect(pickerModels(null, { LLM_EXTRA_MODELS: 'e1' }, 'd1').map((x) => x.id)).toEqual(['e1', 'd1'])
  })
})
