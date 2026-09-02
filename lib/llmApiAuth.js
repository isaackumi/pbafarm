import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

/**
 * Require a Convex auth bearer token on Next API routes.
 * Returns { user } or writes an error response and returns null.
 */
export async function requireApiUser(req, res) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: 'Sign in required' })
    return null
  }

  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    res.status(500).json({ error: 'Missing NEXT_PUBLIC_CONVEX_URL' })
    return null
  }

  try {
    const client = new ConvexHttpClient(url)
    client.setAuth(token)
    const user = await client.query(api.users.current, {})
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return null
    }
    return { user, client }
  } catch (err) {
    res.status(401).json({ error: err?.message || 'Unauthorized' })
    return null
  }
}
