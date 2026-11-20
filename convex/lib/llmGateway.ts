/**
 * LLM gateway rules (INT-009): providers an organization may store a key for,
 * model allow-list, message caps, and the cost estimate written to llmUsage.
 * Pure; shared by convex/llmGateway.ts and the Next proxy routes.
 *
 * PROVIDERS mirrors lib/llmClient.js LLM_PROVIDERS (llmGateway.test.ts checks
 * they match). The caps mirror lib/llmProxyGuard.js (SEC-004).
 */
import type { ProviderKind } from './llmProviders'
import { currentModel } from './llmModels'

export type GatewayProvider = {
  id: string
  label: string
  kind: ProviderKind
  /** Fixed endpoint; '' for custom (the admin's saved base URL, never the browser's). */
  baseUrl: string
  defaultModel: string
  models: string[]
}

export const PROVIDERS: Record<string, GatewayProvider> = {
  openai: {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash'],
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
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-sonnet-4-0'],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini',
    models: [],
  },
}

export const MAX_MODEL_CHARS = 100

/**
 * Model for a call on an org key: the requested one when the provider lists
 * it or it is the credential's saved model, else the saved model. Never an
 * arbitrary string from the browser (except the saved one for custom).
 */
export function gatewayModel(providerId: string, savedModel: string, requested?: string | null): string {
  const p = PROVIDERS[providerId]
  const want = typeof requested === 'string' ? currentModel(providerId, requested) : ''
  const saved = currentModel(providerId, savedModel)
  if (want && (want === saved || p?.models.includes(want))) return want
  return saved
}

/** Model an admin may save: listed for the provider, or any sane id for custom. */
export function modelProblem(providerId: string, model: string): string | null {
  const p = PROVIDERS[providerId]
  if (!p) return 'Unknown provider'
  const m = model.trim()
  if (!m || m.length > MAX_MODEL_CHARS || !/^[A-Za-z0-9._:/@-]+$/.test(m)) return 'Enter a model id'
  if (providerId !== 'custom' && m !== p.defaultModel && !p.models.includes(m)) {
    return `Model "${m}" is not offered for ${p.label}`
  }
  return null
}

export function llmCredentialAad(companyId: string, credentialId: string) {
  return `${companyId}:llmCredentials:${credentialId}`
}

// Same caps as lib/llmProxyGuard.js.
export const MAX_MESSAGES = 24
export const MAX_MESSAGE_CHARS = 60_000
export const MAX_TOTAL_CHARS = 120_000

/** The server-built system prompt (instructions plus farm context). */
export const MAX_SYSTEM_CHARS = 400_000

/** Client caps (llmProxyGuard) apply to the turns; the system prompt has its own. */
export function messagesProblem(messages: { role: string; content: string }[]): string | null {
  if (!messages.length) return 'messages are required'
  const turns = messages.filter((m) => m.role !== 'system')
  if (turns.length > MAX_MESSAGES) return `Too many messages (max ${MAX_MESSAGES})`
  const system = messages.reduce((n, m) => n + (m.role === 'system' ? m.content.length : 0), 0)
  if (system > MAX_SYSTEM_CHARS) return 'The farm context is too large'
  let total = 0
  for (const m of turns) {
    if (m.content.length > MAX_MESSAGE_CHARS) return `A message is too long (max ${MAX_MESSAGE_CHARS} characters)`
    total += m.content.length
  }
  if (total > MAX_TOTAL_CHARS) return `Conversation is too long (max ${MAX_TOTAL_CHARS} characters)`
  return null
}

/**
 * Indicative list prices, USD per million tokens [input, output]. An
 * estimate for the usage view, not a bill: the provider's invoice is the
 * truth. Unknown models get no estimate.
 */
export const MODEL_PRICES: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
  'gpt-4.1-mini': [0.4, 1.6],
  'o4-mini': [1.1, 4.4],
  'gemini-2.0-flash': [0.1, 0.4],
  'gemini-2.0-flash-lite': [0.075, 0.3],
  'gemini-1.5-flash': [0.075, 0.3],
  'gemini-1.5-pro': [1.25, 5],
  'openai/gpt-4o-mini': [0.15, 0.6],
  'openai/gpt-4o': [2.5, 10],
  'google/gemini-2.0-flash-001': [0.1, 0.4],
  'anthropic/claude-3.5-sonnet': [3, 15],
  'meta-llama/llama-3.1-70b-instruct': [0.4, 0.4],
  'claude-3-5-sonnet-latest': [3, 15],
  'claude-3-5-haiku-latest': [0.8, 4],
  'claude-sonnet-4-0': [3, 15],
  'llama-3.3-70b-versatile': [0.59, 0.79],
  'llama-3.1-8b-instant': [0.05, 0.08],
  'mixtral-8x7b-32768': [0.24, 0.24],
}

export function estimateCostUsd(model: string, inputTokens?: number, outputTokens?: number): number | undefined {
  const price = MODEL_PRICES[model]
  if (!price || (inputTokens === undefined && outputTokens === undefined)) return undefined
  const cost = ((inputTokens ?? 0) * price[0] + (outputTokens ?? 0) * price[1]) / 1_000_000
  return Math.round(cost * 1_000_000) / 1_000_000
}

/** A non-negative integer token count, or undefined. */
export function tokenCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 10_000_000) : undefined
}
