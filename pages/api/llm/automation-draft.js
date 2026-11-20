import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'
import { assistantRefusal, createRateLimiter } from '../../../lib/llmProxyGuard'
import { resolveProvider } from '../../../lib/llmServer'
import { chatWithOrgKey, chatWithServerKey, gatewayError } from '../../../lib/llmGatewayRoute'
import {
  MAX_REQUEST_CHARS,
  buildDraftSystemPrompt,
  extractJson,
  normalizeDraft,
  repairMessage,
} from '../../../lib/anowaDraft'

/**
 * Anowa automation drafts (AI-AUTO-001): turn "alert the managers when DO
 * drops below 4" into a rule draft the member reviews in the chat. Nothing
 * is saved here; the card saves through automation.rules.save, which needs
 * automation.manage.
 *
 * Same guards as /api/llm/chat (session, deactivated users, company AI
 * switch, ai.use, in-memory and Convex rate limits, org key first then the
 * server key), plus the company's AI policy (allowAutomationDrafts).
 *
 * The catalog the model may use comes from automation.rules.draftCatalog,
 * the draft is checked with automation.rules.checkDraft (the validation
 * `save` runs), and one repair turn feeds the problems back to the model.
 */
const perMinute = createRateLimiter({ limit: 5, windowMs: 60_000 })
const perHour = createRateLimiter({ limit: 40, windowMs: 60 * 60_000 })

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }

const TEMPERATURE = 0.1
const MAX_ATTEMPTS = 2

/** Problems from Convex's own validation of a draft (argument or rule errors). */
async function convexProblems(client, draft) {
  try {
    const result = await client.query(api.automation.rules.checkDraft, draft)
    return result.problems
  } catch (err) {
    const message = String(err?.data?.message || err?.data || err?.message || 'The rule is not valid')
    // Argument validation errors are long; keep the useful first line.
    return [message.split('\n')[0].slice(0, 300)]
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireApiUser(req, res)
  if (!auth) return
  if (auth.user.active === false) return res.status(403).json({ error: 'Your account is deactivated' })

  try {
    const aiStatus = await auth.client.query(api.companies.aiAssistantStatus, {})
    const refusal = assistantRefusal(aiStatus)
    if (refusal) return res.status(403).json({ error: refusal })
    if (!aiStatus.canDraftAutomations) {
      return res.status(403).json({ error: 'Your company has turned off automation drafts from Anowa' })
    }

    const userKey = String(auth.user._id || auth.user.id)
    for (const limiter of [perMinute, perHour]) {
      const verdict = limiter.check(userKey)
      if (!verdict.ok) {
        res.setHeader('Retry-After', String(verdict.retryAfterSec))
        return res.status(429).json({ error: `Too many requests. Try again in ${verdict.retryAfterSec} seconds.` })
      }
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const request = typeof body.request === 'string' ? body.request.trim() : ''
    if (!request) return res.status(400).json({ error: 'Describe the automation you want' })
    if (request.length > MAX_REQUEST_CHARS) {
      return res.status(400).json({ error: `Keep the request under ${MAX_REQUEST_CHARS} characters` })
    }
    const provider = typeof body.provider === 'string' ? body.provider : undefined
    const model = typeof body.model === 'string' ? body.model : undefined

    const catalog = await auth.client.query(api.automation.rules.draftCatalog, {})
    const messages = [
      { role: 'system', content: buildDraftSystemPrompt(catalog) },
      { role: 'user', content: request },
    ]
    const referer = req.headers.origin || undefined

    const ask = async () => {
      const org = await chatWithOrgKey(auth.client, {
        feature: 'chat',
        messages,
        providerId: provider,
        model,
        temperature: TEMPERATURE,
        referer,
      })
      if (org.handled) return org.text
      const resolved = await resolveProvider(provider, model)
      if (resolved.error) {
        const err = new Error(resolved.error)
        err.status = resolved.status
        throw err
      }
      return await chatWithServerKey(
        auth.client,
        { ...resolved.chat, messages, temperature: TEMPERATURE, referer },
        'chat',
        resolved.price,
      )
    }

    let result = { draft: null, explanation: '', problems: ['Anowa did not return a rule'] }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let text
      try {
        text = await ask()
      } catch (err) {
        if (err?.status) return res.status(err.status).json({ error: err.message })
        if (!err?.data) throw err
        const failed = gatewayError(err)
        return res.status(failed.status).json({ error: failed.error })
      }
      result = normalizeDraft(extractJson(text))
      if (result.draft && !result.problems.length) {
        result.problems = await convexProblems(auth.client, result.draft)
      }
      if (!result.problems.length || attempt === MAX_ATTEMPTS) break
      messages.push({ role: 'assistant', content: text.slice(0, 8000) })
      messages.push({ role: 'user', content: repairMessage(result.problems) })
    }

    return res.status(200).json({
      draft: result.draft,
      explanation: result.explanation,
      problems: result.problems,
      catalog,
      startPaused: aiStatus.policy.draftsStartPaused,
      canSave: aiStatus.canSaveAutomations,
    })
  } catch (err) {
    console.error('[api/llm/automation-draft]', err?.message)
    return res.status(500).json({ error: err?.message || 'Could not draft the automation' })
  }
}
