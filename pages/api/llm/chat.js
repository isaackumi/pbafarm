import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'
import {
  assistantRefusal,
  clampTemperature,
  createRateLimiter,
  validateMessages,
} from '../../../lib/llmProxyGuard'
import { assistantSystemPrompt, businessDateOr, resolveProvider } from '../../../lib/llmServer'
import { decodeChatBody } from '../../../convex/lib/llmProviders'
import { chatWithOrgKey, chatWithServerKey, gatewayError } from '../../../lib/llmGatewayRoute'

/**
 * Server-side LLM proxy (PLAT-006, ANLY-005): spends the server's provider
 * keys on behalf of a signed-in user whose company has the assistant enabled.
 * Provider keys never reach the browser and the browser never calls a
 * provider.
 *
 * The farm context is loaded here with the user's own token
 * (assistant.context: company-scoped rollups, last N days), so the model only
 * sees what this user may see. System messages from the client are dropped.
 *
 * Guards: Convex session token verified (requireApiUser), deactivated users
 * refused, company AI toggle, `ai.use` permission (SEC-004), per-user and
 * per-company rate limits, model allow-list, message
 * count/size caps, Schema-validated body. Provider calls: convex/lib/llmProviders
 * (Effect: 30 s per attempt, transient-only retry, Schema-validated replies).
 *
 * Rate limits are in-memory per server instance (lib/llmProxyGuard.js).
 *
 * Keys (INT-009): the company's own provider key (llmGateway, encrypted in
 * Convex, with Convex-side rate limits and the same ai.use/toggle checks) is
 * used when set; otherwise the server key. Every call lands in the company's
 * usage log.
 */
const perMinute = createRateLimiter({ limit: 10, windowMs: 60_000 })
const perHour = createRateLimiter({ limit: 100, windowMs: 60 * 60_000 })
const companyPerHour = createRateLimiter({ limit: 500, windowMs: 60 * 60_000 })

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } }

/** Keep the last turns of the conversation, user and assistant only. */
const HISTORY = 9

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireApiUser(req, res)
  if (!auth) return

  if (auth.user.active === false) {
    return res.status(403).json({ error: 'Your account is deactivated' })
  }

  try {
    const aiStatus = await auth.client.query(api.companies.aiAssistantStatus, {})
    const refusal = assistantRefusal(aiStatus)
    if (refusal) return res.status(403).json({ error: refusal })

    const userKey = String(auth.user._id || auth.user.id)
    const companyKey = String(auth.user.companyId || `user:${userKey}`)
    for (const [limiter, key] of [
      [perMinute, userKey],
      [perHour, userKey],
      [companyPerHour, companyKey],
    ]) {
      const verdict = limiter.check(key)
      if (!verdict.ok) {
        res.setHeader('Retry-After', String(verdict.retryAfterSec))
        return res.status(429).json({
          error: `Too many assistant requests. Try again in ${verdict.retryAfterSec} seconds.`,
        })
      }
    }

    const body = decodeChatBody(req.body)
    if (!body.ok) return res.status(400).json({ error: body.error })

    const checked = validateMessages(body.value.messages)
    if (checked.error) return res.status(400).json({ error: checked.error })
    const turns = checked.messages.filter((m) => m.role !== 'system').slice(-HISTORY)
    if (!turns.length || turns[turns.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'The last message must be a question' })
    }

    let context
    try {
      context = await auth.client.query(api.assistant.context, {
        asOf: businessDateOr(body.value.asOf),
        days: 14,
      })
    } catch (err) {
      context = { error: err?.data?.message || err?.message || 'Could not load farm context' }
    }

    const messages = [{ role: 'system', content: assistantSystemPrompt(context) }, ...turns]
    const temperature = clampTemperature(body.value.temperature ?? undefined)
    const referer = req.headers.origin || undefined

    let org
    try {
      org = await chatWithOrgKey(auth.client, {
        feature: 'chat',
        messages,
        providerId: body.value.provider ?? undefined,
        model: body.value.model ?? undefined,
        temperature,
        referer,
      })
    } catch (err) {
      const failed = gatewayError(err)
      return res.status(failed.status).json({ error: failed.error })
    }
    if (org.handled) return res.status(200).json({ text: org.text, provider: org.providerId, keySource: 'org' })

    const resolved = resolveProvider(body.value.provider, body.value.model)
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error })

    const text = await chatWithServerKey(auth.client, { ...resolved.chat, messages, temperature, referer }, 'chat')
    return res.status(200).json({ text, provider: resolved.providerId, keySource: 'server' })
  } catch (err) {
    console.error('[api/llm/chat]', err?.message)
    return res.status(500).json({ error: err?.message || 'Assistant request failed' })
  }
}
