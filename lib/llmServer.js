/**
 * Server-only pieces shared by the LLM API routes (pages/api/llm/*): which
 * provider, key and model to use, and the assistant's system prompt. Never
 * import from browser code: it reads server env keys.
 */
import { LLM_PROVIDERS } from './llmClient'
import { defaultProviderFromEnv, readServerProviderKey } from './llmEnv'
import { chooseServerModel, serverTarget } from './llmModelsServer'

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

/** The assistant's instructions plus the farm context the server loaded. */
export function assistantSystemPrompt(context) {
  return `You are Anowa, a concise aquaculture operations assistant in the Anowa fish farm management app.
Answer only from the farm context JSON below; it is everything this user may see. If the answer is not in it, say so and suggest what to record in the app (daily entries, bi-weekly samples, harvests, expenses). Never invent numbers.
Keep answers short and practical. Units: feed and biomass kg, ABW grams, FCR = feed / weight gained, SGR % body weight per day.
Farm context:
${JSON.stringify(context)}`
}

/** A YYYY-MM-DD string, or today in UTC. */
export function businessDateOr(value, now = new Date()) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : now.toISOString().slice(0, 10)
}
