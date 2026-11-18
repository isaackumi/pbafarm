/**
 * Limits for the server-side LLM proxy (pages/api/llm/chat.js), which spends
 * the company's server API keys. Kept free of Next/Convex imports so it can be
 * unit-tested.
 */

/** The assistant sends 1 system + up to 8 history + 1 question = 10. */
export const MAX_MESSAGES = 24
/** System prompt carries the farm-context JSON; ~200 cages fits well under this. */
export const MAX_MESSAGE_CHARS = 60_000
export const MAX_TOTAL_CHARS = 120_000

const ROLES = new Set(['system', 'user', 'assistant'])

/**
 * Validate the request's messages. Returns { messages } (normalized to
 * { role, content }) or { error } with a user-facing reason.
 */
export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'messages are required' }
  }
  if (messages.length > MAX_MESSAGES) {
    return { error: `Too many messages (max ${MAX_MESSAGES})` }
  }
  let total = 0
  const clean = []
  for (const m of messages) {
    if (!m || typeof m !== 'object' || !ROLES.has(m.role) || typeof m.content !== 'string') {
      return { error: 'Each message needs a role (system, user, assistant) and text content' }
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return { error: `A message is too long (max ${MAX_MESSAGE_CHARS} characters)` }
    }
    total += m.content.length
    clean.push({ role: m.role, content: m.content })
  }
  if (total > MAX_TOTAL_CHARS) {
    return { error: `Conversation is too long (max ${MAX_TOTAL_CHARS} characters)` }
  }
  return { messages: clean }
}

/**
 * Models the proxy may call for a provider: the provider's listed models and
 * default, plus any in LLM_EXTRA_MODELS (comma-separated, e.g. for the custom
 * provider). Returns the model to use or null if not allowed.
 */
export function resolveAllowedModel(provider, requested, extraModelsEnv = '') {
  if (!provider) return null
  const allowed = new Set([provider.defaultModel, ...(provider.models || [])])
  for (const m of String(extraModelsEnv || '').split(',')) {
    if (m.trim()) allowed.add(m.trim())
  }
  const model = typeof requested === 'string' && requested.trim() ? requested.trim() : provider.defaultModel
  return allowed.has(model) ? model : null
}

export function clampTemperature(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.3
  return Math.min(1, Math.max(0, value))
}

/**
 * Fixed-window rate limiter kept in process memory.
 *
 * LIMITATION: state is per server instance and lost on restart/redeploy. On
 * serverless hosting (Vercel) each warm instance counts separately, so the
 * effective limit is (limit x instances). Good enough to stop a runaway tab or
 * a casual abuser; replace with a shared store (e.g. Convex rate-limiter
 * component) before relying on it for cost control.
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map()
  return {
    /** Returns { ok: true } or { ok: false, retryAfterSec }. */
    check(key) {
      const t = now()
      let entry = hits.get(key)
      if (!entry || t - entry.start >= windowMs) {
        entry = { start: t, count: 0 }
        hits.set(key, entry)
      }
      if (entry.count >= limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000)) }
      }
      entry.count += 1
      // Opportunistic cleanup so the map cannot grow without bound.
      if (hits.size > 5000) {
        for (const [k, e] of hits) if (t - e.start >= windowMs) hits.delete(k)
      }
      return { ok: true }
    },
  }
}
