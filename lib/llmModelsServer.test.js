import { describe, expect, it } from 'vitest'
import { createModelCache } from '../convex/lib/llmModels'
import { resolveProvider } from './llmServer'
import { effectiveModel } from './llmClient'

/** Fake Gemini: GET /models lists two models; counts list calls. */
function fakeGemini(status = 200) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init?.headers })
    if (status !== 200) return new Response(JSON.stringify({ error: { message: 'down' } }), { status })
    return new Response(
      JSON.stringify({
        models: [
          { name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-9-pro', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
      { status: 200 },
    )
  }
  return { calls, fetchImpl }
}

const opts = (fetchImpl, cache = createModelCache()) => ({ fetchImpl, cache, readKey: () => 'AIza-server-key' })

describe('server-key model choice (/api/llm/chat, D-022)', () => {
  it('a stale saved browser id falls back to the live default and says so', async () => {
    const { fetchImpl } = fakeGemini()
    const r = await resolveProvider('gemini', 'gemini-1.5-flash', {}, opts(fetchImpl))
    expect(r).toMatchObject({ providerId: 'gemini', model: 'gemini-9-flash', fallback: true, requestedModel: 'gemini-1.5-flash' })
    expect(r.chat).toMatchObject({ kind: 'gemini', model: 'gemini-9-flash', apiKey: 'AIza-server-key' })
  })

  it('a listed model is used as asked; unknown ids are refused by falling back', async () => {
    const { fetchImpl } = fakeGemini()
    expect(await resolveProvider('gemini', 'gemini-9-pro', {}, opts(fetchImpl))).toMatchObject({ model: 'gemini-9-pro', fallback: false })
    expect(await resolveProvider('gemini', 'gpt-5-pro-expensive', {}, opts(fetchImpl))).toMatchObject({ model: 'gemini-9-flash', fallback: true })
  })

  it('cache hit avoids a second list fetch', async () => {
    const { fetchImpl, calls } = fakeGemini()
    const cache = createModelCache()
    await resolveProvider('gemini', undefined, {}, opts(fetchImpl, cache))
    await resolveProvider('gemini', 'gemini-9-pro', {}, opts(fetchImpl, cache))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).not.toContain('AIza-server-key')
  })

  it('unreachable provider: 503 with what to set, or the env default', async () => {
    const { fetchImpl } = fakeGemini(401)
    expect(await resolveProvider('gemini', 'gemini-1.5-flash', {}, opts(fetchImpl))).toEqual({
      status: 503,
      error: "Can't reach Gemini (Google) to list models; set LLM_DEFAULT_MODEL_GEMINI (down)",
    })
    const withEnv = await resolveProvider('gemini', 'gemini-1.5-flash', { LLM_DEFAULT_MODEL_GEMINI: 'gemini-9-flash' }, opts(fetchImpl))
    expect(withEnv).toMatchObject({ model: 'gemini-9-flash', fallback: true })
  })

  it('no server key: 400 before any request', async () => {
    const { fetchImpl, calls } = fakeGemini()
    const r = await resolveProvider('gemini', undefined, {}, { fetchImpl, readKey: () => '' })
    expect(r.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('effectiveModel (browser)', () => {
  const provider = { defaultModel: 'gemini-9-flash', models: [{ id: 'gemini-9-flash' }, { id: 'gemini-9-pro' }] }
  it('keeps a saved model the live list still has; otherwise the server default', () => {
    expect(effectiveModel(provider, 'gemini-9-pro')).toBe('gemini-9-pro')
    expect(effectiveModel(provider, 'gemini-1.5-flash')).toBe('gemini-9-flash')
    expect(effectiveModel(provider, '')).toBe('gemini-9-flash')
    expect(effectiveModel(null, 'x')).toBeNull()
  })
})
