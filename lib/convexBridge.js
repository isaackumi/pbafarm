import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

let authToken = null

export function setConvexAuthToken(token) {
  authToken = token || null
}

export function getConvexAuthToken() {
  return authToken
}

export function getConvexHttpClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_CONVEX_URL')
  }
  const client = new ConvexHttpClient(url)
  if (authToken) {
    client.setAuth(authToken)
  }
  return client
}

export { api }
