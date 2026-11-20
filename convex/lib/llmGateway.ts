/**
 * LLM gateway rules (INT-009): providers an organization may store a key for,
 * message caps, and the cost estimate written to llmUsage. Pure; shared by
 * convex/llmGateway.ts and the Next proxy routes.
 *
 * PROVIDERS mirrors lib/llmClient.js LLM_PROVIDERS (lib/llmClient.test.js
 * checks they match). It holds provider metadata only: model ids are
 * discovered from each provider at run time (./llmModels, D-022), never
 * listed here. The caps mirror lib/llmProxyGuard.js (SEC-004).
 */
import type { ProviderKind } from './llmModels'
import { envModelPrices, type Price } from './llmModels'

export type GatewayProvider = {
  id: string
  label: string
  kind: ProviderKind
  /** Fixed endpoint; '' for custom (the admin's saved base URL, never the browser's). */
  baseUrl: string
}

export const PROVIDERS: Record<string, GatewayProvider> = {
  openai: { id: 'openai', label: 'ChatGPT (OpenAI)', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  gemini: { id: 'gemini', label: 'Gemini (Google)', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  openrouter: { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  anthropic: { id: 'anthropic', label: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  groq: { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  custom: { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '' },
}

export const MAX_MODEL_CHARS = 100

/**
 * A model id an admin may save: '' (automatic: the provider's default from
 * the live list) or a sane id. Whether the provider offers it is checked
 * against the live list when the key is saved, and again on every call (an
 * id the provider dropped falls back to the default).
 */
export function modelProblem(providerId: string, model: string): string | null {
  if (!PROVIDERS[providerId]) return 'Unknown provider'
  const m = model.trim()
  if (!m) return null
  if (m.length > MAX_MODEL_CHARS || !/^[A-Za-z0-9._:/@-]+$/.test(m)) return 'Enter a model id'
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
 * Cost estimate for the usage view, not a bill: the provider's invoice is
 * the truth. Price from LLM_MODEL_PRICES (env JSON, wins) or the price the
 * provider listed (OpenRouter); otherwise undefined (no estimate). There is
 * no built-in price table.
 */
export function estimateCostUsd(
  model: string,
  inputTokens?: number,
  outputTokens?: number,
  listed?: Price,
  envPrices: string | undefined = process.env.LLM_MODEL_PRICES,
): number | undefined {
  const price = envModelPrices(envPrices)[model] ?? listed
  if (!price || (inputTokens === undefined && outputTokens === undefined)) return undefined
  const cost = ((inputTokens ?? 0) * price.inputPerM + (outputTokens ?? 0) * price.outputPerM) / 1_000_000
  return Math.round(cost * 1_000_000) / 1_000_000
}

/** A per-million price passed in by a caller, bounded; undefined when absent or absurd. */
export function cleanPrice(inputPerM?: number, outputPerM?: number): Price | undefined {
  const ok = (n?: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10_000
  return ok(inputPerM) && ok(outputPerM) ? { inputPerM: inputPerM!, outputPerM: outputPerM! } : undefined
}

/** A non-negative integer token count, or undefined. */
export function tokenCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 10_000_000) : undefined
}
