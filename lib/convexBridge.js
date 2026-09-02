import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

let authToken = null
/** Authenticated ConvexReactClient from ConvexAuthProvider. */
let reactClient = null

export function setConvexAuthToken(token) {
  authToken = token || null
}

export function getConvexAuthToken() {
  return authToken
}

/** Bind the live React client so imperative calls can share session auth. */
export function bindConvexReactClient(client) {
  reactClient = client || null
}

function httpClientWithAuth() {
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

/**
 * Client for lib/ service calls.
 * Prefer a fresh JWT on HTTP (reliable for imperative calls). Fall back to the
 * React client only when it already has a session and no token is cached yet.
 */
export function getConvexHttpClient() {
  if (authToken) {
    return httpClientWithAuth()
  }

  if (reactClient) {
    return {
      query: (queryRef, args) => reactClient.query(queryRef, args),
      mutation: (mutationRef, args) => reactClient.mutation(mutationRef, args),
      action: (actionRef, args) => reactClient.action(actionRef, args),
    }
  }

  return httpClientWithAuth()
}

export { api }
