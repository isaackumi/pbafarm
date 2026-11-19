/**
 * Server-only pieces shared by the LLM API routes (pages/api/llm/*): which
 * provider, key and model to use, and the assistant's system prompt. Never
 * import from browser code: it reads server env keys.
 */
import { LLM_PROVIDERS } from './llmClient'
import { defaultProviderFromEnv, readServerProviderKey } from './llmEnv'
import { resolveAllowedModel } from './llmProxyGuard'

const KEY_ENV = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  custom: 'CUSTOM_LLM_API_KEY',
}

/**
 * Provider, key and model for a request: `{ chat }` (options for
 * llmProviders.runChat, without messages) or `{ status, error }`.
 */
export function resolveProvider(requestedProvider, requestedModel, env = process.env) {
  const providerId =
    (requestedProvider && LLM_PROVIDERS[requestedProvider] ? requestedProvider : null) ||
    defaultProviderFromEnv() ||
    'gemini'
  const apiKey = readServerProviderKey(providerId)
  if (!apiKey) {
    const envName = KEY_ENV[providerId] || 'GEMINI_API_KEY'
    return {
      status: 400,
      error: `No API key configured for ${providerId}. Add ${envName} to the server environment.`,
    }
  }
  const provider = LLM_PROVIDERS[providerId]
  const model = resolveAllowedModel(provider, requestedModel, env.LLM_EXTRA_MODELS)
  if (!model) {
    return {
      status: 400,
      error: `Model "${String(requestedModel).slice(0, 80)}" is not allowed for ${providerId}`,
    }
  }
  return {
    providerId,
    chat: {
      kind: provider.kind,
      providerId,
      // Never let the browser choose where the server's key is sent.
      baseUrl: provider.id === 'custom' ? env.CUSTOM_LLM_BASE_URL || '' : provider.baseUrl,
      apiKey,
      model,
    },
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
