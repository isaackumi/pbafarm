/**
 * LLM chat helpers for the browser: provider list, saved provider/model
 * choice, and the call to the server proxy. Provider calls live in
 * convex/lib/llmProviders.ts (server only).
 */

import { readPublicProviderKeys } from './llmEnv'
import { getConvexAuthToken } from './convexBridge'

function authHeaders() {
  const token = getConvexAuthToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export const LLM_PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
    keyPlaceholder: 'sk-…',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models: [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
    ],
    keyPlaceholder: 'AIza…',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      'openai/gpt-4o-mini',
      'openai/gpt-4o',
      'google/gemini-2.0-flash-001',
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.1-70b-instruct',
    ],
    keyPlaceholder: 'sk-or-…',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-sonnet-4-0',
    ],
    keyPlaceholder: 'sk-ant-…',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    keyPlaceholder: 'gsk_…',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini',
    models: [],
    keyPlaceholder: 'API key',
  },
}

const STORAGE = 'pbafarm_llm_settings'

function defaultSettings() {
  const models = {}
  for (const p of Object.values(LLM_PROVIDERS)) {
    models[p.id] = p.defaultModel
  }
  const publicKeys = readPublicProviderKeys()
  const provider =
    (publicKeys.gemini && 'gemini') ||
    Object.keys(publicKeys)[0] ||
    'gemini'
  return {
    provider,
    keys: { ...publicKeys },
    models,
    customBaseUrl: process.env.NEXT_PUBLIC_CUSTOM_LLM_BASE_URL || '',
  }
}

/** Merge saved settings with public env keys (env fills gaps; localStorage wins). */
export function loadLlmSettings() {
  if (typeof window === 'undefined') {
    return defaultSettings()
  }
  const defaults = defaultSettings()
  try {
    const raw = localStorage.getItem(STORAGE)
    if (raw) {
      const parsed = JSON.parse(raw)
      const localKeys = parsed.keys || {}
      // Prefer non-empty local keys; fill missing from public env
      const keys = { ...defaults.keys }
      for (const [id, value] of Object.entries(localKeys)) {
        if (String(value || '').trim()) keys[id] = value
      }
      return {
        ...defaults,
        ...parsed,
        keys,
        models: { ...defaults.models, ...(parsed.models || {}) },
      }
    }
  } catch {
    /* ignore */
  }

  // Migrate legacy OpenAI-only keys
  const legacyKey = localStorage.getItem('pbafarm_openai_api_key')
  const legacyModel = localStorage.getItem('pbafarm_openai_model')
  if (legacyKey) {
    return {
      ...defaults,
      provider: 'openai',
      keys: { ...defaults.keys, openai: legacyKey },
      models: {
        ...defaults.models,
        ...(legacyModel ? { openai: legacyModel } : {}),
      },
    }
  }

  return defaults
}

export function saveLlmSettings(settings) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE, JSON.stringify(settings))
}

/**
 * Forget API keys pasted into the assistant (kept in plaintext localStorage)
 * while keeping provider/model choices. Called at sign-out so the next person
 * on a shared phone or PC cannot reuse them.
 */
export function clearLlmKeys() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('pbafarm_openai_api_key')
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      delete parsed.keys
      localStorage.setItem(STORAGE, JSON.stringify(parsed))
    } else {
      localStorage.removeItem(STORAGE)
    }
  } catch {
    try {
      localStorage.removeItem(STORAGE)
    } catch {
      /* storage unavailable */
    }
  }
}

export function clearLlmSettings() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE)
  localStorage.removeItem('pbafarm_openai_api_key')
  localStorage.removeItem('pbafarm_openai_model')
}

/**
 * Ask the assistant. Always through the server proxy (/api/llm/chat, PLAT-006):
 * the browser never calls a provider and never holds a provider key. The
 * server adds the farm context for the signed-in user; send only the
 * conversation (user and assistant turns).
 * @param {{ provider?, model?, messages, temperature?, asOf? }} opts
 */
export async function chatCompletion(opts) {
  if (typeof window === 'undefined') {
    throw new Error('chatCompletion runs in the browser; servers use convex/lib/llmProviders')
  }
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      provider: opts.provider,
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      asOf: opts.asOf,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body?.error || `Assistant request failed (${res.status})`)
  }
  if (!body?.text) throw new Error('Empty response from assistant')
  return body.text
}

export async function fetchLlmEnvStatus() {
  try {
    const res = await fetch('/api/llm/status', { headers: authHeaders() })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
