import {
  defaultProviderFromEnv,
  listServerProvidersConfigured,
  readPublicProviderKeys,
} from '../../../lib/llmEnv'
import { requireApiUser } from '../../../lib/llmApiAuth'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireApiUser(req, res)
  if (!auth) return

  const server = listServerProvidersConfigured()
  const publicKeys = readPublicProviderKeys()
  const providers = {}
  for (const id of Object.keys(server)) {
    providers[id] = Boolean(server[id] || publicKeys[id])
  }

  return res.status(200).json({
    providers,
    defaultProvider:
      defaultProviderFromEnv() || (publicKeys.gemini && 'gemini') || '',
    hasAny: Object.values(providers).some(Boolean),
  })
}
