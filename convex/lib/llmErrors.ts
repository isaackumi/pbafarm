/**
 * Provider failures, sorted into a few kinds people can act on. The raw
 * provider text (quota metric names, URLs, project ids, model ids, retry
 * timers) stays in the server log and the usage log for admins; members see
 * a short message chosen from the kind (locales `assistantUi.errors.*`).
 *
 * Pure: shared by Convex (llmGateway) and the Next LLM routes.
 */

export const LLM_FAILURE_KINDS = [
  /** The plan or billing has no quota left (daily cap, free tier "limit: 0", insufficient_quota). */
  'quota',
  /** Too many requests right now; retrying soon works. */
  'rate_limited',
  /** The provider is overloaded or down, or the network failed. */
  'unavailable',
  /** The model did not answer in time. */
  'timeout',
  /** The key is missing, invalid or not allowed. */
  'auth',
  /** The chosen model is retired or not offered for this key. */
  'model_unavailable',
  /** The provider's safety filter blocked the question or the answer. */
  'blocked',
  /** The question plus farm context is too long for the model. */
  'too_long',
  /** The model answered with nothing usable. */
  'empty',
  'unknown',
] as const
export type LlmFailureKind = (typeof LLM_FAILURE_KINDS)[number]

export type LlmFailure = {
  kind: LlmFailureKind
  /** HTTP status the app route should answer with. */
  status: number
  /** Seconds until a retry may work, when the provider said so. */
  retryAfterSec: number | null
}

/** English fallback per kind, for clients without the catalog (API, bot, logs). */
export const LLM_FAILURE_TEXT: Record<LlmFailureKind, string> = {
  quota: 'Anowa has used up its AI allowance for now. Try again later, or ask an admin to choose another model or add billing in AI settings.',
  rate_limited: 'Anowa is getting a lot of questions right now. Try again in a minute.',
  unavailable: 'The AI provider is not responding right now. Try again in a few minutes.',
  timeout: 'That took too long to answer. Try a shorter question or a narrower date range.',
  auth: 'Anowa cannot reach its AI provider: the key needs attention. Ask an admin to check AI settings.',
  model_unavailable: 'The chosen model is no longer available. Pick Auto or another model and ask again.',
  blocked: 'The AI provider declined to answer that. Try rephrasing the question.',
  too_long: 'There is too much farm data for one answer. Pick one site or a shorter date range.',
  empty: 'Anowa did not get an answer back. Try again.',
  unknown: 'Anowa could not answer just now. Try again in a moment.',
}

export const LLM_FAILURE_STATUS: Record<LlmFailureKind, number> = {
  quota: 429,
  rate_limited: 429,
  unavailable: 503,
  timeout: 504,
  auth: 502,
  model_unavailable: 502,
  blocked: 422,
  too_long: 413,
  empty: 502,
  unknown: 502,
}

/**
 * "Please retry in 21h37m53.6s", "retry after 30 seconds", retryDelay "41s":
 * the delay in whole seconds, or null.
 */
export function parseRetryAfter(text: string): number | null {
  const m = /retry(?:\s+(?:in|after))?\s*:?\s*"?((?:\d+(?:\.\d+)?\s*(?:h|m|s|hours?|minutes?|seconds?)\s*)+)/i.exec(text)
  if (!m) return null
  let total = 0
  for (const part of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s|hours?|minutes?|seconds?)/gi)) {
    const n = Number(part[1])
    const unit = part[2][0].toLowerCase()
    total += unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n
  }
  return total > 0 ? Math.ceil(total) : null
}

/** Sort a provider failure (`status` when the provider answered, its message) into a kind. */
export function classifyLlmFailure(input: { status?: number | null; message?: string | null }): LlmFailure {
  const status = typeof input.status === 'number' ? input.status : null
  const text = String(input.message ?? '')
  const low = text.toLowerCase()
  const retryAfterSec = parseRetryAfter(text)
  const kind = ((): LlmFailureKind => {
    if (/quota|billing|insufficient_quota|credit balance|exceeded your current|limit:\s*0|per day/.test(low)) return 'quota'
    if (status === 429 || /rate.?limit|too many requests/.test(low)) return 'rate_limited'
    if (/did not answer within|timed? ?out|deadline/.test(low) || status === 408 || status === 504) return 'timeout'
    if (status === 401 || status === 403 || /api key|invalid key|unauthori[sz]ed|permission denied|api_key_invalid/.test(low)) return 'auth'
    if (status === 404 || /model .*(not found|does not exist|not supported|deprecated|retired)|no such model|unknown model|not enabled for models?\b|is deprecated for this model/.test(low)) {
      return 'model_unavailable'
    }
    if (/safety|blocked|content.?filter|policy violation|recitation|harm_category/.test(low)) return 'blocked'
    if (status === 413 || /context length|too long|maximum context|token limit|too many tokens|request too large/.test(low)) return 'too_long'
    if (/empty response/.test(low)) return 'empty'
    if ((status !== null && status >= 500) || /overloaded|unavailable|fetch failed|network|econn|socket|enotfound|can't reach|cannot reach/.test(low)) {
      return 'unavailable'
    }
    return 'unknown'
  })()
  return { kind, status: LLM_FAILURE_STATUS[kind], retryAfterSec: kind === 'quota' || kind === 'rate_limited' ? retryAfterSec : null }
}

/** True for a known kind name (e.g. read back from a ConvexError's details). */
export function isLlmFailureKind(value: unknown): value is LlmFailureKind {
  return typeof value === 'string' && (LLM_FAILURE_KINDS as readonly string[]).includes(value)
}
