import { describe, expect, it } from 'vitest'
import { GEMINI_CURRENT, currentModel } from './llmModels'
import { gatewayModel } from './llmGateway'
import { resolveAllowedModel } from '../../lib/llmProxyGuard'
import { LLM_PROVIDERS } from '../../lib/llmClient'

describe('retired model ids', () => {
  it('upgrades retired Gemini ids to the current model', () => {
    for (const m of ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro', 'models/gemini-2.0-flash']) {
      expect(currentModel('gemini', m)).toBe(GEMINI_CURRENT)
    }
  })
  it('leaves current and other providers alone', () => {
    expect(currentModel('gemini', GEMINI_CURRENT)).toBe(GEMINI_CURRENT)
    expect(currentModel('openai', 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(currentModel('openrouter', 'google/gemini-2.0-flash-001')).toBe('google/gemini-2.0-flash-001')
  })
  it('an org key saved with a retired model calls the current one', () => {
    expect(gatewayModel('gemini', 'gemini-2.0-flash')).toBe(GEMINI_CURRENT)
    expect(gatewayModel('gemini', 'gemini-2.0-flash', 'gemini-1.5-pro')).toBe(GEMINI_CURRENT)
  })
  it('the server proxy upgrades a retired model the browser saved instead of refusing it', () => {
    expect(resolveAllowedModel(LLM_PROVIDERS.gemini, 'gemini-2.0-flash')).toBe(GEMINI_CURRENT)
    expect(resolveAllowedModel(LLM_PROVIDERS.gemini, undefined)).toBe(GEMINI_CURRENT)
    expect(resolveAllowedModel(LLM_PROVIDERS.gemini, 'not-a-model')).toBeNull()
  })
})
