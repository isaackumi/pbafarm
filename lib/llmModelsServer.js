/**
 * Live model lists for the server keys (D-022), used by the Next LLM routes
 * (pages/api/llm/*). Server only: reads provider keys from env. Lists are
 * cached in memory per instance for an hour under a fingerprint of provider
 * + base URL + key (SHA-256; the key itself is not kept in the cache key).
 */
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import { FetchLive, fetchLayer } from '../convex/lib/effectHttp'
import { createModelCache, listModels, listedPrice, modelFingerprint, resolveModel } from '../convex/lib/llmModels'
import { LLM_PROVIDERS } from './llmClient'
import { readServerProviderKey } from './llmEnv'

const serverCache = createModelCache()

/** Provider, endpoint and server key to list or call `providerId` with. */
export function serverTarget(providerId, env = process.env, readKey = readServerProviderKey) {
  const provider = LLM_PROVIDERS[providerId]
  if (!provider) return null
  return {
    providerId,
    kind: provider.kind,
    // Never let the browser choose where the server's key is sent.
    baseUrl: providerId === 'custom' ? String(env.CUSTOM_LLM_BASE_URL || '') : provider.baseUrl,
    apiKey: readKey(providerId),
  }
}

/**
 * The provider's chat models for the server key: `{ models }` or
 * `{ models: null, error }`. `fetchImpl` and `cache` are for tests.
 */
export async function serverModels(target, { fetchImpl, cache = serverCache } = {}) {
  if (!target?.apiKey) return { models: null, error: 'No API key configured' }
  const fingerprint = await modelFingerprint(target, 'server')
  const hit = cache.get(fingerprint)
  if (hit) return { models: hit }
  const program = listModels(target).pipe(Effect.provide(fetchImpl ? fetchLayer(fetchImpl) : FetchLive))
  const outcome = await Effect.runPromise(Effect.result(program))
  if (Result.isFailure(outcome)) {
    console.warn(`[llm models] ${target.providerId}: ${outcome.failure.message}`)
    return { models: null, error: outcome.failure.message }
  }
  cache.set(fingerprint, outcome.success)
  return { models: outcome.success }
}

/**
 * The model to call on the server key: the requested one when the live list
 * (or LLM_EXTRA_MODELS) has it, else the default. `{ choice, models }`.
 */
export async function chooseServerModel(target, requested, { env = process.env, ...opts } = {}) {
  const live = await serverModels(target, opts)
  const choice = resolveModel({
    providerId: target.providerId,
    label: LLM_PROVIDERS[target.providerId]?.label,
    models: live.models,
    requested,
    env,
    listError: live.error,
  })
  return { choice, models: live.models, price: choice.ok ? listedPrice(live.models, choice.model) : undefined }
}
