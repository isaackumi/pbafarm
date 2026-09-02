import { chatCompletionWithKey, LLM_PROVIDERS } from '../../../lib/llmClient'
import {
  defaultProviderFromEnv,
  readServerProviderKey,
} from '../../../lib/llmEnv'
import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireApiUser(req, res)
  if (!auth) return

  try {
    const aiStatus = await auth.client.query(api.companies.aiAssistantStatus, {})
    if (!aiStatus?.enabled) {
      return res.status(403).json({
        error: 'Assistant is disabled for your company',
      })
    }

    const {
      provider: requestedProvider,
      model,
      messages,
      temperature,
      customBaseUrl,
    } = req.body || {}

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages are required' })
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
    const text = await chatCompletionWithKey({
      provider: providerId,
      apiKey,
      model: model || provider.defaultModel,
      messages,
      temperature: typeof temperature === 'number' ? temperature : 0.3,
      customBaseUrl: customBaseUrl || process.env.CUSTOM_LLM_BASE_URL || '',
    })

    return res.status(200).json({ text, provider: providerId })
  } catch (err) {
    console.error('[api/llm/chat]', err)
    return res.status(500).json({
      error: err?.message || 'Assistant request failed',
    })
  }
}
