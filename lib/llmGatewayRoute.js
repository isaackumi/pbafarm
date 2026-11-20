/**
 * Server-only glue between the Next LLM routes and the Convex gateway
 * (INT-009). The organization's own key is tried first (llmGateway.chat runs
 * the call inside Convex, so the key never leaves it); `{ handled: false }`
 * means the company has none and the route falls back to the server key,
 * reporting usage with `reportServerUsage`.
 */
import { api } from './convexBridge'
import { runChatWithUsage } from '../convex/lib/llmProviders'

const STATUS_BY_CODE = { RATE_LIMITED: 429, VALIDATION: 400, FORBIDDEN: 403, UNAUTHENTICATED: 401 }

/** HTTP status and message for an error thrown by a gateway call. */
export function gatewayError(err) {
  let data = err?.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      data = { message: data }
    }
  }
  const code = data?.code
  return {
    status: STATUS_BY_CODE[code] || 502,
    error: data?.message || err?.message || 'Assistant request failed',
  }
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
