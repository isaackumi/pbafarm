import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'
import { assistantRefusal, createRateLimiter } from '../../../lib/llmProxyGuard'
import { LLM_PROVIDERS } from '../../../lib/llmClient'
import { defaultProviderFromEnv, listServerProvidersConfigured } from '../../../lib/llmEnv'
import { chooseServerModel, serverTarget } from '../../../lib/llmModelsServer'
import { gatewayError } from '../../../lib/llmGatewayRoute'
import { pickerModels } from '../../../convex/lib/llmModels'

/**
 * GET /api/llm/models (D-022): the assistant's model picker. The models each
 * usable provider offers right now, fetched from the provider with the key
 * that will be used: the organization's keys (Convex llmModels.list, keys
 * stay in Convex) when it has any, else the server keys. Keys never reach the
 * browser; only model ids, labels and whether a model reads images.
 *
 * Response: { source: 'org' | 'server' | 'none', defaultProvider, providers:
 * [{ id, label, defaultModel, models: [{ id, label, vision }], error }] }.
 * `defaultModel` is null and `error` set when a provider's list could not be
 * fetched and no LLM_DEFAULT_MODEL_<PROVIDER> is set.
 */
const perMinute = createRateLimiter({ limit: 30, windowMs: 60_000 })

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const auth = await requireApiUser(req, res)
  if (!auth) return
  if (auth.user.active === false) return res.status(403).json({ error: 'Your account is deactivated' })

  const verdict = perMinute.check(String(auth.user._id || auth.user.id))
  if (!verdict.ok) {
    res.setHeader('Retry-After', String(verdict.retryAfterSec))
    return res.status(429).json({ error: `Too many requests. Try again in ${verdict.retryAfterSec} seconds.` })
  }

  try {
    const aiStatus = await auth.client.query(api.companies.aiAssistantStatus, {})
    const refusal = assistantRefusal(aiStatus)
    if (refusal) return res.status(403).json({ error: refusal })

    let org = { hasOrgKey: false, providers: [] }
    try {
      org = await auth.client.action(api.llmModels.list, {})
    } catch (err) {
      const failed = gatewayError(err)
      return res.status(failed.status).json({ error: failed.error })
    }
    res.setHeader('Cache-Control', 'private, no-store')
    if (org.hasOrgKey) {
      return res.status(200).json({
        source: 'org',
        defaultProvider: org.providers.find((p) => p.isDefault)?.id || org.providers[0]?.id || '',
        providers: org.providers.map((p) => ({
          id: p.id,
          label: p.label,
          defaultModel: p.model,
          models: p.models,
          error: p.error,
        })),
      })
    }

    const configured = listServerProvidersConfigured()
    const ids = Object.keys(LLM_PROVIDERS).filter((id) => configured[id])
    const providers = await Promise.all(
      ids.map(async (id) => {
        const { choice, models } = await chooseServerModel(serverTarget(id), null)
        return {
          id,
          label: LLM_PROVIDERS[id].label,
          defaultModel: choice.ok ? choice.model : null,
          models: pickerModels(models, process.env, choice.ok ? choice.model : null),
          error: choice.ok ? null : choice.error,
        }
      }),
    )
    return res.status(200).json({
      source: providers.length ? 'server' : 'none',
      defaultProvider: defaultProviderFromEnv() || providers[0]?.id || '',
      providers,
    })
  } catch (err) {
    console.error('[api/llm/models]', err?.message)
    return res.status(500).json({ error: 'Could not load the model list' })
  }
}
