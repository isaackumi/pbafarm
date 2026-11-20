/**
 * Server-only pieces shared by the LLM API routes (pages/api/llm/*): which
 * provider, key and model to use, and the assistant's system prompt. Never
 * import from browser code: it reads server env keys.
 */
import { LLM_PROVIDERS } from './llmClient'
import { defaultProviderFromEnv, readServerProviderKey } from './llmEnv'
import { chooseServerModel, serverTarget } from './llmModelsServer'
import { anowaSystemPrompt } from './anowaPersona'

const KEY_ENV = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  custom: 'CUSTOM_LLM_API_KEY',
}

/**
 * Provider, key and model for a request: `{ providerId, model, fallback,
 * requestedModel, price, chat }` (chat = options for llmProviders.runChat,
 * without messages) or `{ status, error }`. The model comes from the
 * provider's live list (D-022): a requested id it does not offer falls back
 * to the default and `fallback` says so.
 */
export async function resolveProvider(requestedProvider, requestedModel, env = process.env, opts = {}) {
  const providerId =
    (requestedProvider && LLM_PROVIDERS[requestedProvider] ? requestedProvider : null) ||
    defaultProviderFromEnv() ||
    'gemini'
  const apiKey = (opts.readKey || readServerProviderKey)(providerId)
  if (!apiKey) {
    const envName = KEY_ENV[providerId] || 'GEMINI_API_KEY'
    return {
      status: 400,
      error: `No API key configured for ${providerId}. Add ${envName} to the server environment.`,
    }
  }
  const target = serverTarget(providerId, env, () => apiKey)
  const requested = typeof requestedModel === 'string' && requestedModel.trim() ? requestedModel.trim().slice(0, 100) : null
  const { choice, price } = await chooseServerModel(target, requested, { env, ...opts })
  if (!choice.ok) return { status: 503, error: choice.error }
  return {
    providerId,
    model: choice.model,
    fallback: choice.fallback,
    requestedModel: requested,
    price,
    chat: { ...target, model: choice.model },
  }
}

/**
 * The assistant's instructions plus the farm context the server loaded:
 * Anowa's character and house rules (lib/anowaPersona.js), then the records,
 * fenced as data. `lang` is the member's app language (`en` | `fr`).
 */
export function assistantSystemPrompt(context, { deep = false, lang = 'en' } = {}) {
  return anowaSystemPrompt(context, { deep, lang })
}

/** Shortest and longest Ask Anowa date windows (convex/assistant MAX_DAYS). */
export const SCOPE_DAYS = { min: 1, max: 90, default: 14 }

/**
 * The farm-context scope a chat request asks for: `{ days, locationId, deep }`.
 * The site is only passed on; Convex (assistant.context) checks the member
 * may see it and refuses otherwise.
 */
export function chatScope(body = {}) {
  const raw = typeof body.days === 'number' && Number.isFinite(body.days) ? Math.round(body.days) : SCOPE_DAYS.default
  const days = Math.min(SCOPE_DAYS.max, Math.max(SCOPE_DAYS.min, raw))
  const locationId =
    typeof body.locationId === 'string' && /^[a-z0-9]{10,64}$/i.test(body.locationId) ? body.locationId : undefined
  return { days, locationId, deep: body.deep === true }
}

/** A YYYY-MM-DD string, or today in UTC. */
export function businessDateOr(value, now = new Date()) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : now.toISOString().slice(0, 10)
}
