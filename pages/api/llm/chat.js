import { chatCompletionWithKey, LLM_PROVIDERS } from '../../../lib/llmClient'
import {
  defaultProviderFromEnv,
  readServerProviderKey,
} from '../../../lib/llmEnv'
import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'
import {
  clampTemperature,
  createRateLimiter,
  resolveAllowedModel,
  validateMessages,
} from '../../../lib/llmProxyGuard'

/**
 * Server-side LLM proxy: spends the server's provider keys on behalf of a
 * signed-in user whose company has the assistant enabled.
 *
 * Guards: Convex session token verified (requireApiUser calls users.current
 * with it), deactivated users refused, company AI toggle, per-user rate limit,
 * model allow-list, message count/size caps.
 *
 * Rate limits are in-memory per server instance (see lib/llmProxyGuard.js):
 * a stopgap until a shared limiter exists.
 */
const perMinute = createRateLimiter({ limit: 10, windowMs: 60_000 })
const perHour = createRateLimiter({ limit: 100, windowMs: 60 * 60_000 })

// Accept a little more than the 120k-char message cap (JSON overhead).
export const config = { api: { bodyParser: { sizeLimit: '256kb' } } }

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

  const userKey = String(auth.user._id || auth.user.id)
  for (const limiter of [perMinute, perHour]) {
    const verdict = limiter.check(userKey)
    if (!verdict.ok) {
      res.setHeader('Retry-After', String(verdict.retryAfterSec))
      return res.status(429).json({
        error: `Too many assistant requests. Try again in ${verdict.retryAfterSec} seconds.`,
      })
    }
  }

  try {
    const aiStatus = await auth.client.query(api.companies.aiAssistantStatus, {})
    if (!aiStatus?.enabled) {
      return res.status(403).json({
        error: 'Assistant is disabled for your company',
      })
    }

    const {
      provider: requestedProvider,
      model: requestedModel,
      messages: rawMessages,
      temperature,
    } = req.body || {}

    const checked = validateMessages(rawMessages)
    if (checked.error) {
      return res.status(400).json({ error: checked.error })
    }

    const providerId =
      (requestedProvider && LLM_PROVIDERS[requestedProvider]
        ? requestedProvider
        : null) ||
      defaultProviderFromEnv() ||
      'gemini'

    const apiKey = readServerProviderKey(providerId)
    if (!apiKey) {
      const envName =
        {
          gemini: 'GEMINI_API_KEY',
          openai: 'OPENAI_API_KEY',
          openrouter: 'OPENROUTER_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
          groq: 'GROQ_API_KEY',
          custom: 'CUSTOM_LLM_API_KEY',
        }[providerId] || 'GEMINI_API_KEY'
      return res.status(400).json({
        error: `No API key configured for ${providerId}. Add ${envName} to .env.local (or save a key in the assistant).`,
      })
    }

    const provider = LLM_PROVIDERS[providerId]
    const model = resolveAllowedModel(
      provider,
      requestedModel,
      process.env.LLM_EXTRA_MODELS,
    )
    if (!model) {
      return res.status(400).json({
        error: `Model "${String(requestedModel).slice(0, 80)}" is not allowed for ${providerId}`,
      })
    }

    const text = await chatCompletionWithKey({
      provider: providerId,
      apiKey,
      model,
      messages: checked.messages,
      temperature: clampTemperature(temperature),
      // Never let the browser choose where the server's key is sent.
      customBaseUrl: process.env.CUSTOM_LLM_BASE_URL || '',
    })

    return res.status(200).json({ text, provider: providerId })
  } catch (err) {
    console.error('[api/llm/chat]', err)
    return res.status(500).json({
      error: err?.message || 'Assistant request failed',
    })
  }
}
