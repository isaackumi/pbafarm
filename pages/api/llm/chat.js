import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'
import {
  assistantRefusal,
  clampTemperature,
  createRateLimiter,
  createTokenBucket,
  validateMessages,
} from '../../../lib/llmProxyGuard'
import { assistantSystemPrompt, businessDateOr, chatScope } from '../../../lib/llmServer'
import { decodeChatBody } from '../../../convex/lib/llmProviders'
import { chatWithOrgKey, failureBody, gatewayError, guardedServerChat, streamWithServerKey } from '../../../lib/llmGatewayRoute'
import { ndjson } from '../../../lib/chatStream'
import { sanitizeAnswer } from '../../../convex/lib/llmAnswer'
import { LLM_FAILURE_TEXT } from '../../../convex/lib/llmErrors'

/**
 * Server-side LLM proxy (PLAT-006, ANLY-005): spends the server's provider
 * keys on behalf of a signed-in user whose company has the assistant enabled.
 * Provider keys never reach the browser and the browser never calls a
 * provider.
 *
 * The farm context is loaded here with the user's own token
 * (assistant.context: company-scoped rollups, last N days, optionally one
 * site; Convex refuses a site outside the member's scope), so the model only
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
 * Streaming (`?stream=1`, Ask Anowa): on the server key the answer streams as
 * NDJSON (lib/chatStream: display-sanitised text frames, then the final
 * fully sanitised answer, or a classified error); closing the request (Stop)
 * aborts the provider call. Refusals before the first frame stay JSON with
 * their status. The organization key runs inside Convex, so its answer
 * arrives whole, as JSON, as before.
 *
 * Keys (INT-009): the company's own provider key (llmGateway, encrypted in
 * Convex, with Convex-side rate limits and the same ai.use/toggle checks) is
 * used when set; otherwise the server key. Every call lands in the company's
 * usage log.
 */
// Per minute: token bucket, refilled one request every 6 s (D-023).
const perMinute = createTokenBucket({ rate: 10, periodMs: 60_000, capacity: 10 })
const perHour = createRateLimiter({ limit: 100, windowMs: 60 * 60_000 })
const companyPerHour = createRateLimiter({ limit: 500, windowMs: 60 * 60_000 })

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } }

/** Keep the last turns of the conversation, user and assistant only (more for deep analysis). */
const HISTORY = 9
const DEEP_HISTORY = 17

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
    const scope = chatScope(body.value)
    const turns = checked.messages.filter((m) => m.role !== 'system').slice(-(scope.deep ? DEEP_HISTORY : HISTORY))
    if (!turns.length || turns[turns.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'The last message must be a question' })
    }

    let context
    try {
      context = await auth.client.query(api.assistant.context, {
        asOf: businessDateOr(body.value.asOf),
        days: scope.days,
        deep: scope.deep,
        ...(scope.locationId ? { locationId: scope.locationId } : {}),
      })
    } catch (err) {
      // A site outside the member's scope (or another company's) is refused, not answered without data.
      const code = err?.data?.code
      if (scope.locationId && (code === 'FORBIDDEN' || code === 'NOT_FOUND' || /site/i.test(err?.message || ''))) {
        return res.status(403).json({ error: err?.data?.message || 'You do not have access to this site' })
      }
      context = { error: err?.data?.message || err?.message || 'Could not load farm context' }
    }

    const messages = [{ role: 'system', content: assistantSystemPrompt(context, { deep: scope.deep, lang: body.value.lang }) }, ...turns]
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
      return res.status(failed.status).json(failureBody(failed))
    }
    // `model` is what was actually used; `fallback` tells the browser its saved choice is gone (D-022).
    if (org.handled) {
      const text = sanitizeAnswer(org.text)
      if (!text) return res.status(502).json({ error: LLM_FAILURE_TEXT.empty, code: 'empty', retryAfterSec: null })
      return res.status(200).json({
        text,
        provider: org.providerId,
        model: org.model,
        fallback: org.fallback,
        requestedModel: org.requestedModel,
        keySource: 'org',
      })
    }

    const serverArgs = {
      provider: body.value.provider ?? undefined,
      model: body.value.model ?? undefined,
      messages,
      temperature,
      referer,
      feature: 'chat',
    }
    if (req.query?.stream === '1') {
      return await streamAnswer(req, res, auth, serverArgs)
    }

    let served
    try {
      served = await guardedServerChat(auth.client, serverArgs)
    } catch (err) {
      // Provider text (quota metrics, URLs, project ids) is logged, never returned (llmErrors).
      const failed = gatewayError(err)
      return res.status(failed.status).json(failureBody(failed))
    }
    if (served.notConfigured) {
      // No server key: an admin adds one; the env var name is for the log, not the member.
      console.warn('[api/llm/chat]', served.error)
      return res.status(503).json({ error: LLM_FAILURE_TEXT.auth, code: 'not_configured', retryAfterSec: null })
    }
    const text = sanitizeAnswer(served.text)
    if (!text) return res.status(502).json({ error: LLM_FAILURE_TEXT.empty, code: 'empty', retryAfterSec: null })
    return res.status(200).json({
      text,
      provider: served.providerId,
      model: served.model,
      fallback: served.fallback,
      requestedModel: served.requestedModel,
      keySource: 'server',
    })
  } catch (err) {
    console.error('[api/llm/chat]', err?.message)
    return res.status(500).json({ error: LLM_FAILURE_TEXT.unknown, code: 'unknown', retryAfterSec: null })
  }
}

/** The server-key answer as NDJSON frames (see lib/chatStream). */
async function streamAnswer(req, res, auth, serverArgs) {
  const abort = new AbortController()
  // The member pressed Stop (or left): stop paying for tokens nobody reads.
  res.on('close', () => {
    if (!res.writableFinished) abort.abort()
  })
  let started = false
  const begin = () => {
    if (started) return
    started = true
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      // no-transform keeps compression from buffering the frames.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    })
  }
  const send = (event) => {
    if (res.writableEnded || abort.signal.aborted) return
    begin()
    res.write(ndjson(event))
  }
  try {
    // Lease, budget, breaker/Auto fallback and deadline as the unstreamed path (D-023).
    const reply = await streamWithServerKey(auth.client, serverArgs, {
      signal: abort.signal,
      onText: (text) => send({ type: 'text', text }),
    })
    if (reply.notConfigured) {
      console.warn('[api/llm/chat]', reply.error)
      return res.status(503).json({ error: LLM_FAILURE_TEXT.auth, code: 'not_configured', retryAfterSec: null })
    }
    if (reply.stopped || res.writableEnded) {
      if (!res.writableEnded) res.end()
      return
    }
    if (!reply.text) {
      const body = { error: LLM_FAILURE_TEXT.empty, code: 'empty', retryAfterSec: null }
      if (started) return res.end(ndjson({ type: 'error', ...body }))
      return res.status(502).json(body)
    }
    begin()
    res.end(
      ndjson({
        type: 'done',
        text: reply.text,
        provider: reply.providerId,
        model: reply.model,
        fallback: reply.fallback,
        requestedModel: reply.requestedModel,
        keySource: 'server',
      }),
    )
  } catch (err) {
    // Mid-stream failures become a classified frame; provider text is logged only.
    const failed = gatewayError(err)
    if (res.writableEnded) return
    if (started) return res.end(ndjson({ type: 'error', ...failureBody(failed) }))
    return res.status(failed.status).json(failureBody(failed))
  }
}
