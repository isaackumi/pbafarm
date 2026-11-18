/**
 * LLM chat helpers for the browser: provider list, saved provider/model
 * choice, and the call to the server proxy. Provider calls live in
 * convex/lib/llmProviders.ts (server only).
 */

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
  return {
    provider: 'gemini',
    models,
    customBaseUrl: process.env.NEXT_PUBLIC_CUSTOM_LLM_BASE_URL || '',
  }
}

/** Settings without any provider key: keys live on the server only (SEC-004). */
function withoutKeys(settings) {
  if (!settings || typeof settings !== 'object') return {}
  const { keys: _keys, apiKey: _apiKey, ...rest } = settings
  return rest
}

/**
 * Provider and model choices saved in this browser. Keys pasted by older
 * versions are dropped from storage on read and never returned.
 */
export function loadLlmSettings() {
  const defaults = defaultSettings()
  if (typeof window === 'undefined') return defaults
  let saved = null
  try {
    const raw = localStorage.getItem(STORAGE)
    if (raw) saved = JSON.parse(raw)
  } catch {
    /* ignore */
  }
  const legacyModel = localStorage.getItem('pbafarm_openai_model')
  if (localStorage.getItem('pbafarm_openai_api_key') !== null || saved?.keys || saved?.apiKey) {
    clearLlmKeys()
  }
  if (saved && typeof saved === 'object') {
    const clean = withoutKeys(saved)
    return { ...defaults, ...clean, models: { ...defaults.models, ...(clean.models || {}) } }
  }
  if (legacyModel) {
    return { ...defaults, provider: 'openai', models: { ...defaults.models, openai: legacyModel } }
  }
  return defaults
}

export function saveLlmSettings(settings) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE, JSON.stringify(withoutKeys(settings)))
}

/**
 * Forget API keys pasted into the assistant by older versions (they were kept
 * in plaintext localStorage) while keeping provider/model choices. Run on
 * load and at sign-out.
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
      delete parsed.apiKey
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
