/**
 * Server-only glue between the Next LLM routes and the Convex gateway
 * (INT-009). The organization's own key is tried first (llmGateway.chat runs
 * the call inside Convex, so the key never leaves it); `{ handled: false }`
 * means the company has none and the route falls back to the server key,
 * reporting usage with `reportServerUsage`.
 */
import { api } from './convexBridge'
import { runChatWithUsage } from '../convex/lib/llmProviders'
import { runGuarded } from '../convex/lib/aiGuard'
import { LLM_PROVIDERS } from './llmClient'
import { defaultProviderFromEnv, readServerProviderKey } from './llmEnv'
import { chooseServerModel, serverTarget } from './llmModelsServer'
import { streamChatReply, streamingModel } from './chatStream'
import { LLM_FAILURE_STATUS, LLM_FAILURE_TEXT, classifyLlmFailure, isLlmFailureKind } from '../convex/lib/llmErrors'

const STATUS_BY_CODE = { RATE_LIMITED: 429, VALIDATION: 400, FORBIDDEN: 403, UNAUTHENTICATED: 401 }
const KIND_BY_CODE = { RATE_LIMITED: 'rate_limited', VALIDATION: 'invalid', FORBIDDEN: 'forbidden', UNAUTHENTICATED: 'forbidden' }

/**
 * HTTP status and a safe body for an error thrown by an LLM call:
 * `{ status, error, code, retryAfterSec }`. The app's own refusals
 * (RATE_LIMITED, FORBIDDEN, …) keep their message; provider failures (a
 * ConvexError UPSTREAM from the gateway, or a plain Error from the server
 * key) become the message for their kind (convex/lib/llmErrors), so quota
 * metrics, URLs and project ids never reach the browser. The raw text is
 * logged here.
 */
export function gatewayError(err, log = console) {
  let data = err?.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      data = { message: data }
    }
  }
  const code = data?.code
  if (code && STATUS_BY_CODE[code]) {
    return {
      status: STATUS_BY_CODE[code],
      error: data.message || 'Assistant request failed',
      code: KIND_BY_CODE[code],
      retryAfterSec: null,
    }
  }
  const details = data?.details || {}
  const failure = isLlmFailureKind(details.kind)
    ? classifyFromDetails(details)
    : classifyLlmFailure({ status: details.status ?? err?.status, message: data?.message || err?.message })
  if (!isLlmFailureKind(details.kind)) {
    log.warn?.('[llm] provider failure', failure.kind, err?.status ?? '', String(data?.message || err?.message || '').slice(0, 500))
  }
  return {
    status: failure.status,
    error: LLM_FAILURE_TEXT[failure.kind],
    code: failure.kind,
    retryAfterSec: failure.retryAfterSec,
  }
}

function classifyFromDetails(details) {
  return {
    kind: details.kind,
    status: LLM_FAILURE_STATUS[details.kind],
    retryAfterSec: typeof details.retryAfterSec === 'number' ? details.retryAfterSec : null,
  }
}

/** The JSON body for a failed LLM route (`gatewayError` result). */
export function failureBody(failed) {
  return { error: failed.error, code: failed.code, retryAfterSec: failed.retryAfterSec }
}

/** Try the organization key: `{ handled: false }`, or the reply. Throws on failure. */
export async function chatWithOrgKey(client, args) {
  return await client.action(api.llmGateway.chat, args)
}

/**
 * One question on the server's keys with the AI protections (D-023):
 *
 * 1. `llmQuota.consumeServerKeyQuota` spends the durable SEC-004 limits and
 *    takes a concurrency lease; it refuses (busy, budget, rate limited)
 *    before anything is called or charged.
 * 2. `runGuarded` (convex/lib/aiGuard): an explicitly chosen model whose
 *    breaker is open is refused ("pick Auto or another model"); Auto skips
 *    open breakers and, after a model failure, retries ONCE on the next best
 *    model of the same provider, then another provider with a server key.
 *    Overall deadline per question (AI_QUESTION_DEADLINE_MS).
 * 3. Every attempt is reported (`recordServerUsage`: usage, spend, breaker);
 *    the lease is given back in a finally.
 *
 * Returns `{ text, providerId, model, fallback, requestedModel }`, or
 * `{ notConfigured: true, error }` when no server key is set. Throws an error
 * `gatewayError` maps (kind + retry hint) otherwise.
 */
