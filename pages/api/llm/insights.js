import { requireApiUser } from '../../../lib/llmApiAuth'
import { api } from '../../../lib/convexBridge'
import { assistantRefusal, createRateLimiter } from '../../../lib/llmProxyGuard'
import { businessDateOr, resolveProvider } from '../../../lib/llmServer'
import { applyPhrasing, phrasingMessages } from '../../../lib/insightPhrasing'
import { chatWithOrgKey, chatWithServerKey } from '../../../lib/llmGatewayRoute'

/**
 * Dashboard insights with optional AI phrasing (Phase 13). The insights come
 * from assistant.forDashboard with the user's token (deterministic, company
 * scoped). Only when the company has the assistant enabled and a server key
 * exists does a model reword them; any reworded line that is not grounded in
 * the insight's numbers is dropped (lib/insightPhrasing). Failures fall back
 * to the plain insights, never to an error. The company's own key (INT-009)
 * is used when set, else the server key.
 */
const perHour = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const auth = await requireApiUser(req, res)
  if (!auth) return

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const args = { asOf: businessDateOr(body.asOf) }
  if (typeof body.locationId === 'string' && body.locationId) args.locationId = body.locationId

  let insights
  try {
    insights = await auth.client.query(api.assistant.forDashboard, args)
  } catch (err) {
    return res.status(400).json({ error: err?.data?.message || err?.message || 'Could not load insights' })
  }
  const plain = insights.map((i) => ({ ...i, phrased: null }))
  if (!insights.length) return res.status(200).json({ insights: plain, phrased: false })

  try {
    const status = await auth.client.query(api.companies.aiAssistantStatus, {})
    if (assistantRefusal(status)) return res.status(200).json({ insights: plain, phrased: false })
    if (!perHour.check(String(auth.user._id || auth.user.id)).ok) {
      return res.status(200).json({ insights: plain, phrased: false })
    }
    const messages = phrasingMessages(insights)
    const referer = req.headers.origin || undefined
    const org = await chatWithOrgKey(auth.client, { feature: 'insights', messages, temperature: 0.2, referer })
    let reply
    if (org.handled) {
      reply = org.text
    } else {
      const resolved = resolveProvider(undefined, undefined)
      if (resolved.error) return res.status(200).json({ insights: plain, phrased: false })
      reply = await chatWithServerKey(auth.client, { ...resolved.chat, messages, temperature: 0.2, referer }, 'insights')
    }
    const out = applyPhrasing(insights, reply)
    return res.status(200).json({ insights: out, phrased: out.some((i) => i.phrased) })
  } catch (err) {
    console.error('[api/llm/insights]', err?.message)
    return res.status(200).json({ insights: plain, phrased: false })
  }
}
