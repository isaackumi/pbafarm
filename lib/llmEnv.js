/** Env var names for LLM providers (server-side secrets). */
export const LLM_ENV_KEYS = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  custom: 'CUSTOM_LLM_API_KEY',
}

/** Optional browser-exposed keys (avoid in production — prefer server vars). */
export const LLM_PUBLIC_ENV_KEYS = {
  gemini: 'NEXT_PUBLIC_GEMINI_API_KEY',
  openai: 'NEXT_PUBLIC_OPENAI_API_KEY',
  openrouter: 'NEXT_PUBLIC_OPENROUTER_API_KEY',
  anthropic: 'NEXT_PUBLIC_ANTHROPIC_API_KEY',
  groq: 'NEXT_PUBLIC_GROQ_API_KEY',
  custom: 'NEXT_PUBLIC_CUSTOM_LLM_API_KEY',
}

export function readServerProviderKey(providerId) {
  const name = LLM_ENV_KEYS[providerId]
  if (!name) return ''
  // NEXT_PUBLIC_* keys still work, read on the server only (the browser no
  // longer calls providers, PLAT-006). Prefer the server variable.
  return String(process.env[name] || process.env[LLM_PUBLIC_ENV_KEYS[providerId]] || '').trim()
}

export function listServerProvidersConfigured() {
  const configured = {}
  for (const id of Object.keys(LLM_ENV_KEYS)) {
    configured[id] = Boolean(readServerProviderKey(id))
  }
  return configured
}

export function defaultProviderFromEnv() {
  const preferred = String(process.env.LLM_DEFAULT_PROVIDER || '').trim()
  if (preferred && readServerProviderKey(preferred)) return preferred
  // Prefer Gemini when present (common setup for this app)
  if (readServerProviderKey('gemini')) return 'gemini'
  for (const id of Object.keys(LLM_ENV_KEYS)) {
    if (readServerProviderKey(id)) return id
  }
  return ''
}
