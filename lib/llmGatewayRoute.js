/**
 * Server-only glue between the Next LLM routes and the Convex gateway
 * (INT-009). The organization's own key is tried first (llmGateway.chat runs
 * the call inside Convex, so the key never leaves it); `{ handled: false }`
 * means the company has none and the route falls back to the server key,
 * reporting usage with `reportServerUsage`.
 */
import { api } from './convexBridge'
import { runChatWithUsage } from '../convex/lib/llmProviders'
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
 * Call the provider on the server key and log the call (best effort). Spends
 * the durable Convex assistant limits first (SEC-004); a RATE_LIMITED
 * refusal throws before the provider is called (map it with gatewayError).
 */
export async function chatWithServerKey(client, chat, feature, price) {
  await client.mutation(api.llmQuota.consumeServerKeyQuota, {})
  const started = Date.now()
  const report = (row) =>
    client
      .mutation(api.llmGateway.recordServerUsage, {
        providerId: chat.providerId,
        model: chat.model,
        feature,
        durationMs: Date.now() - started,
        ...(price || {}),
        ...row,
      })
      .catch((err) => console.warn('[llm usage]', err?.message))
  try {
    const reply = await runChatWithUsage(chat)
    await report({
      ok: true,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
    })
    return reply.text
  } catch (err) {
    await report({ ok: false, error: String(err?.message || 'failed').slice(0, 300) })
    throw err
  }
}

/**
 * `chatWithServerKey`, streamed (Ask Anowa ?stream=1): spends the same
 * Convex limits first (a RATE_LIMITED refusal throws before anything is
 * sent), streams through lib/chatStream and logs the call like the
 * unstreamed path. `onText` gets the display-sanitised text so far; resolves
 * `{ text, stopped }`. Provider failures throw with `status` set, for
 * gatewayError.
 */
export async function streamWithServerKey(client, chat, feature, price, { signal, onText, model } = {}) {
  await client.mutation(api.llmQuota.consumeServerKeyQuota, {})
  const started = Date.now()
  const report = (row) =>
    client
      .mutation(api.llmGateway.recordServerUsage, {
        providerId: chat.providerId,
        model: chat.model,
        feature,
        durationMs: Date.now() - started,
        ...(price || {}),
        ...row,
      })
      .catch((err) => console.warn('[llm usage]', err?.message))
  try {
    const reply = await streamChatReply({
      model: model || streamingModel(chat),
      messages: chat.messages,
      // Current Claude models reject sampling parameters.
      temperature: chat.kind === 'anthropic' ? undefined : chat.temperature,
      signal,
      onText,
    })
    await report({
      ok: !reply.stopped,
      ...(reply.stopped ? { error: 'stopped' } : {}),
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
    })
    return reply
  } catch (err) {
    await report({ ok: false, error: String(err?.message || 'failed').slice(0, 300) })
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { status: err?.status ?? err?.statusCode })
  }
}
