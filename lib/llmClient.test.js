import { afterEach, describe, expect, it } from 'vitest'
import { clearLlmKeys, loadLlmSettings, saveLlmSettings } from './llmClient'

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

describe('clearLlmKeys (sign-out)', () => {
  afterEach(() => {
    delete globalThis.window
    delete globalThis.localStorage
  })

  it('removes pasted keys but keeps provider/model choices', () => {
    const storage = memoryStorage({
      pbafarm_llm_settings: JSON.stringify({
        provider: 'openai',
        keys: { openai: 'sk-secret' },
        models: { openai: 'gpt-4o' },
      }),
      pbafarm_openai_api_key: 'sk-legacy',
      other: 'kept',
    })
    globalThis.window = {}
    globalThis.localStorage = storage

    clearLlmKeys()

    const after = storage.dump()
    expect(after.pbafarm_openai_api_key).toBeUndefined()
    expect(after.other).toBe('kept')
    const saved = JSON.parse(after.pbafarm_llm_settings)
    expect(saved.keys).toBeUndefined()
    expect(saved.provider).toBe('openai')
    expect(saved.models).toEqual({ openai: 'gpt-4o' })
    expect(JSON.stringify(after)).not.toContain('sk-')
  })

  it('drops unreadable settings entirely', () => {
    const storage = memoryStorage({ pbafarm_llm_settings: '{not json' })
    globalThis.window = {}
    globalThis.localStorage = storage
    clearLlmKeys()
    expect(storage.dump().pbafarm_llm_settings).toBeUndefined()
  })
})

describe('provider keys are never kept in the browser (SEC-004)', () => {
  afterEach(() => {
    delete globalThis.window
    delete globalThis.localStorage
  })

  it('loading purges keys saved by older versions and returns none', () => {
    const storage = memoryStorage({
      pbafarm_llm_settings: JSON.stringify({ provider: 'openai', keys: { openai: 'sk-old' }, models: { openai: 'gpt-4o' } }),
      pbafarm_openai_api_key: 'sk-legacy',
    })
    globalThis.window = {}
    globalThis.localStorage = storage

    const settings = loadLlmSettings()

    expect(settings.keys).toBeUndefined()
    expect(settings.provider).toBe('openai')
    expect(settings.models.openai).toBe('gpt-4o')
    expect(JSON.stringify(storage.dump())).not.toContain('sk-')
  })

  it('saving drops any keys', () => {
    const storage = memoryStorage({})
    globalThis.window = {}
    globalThis.localStorage = storage
    saveLlmSettings({ provider: 'gemini', keys: { gemini: 'AIza-secret' }, models: {} })
    expect(storage.dump().pbafarm_llm_settings).not.toContain('secret')
  })
})

describe('LLM gateway provider mirror (INT-009)', () => {
  it('convex/lib/llmGateway PROVIDERS matches LLM_PROVIDERS', async () => {
    const { LLM_PROVIDERS } = await import('./llmClient')
    const { PROVIDERS } = await import('../convex/lib/llmGateway')
    expect(Object.keys(PROVIDERS).sort()).toEqual(Object.keys(LLM_PROVIDERS).sort())
    for (const [id, p] of Object.entries(LLM_PROVIDERS)) {
      const g = PROVIDERS[id]
      expect({ kind: g.kind, baseUrl: g.baseUrl, defaultModel: g.defaultModel, models: g.models }).toEqual({
        kind: p.kind,
        baseUrl: p.baseUrl,
        defaultModel: p.defaultModel,
        models: p.models,
      })
    }
  })

  it('message caps match llmProxyGuard', async () => {
    const guard = await import('./llmProxyGuard')
    const gw = await import('../convex/lib/llmGateway')
    expect([gw.MAX_MESSAGES, gw.MAX_MESSAGE_CHARS, gw.MAX_TOTAL_CHARS]).toEqual([
      guard.MAX_MESSAGES,
      guard.MAX_MESSAGE_CHARS,
      guard.MAX_TOTAL_CHARS,
    ])
  })
})
