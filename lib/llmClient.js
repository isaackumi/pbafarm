/**
 * LLM chat helpers. Keys: localStorage override, NEXT_PUBLIC_* env, or server env via /api/llm/chat.
 * Supports OpenAI-compatible APIs + Gemini + Anthropic.
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

export function clearLlmSettings() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE)
  localStorage.removeItem('pbafarm_openai_api_key')
  localStorage.removeItem('pbafarm_openai_model')
}

function extractOpenAiError(body, status) {
  return (
    body?.error?.message ||
    body?.error?.metadata?.raw ||
    body?.message ||
    `LLM request failed (${status})`
  )
}

async function chatOpenAiCompatible({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.3,
  extraHeaders = {},
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ model, temperature, messages }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractOpenAiError(body, res.status))
  const text = body?.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Empty response from model')
  return text
}

async function chatGemini({ apiKey, model, messages, temperature = 0.3 }) {
  const system = messages.find((m) => m.role === 'system')?.content
  const rest = messages.filter((m) => m.role !== 'system')

  const contents = rest.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`

  const payload = {
    contents,
    generationConfig: { temperature },
  }
  if (system) {
    payload.systemInstruction = { parts: [{ text: system }] }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      body?.error?.message || `Gemini request failed (${res.status})`,
    )
  }
  const text = body?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim()
  if (!text) throw new Error('Empty response from Gemini')
  return text
}

async function chatAnthropic({ apiKey, model, messages, temperature = 0.3 }) {
  const system = messages.find((m) => m.role === 'system')?.content
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }))

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for browser calls if Anthropic CORS allows; otherwise use OpenRouter.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature,
      system: system || undefined,
      messages: rest,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      body?.error?.message || `Anthropic request failed (${res.status})`,
    )
  }
  const text = body?.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('Empty response from Claude')
  return text
}

/**
 * Send a chat completion with an explicit API key (browser public key or server env).
 * @param {{ provider, apiKey, model, customBaseUrl?, messages, temperature? }} opts
 */
export async function chatCompletionWithKey(opts) {
  const provider = LLM_PROVIDERS[opts.provider] || LLM_PROVIDERS.openai
  const apiKey = (opts.apiKey || '').trim()
  const model = (opts.model || provider.defaultModel).trim()
  if (!apiKey) throw new Error('API key is required')
  if (!model) throw new Error('Model is required')

  if (provider.kind === 'gemini') {
    return chatGemini({
      apiKey,
      model,
      messages: opts.messages,
      temperature: opts.temperature,
    })
  }

  if (provider.kind === 'anthropic') {
    return chatAnthropic({
      apiKey,
      model,
      messages: opts.messages,
      temperature: opts.temperature,
    })
  }

  const baseUrl =
    provider.id === 'custom'
      ? (opts.customBaseUrl || '').trim()
      : provider.baseUrl
  if (!baseUrl) {
    throw new Error('Custom provider needs a base URL (e.g. https://host/v1)')
  }

  const extraHeaders = {}
  if (provider.id === 'openrouter') {
    extraHeaders['HTTP-Referer'] =
      typeof window !== 'undefined' ? window.location.origin : 'https://localhost'
    extraHeaders['X-Title'] = 'PBA Farm Assistant'
  }

  return chatOpenAiCompatible({
    baseUrl,
    apiKey,
    model,
    messages: opts.messages,
    temperature: opts.temperature,
    extraHeaders,
  })
}

/**
 * Browser helper: use client/public key if present, otherwise call /api/llm/chat (server env).
 */
export async function chatCompletion(opts) {
  const apiKey = (opts.apiKey || '').trim()
  if (apiKey) {
    return chatCompletionWithKey(opts)
  }

  if (typeof window === 'undefined') {
    throw new Error('API key is required')
  }

  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      provider: opts.provider,
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      customBaseUrl: opts.customBaseUrl,
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