export async function guardedServerChat(client, o, deps = {}) {
  const env = deps.env || process.env
  const readKey = deps.readKey || readServerProviderKey
  const chooseModel = deps.chooseServerModel || chooseServerModel
  const runChat = deps.runChat || ((chat, signal) => runChatWithUsage(chat, undefined, { signal }))
  const runStream = deps.runStream || streamChatReply
  const stream = o.stream || null
  let sent = false
  const now = deps.now || Date.now
  const requested = typeof o.model === 'string' && o.model.trim() ? o.model.trim().slice(0, 100) : null
  const keyed = Object.keys(LLM_PROVIDERS).filter((id) => readKey(id))
  const primary =
    (o.provider && LLM_PROVIDERS[o.provider] && readKey(o.provider) ? o.provider : null) ||
    (deps.defaultProvider ? deps.defaultProvider() : defaultProviderFromEnv()) ||
    (readKey('gemini') ? 'gemini' : null)
  if (!primary || !readKey(primary)) {
    return { notConfigured: true, error: `No API key configured for ${o.provider || 'the default provider'}` }
  }
  const providers = [primary, ...keyed.filter((id) => id !== primary)]

  const gate = await client.mutation(api.llmQuota.consumeServerKeyQuota, { providerId: primary, feature: o.feature })
  const blocked = new Set(gate.blocked)
  const explicit = !!requested
  const excluded = (providerId, tried = new Set()) => {
    const prefix = `server|${providerId}|`
    return [...blocked, ...tried].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
  }
  const pick = async (providerId, want, exclude) => {
    const target = serverTarget(providerId, env, readKey)
    if (!target) return null
    const { choice, price } = await chooseModel(target, want, { env, exclude })
    if (!choice.ok) {
      console.warn('[llm] model choice', providerId, choice.error)
      lastError = choice.error
      return null
    }
    return { providerId, model: choice.model, scope: 'server', chat: { ...target, model: choice.model }, price, replaced: choice.fallback }
  }
  let firstReplaced = false
  // Why no model could be picked (provider list unreachable…), classified like a provider failure.
  let lastError = null
  try {
    const result = await runGuarded({
      now,
      deadlineAt: gate.deadlineAt,
      // A streamed answer may take the whole question deadline once it starts.
      attemptMs: stream ? Math.max(gate.attemptMs, gate.deadlineAt - now()) : gate.attemptMs,
      explicit,
      blocked,
      first: async () => {
        const t = await pick(primary, requested, explicit ? [] : excluded(primary))
        firstReplaced = !!t?.replaced
        if (t || explicit) return t
        for (const id of providers.slice(1)) {
          const alt = await pick(id, null, excluded(id))
          if (alt) return alt
        }
        return null
      },
      next: async (failed, tried) => {
        for (const id of providers.slice(Math.max(0, providers.indexOf(failed.providerId)))) {
          const t = await pick(id, null, excluded(id, tried))
          if (t && !tried.has(`server|${t.providerId}|${t.model}`)) return t
        }
        return null
      },
      attempt: (t, signal) => {
        const chat = { ...t.chat, messages: o.messages, temperature: o.temperature, referer: o.referer }
        if (!stream) return runChat(chat, signal)
        return runStream({
          model: streamingModel(chat),
          messages: o.messages,
          // Current Claude models reject sampling parameters.
          temperature: chat.kind === 'anthropic' ? undefined : o.temperature,
          // The deadline and the member's Stop both end the call.
          signal: stream.signal ? AbortSignal.any([signal, stream.signal]) : signal,
          onText: (text) => {
            sent = true
            stream.onText?.(text)
          },
        })
      },
      canRetry: () => !sent,
      record: async (t, r) => {
        await client
          .mutation(api.llmGateway.recordServerUsage, {
            leaseId: gate.leaseId,
            providerId: t.providerId,
            model: t.model,
            feature: o.feature,
            durationMs: r.durationMs,
            ok: r.ok && !r.value?.stopped,
            ...(r.ok ? (r.value?.stopped ? { error: 'stopped' } : {}) : { error: String(r.message || 'failed').slice(0, 300) }),
            ...(typeof r.status === 'number' ? { status: r.status } : {}),
            ...(r.value?.usage?.inputTokens != null ? { inputTokens: r.value.usage.inputTokens } : {}),
            ...(r.value?.usage?.outputTokens != null ? { outputTokens: r.value.usage.outputTokens } : {}),
            ...(t.price || {}),
          })
          .catch((err) => console.warn('[llm usage]', err?.message))
      },
    })
    if (!result.ok) {
      if (result.kind === 'not_configured' && !lastError) return { notConfigured: true, error: result.message }
      const kind = result.kind === 'not_configured' ? classifyLlmFailure({ status: 503, message: lastError }).kind : result.kind
      console.warn('[llm] provider failure', kind, String(lastError || result.message || '').slice(0, 500))
      const err = new Error(LLM_FAILURE_TEXT[kind] || LLM_FAILURE_TEXT.unknown)
      err.data = { code: 'UPSTREAM', message: err.message, details: { kind, retryAfterSec: result.retryAfterSec } }
      throw err
    }
    return {
      text: result.value.text,
      stopped: result.value.stopped === true,
      providerId: result.target.providerId,
      model: result.target.model,
      fallback: result.fallback || (result.attempts <= 1 && firstReplaced),
      requestedModel: requested,
    }
  } finally {
    await client.mutation(api.aiGuard.releaseLease, { leaseId: gate.leaseId }).catch((err) => console.warn('[llm lease]', err?.message))
  }
}

/**
 * `guardedServerChat`, streamed (Ask Anowa ?stream=1): the same lease,
 * budget, breaker and deadline rules, and an Auto fallback while nothing has
 * been sent yet (once text reached the member, a failure is final).
 * `onText` gets the display-sanitised text so far; resolves the
 * guardedServerChat result plus `stopped` (the member pressed Stop).
 */
export function streamWithServerKey(client, o, { signal, onText } = {}, deps = {}) {
  return guardedServerChat(client, { ...o, stream: { signal, onText } }, deps)
}
