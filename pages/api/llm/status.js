import {
  defaultProviderFromEnv,
  listServerProvidersConfigured,
} from '../../../lib/llmEnv'
import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireApiUser(req, res)
  if (!auth) return

  const providers = listServerProvidersConfigured()
  let orgKey = { hasOrgKey: false, providerId: null, model: null }
  try {
    orgKey = await auth.client.query(api.llmGateway.orgKeyStatus, {})
  } catch (err) {
    console.warn('[api/llm/status]', err?.message)
  }

  return res.status(200).json({
    providers,
    defaultProvider: defaultProviderFromEnv() || '',
    orgKey,
    hasAny: Object.values(providers).some(Boolean) || orgKey.hasOrgKey,
  })
}
