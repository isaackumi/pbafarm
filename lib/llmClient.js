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

/**
 * Provider metadata only. Model ids are never listed here: the server
 * fetches each provider's live list (/api/llm/models, D-022) and picks the
 * default. Mirrored in convex/lib/llmGateway.ts PROVIDERS.
 */
export const LLM_PROVIDERS = {
  openai: { id: 'openai', label: 'ChatGPT (OpenAI)', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyPlaceholder: 'sk-…' },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyPlaceholder: 'AIza…',
  },
  openrouter: { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyPlaceholder: 'sk-or-…' },
  anthropic: { id: 'anthropic', label: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyPlaceholder: 'sk-ant-…' },
  groq: { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyPlaceholder: 'gsk_…' },
  custom: { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', keyPlaceholder: 'API key' },
}

const STORAGE = 'pbafarm_llm_settings'

function defaultSettings() {
  // No model saved = the server's default from the live list.
  return {
    provider: '',
    models: {},
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
 *
 * Returns `{ text, provider, model, fallback }`: `model` is the model the
 * server actually used; `fallback` is true when the requested model is not
 * offered any more and the server used its default instead (D-022).
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
      provider: opts.provider || undefined,
      model: opts.model || undefined,
      messages: opts.messages,
      temperature: opts.temperature,
      asOf: opts.asOf,
      locationId: opts.locationId || undefined,
      days: opts.days || undefined,
      deep: opts.deep || undefined,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body?.error || `Assistant request failed (${res.status})`)
  }
  if (!body?.text) throw new Error('Empty response from assistant')
  return {
    text: body.text,
    provider: typeof body.provider === 'string' ? body.provider : null,
    model: typeof body.model === 'string' ? body.model : null,
    fallback: body.fallback === true,
  }
}

/**
 * The models each usable provider offers now (GET /api/llm/models):
 * `{ source, defaultProvider, providers: [{ id, label, defaultModel, models:
 * [{ id, label, vision }], error }] }`. Throws with the server's message.
 */
export async function fetchLlmModels() {
  const res = await fetch('/api/llm/models', { headers: authHeaders() })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Could not load models (${res.status})`)
  return body
}

/**
 * The model to send for a provider: the saved one when the live list still
 * offers it, else the provider's default (null while unknown).
 */
export function effectiveModel(provider, saved) {
  if (!provider) return null
  if (saved && (provider.models || []).some((m) => m.id === saved)) return saved
  return provider.defaultModel || null
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

/**
 * Ask Anowa to draft an automation from a request (AI-AUTO-001). Returns
 * `{ draft, explanation, problems, catalog, startPaused, canSave }`; nothing
 * is saved until the member confirms in the chat card.
 */
export async function draftAutomation({ request, provider, model }) {
  const res = await fetch('/api/llm/automation-draft', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ request, provider, model }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Automation draft failed (${res.status})`)
  return body
}
