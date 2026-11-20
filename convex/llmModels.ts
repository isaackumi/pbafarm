import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import { action, internalMutation, internalQuery } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { requireMember } from './lib/permissions'
import { rateLimiter, retryAfterText } from './lib/rateLimits'
import { userError } from './lib/errors'
import { FetchLive } from './lib/effectHttp'
import { decryptJson, readEncryptionKey } from './lib/crypto'
import { PROVIDERS, llmCredentialAad } from './lib/llmGateway'
import {
  MODEL_CACHE_TTL_MS,
  type ListTarget,
  type ModelChoice,
  type ModelInfo,
  listModels,
  modelFingerprint,
  pickerModels,
  resolveModel,
} from './lib/llmModels'
import { webhookUrlProblem } from './integrations/webhookLogic'

/**
 * Live model lists inside Convex (D-022): the organization-key path of the
 * gateway, the farm bot, logbook OCR and weekly reports. Lists are fetched
 * with the key that will be used and cached in llmModelCache for an hour
 * under a fingerprint that includes the company (tenant isolation) and a
 * hash of the key; the key itself is never stored or returned.
 */

const modelInfo = v.object({
  id: v.string(),
  label: v.optional(v.string()),
  vision: v.boolean(),
  created: v.optional(v.number()),
  inputPerM: v.optional(v.number()),
  outputPerM: v.optional(v.number()),
})
const publicModelValidator = v.object({ id: v.string(), label: v.union(v.string(), v.null()), vision: v.boolean() })

const STALE_ROWS_MS = 24 * 60 * 60 * 1000

export const cachedList = internalQuery({
  args: { fingerprint: v.string() },
  returns: v.union(v.null(), v.object({ models: v.array(modelInfo), fetchedAt: v.number() })),
  handler: async (ctx, { fingerprint }) => {
    const row = await ctx.db
      .query('llmModelCache')
      .withIndex('by_fingerprint', (q) => q.eq('fingerprint', fingerprint))
      .first()
    return row ? { models: row.models, fetchedAt: row.fetchedAt } : null
  },
})

export const storeList = internalMutation({
  args: { fingerprint: v.string(), providerId: v.string(), models: v.array(modelInfo) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('llmModelCache')
      .withIndex('by_fingerprint', (q) => q.eq('fingerprint', args.fingerprint))
      .first()
    if (existing) await ctx.db.patch(existing._id, { models: args.models, fetchedAt: now })
    else await ctx.db.insert('llmModelCache', { ...args, fetchedAt: now })
    // Rotated keys leave rows behind; drop a few stale ones per write.
    const stale = await ctx.db
      .query('llmModelCache')
      .withIndex('by_fetchedAt', (q) => q.lt('fetchedAt', now - STALE_ROWS_MS))
      .take(20)
    for (const r of stale) await ctx.db.delete(r._id)
    return null
  },
})

export type LiveList = { models: ModelInfo[] | null; error?: string; status?: number }

/** Strip Convex system fields and undefined values from a cached row. */
function plain(models: ModelInfo[]): ModelInfo[] {
  return models.map((m) => ({
    id: m.id,
    vision: m.vision,
    ...(m.label !== undefined ? { label: m.label } : {}),
    ...(m.created !== undefined ? { created: m.created } : {}),
    ...(m.inputPerM !== undefined ? { inputPerM: m.inputPerM } : {}),
    ...(m.outputPerM !== undefined ? { outputPerM: m.outputPerM } : {}),
  }))
}

/**
 * The provider's chat models for this key, from the cache when fresh.
 * `scope` is the company id for an organization key, 'server' for an env key.
 * `{ models: null, error }` when the provider could not be reached.
 */
export async function liveModels(ctx: ActionCtx, target: ListTarget, scope: string): Promise<LiveList> {
  const fingerprint = await modelFingerprint(target, scope)
  const cached: { models: ModelInfo[]; fetchedAt: number } | null = await ctx.runQuery(internal.llmModels.cachedList, {
    fingerprint,
  })
  if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) return { models: cached.models }
  const outcome = await Effect.runPromise(Effect.result(listModels(target).pipe(Effect.provide(FetchLive))))
  if (Result.isFailure(outcome)) {
    console.warn(`[llm models] ${target.providerId}: ${outcome.failure.message}`)
    return { models: null, error: outcome.failure.message, status: outcome.failure.status }
  }
  const models = plain(outcome.success)
  await ctx.runMutation(internal.llmModels.storeList, { fingerprint, providerId: target.providerId, models })
  return { models }
}

/** Live list + `resolveModel` in one step; env from the Convex deployment. */
export async function chooseModel(
  ctx: ActionCtx,
  o: {
    target: ListTarget
    scope: string
    requested?: string | null
    saved?: string | null
    vision?: boolean
    /** Model ids not to pick (open breakers, a model that just failed). */
    exclude?: Iterable<string>
  },
): Promise<{ choice: ModelChoice; models: ModelInfo[] | null }> {
  const live = await liveModels(ctx, o.target, o.scope)
  const choice = resolveModel({
    providerId: o.target.providerId,
    label: PROVIDERS[o.target.providerId]?.label,
    models: live.models,
    requested: o.requested,
    saved: o.saved,
    env: process.env,
    vision: o.vision,
    listError: live.error,
    exclude: o.exclude,
  })
  return { choice, models: live.models }
}

/** Where a provider's API lives for listing and calls. */
export function providerBaseUrl(providerId: string, savedBaseUrl?: string | null): string {
  if (providerId === 'custom') return savedBaseUrl || process.env.CUSTOM_LLM_BASE_URL || ''
  return PROVIDERS[providerId]?.baseUrl ?? ''
}

// ---------------------------------------------------------------------------
// The organization's models (assistant picker, AI settings)
// ---------------------------------------------------------------------------

/** Internal: the caller's enabled organization keys (ai.use), sealed; rate limited per user. */
export const orgSources = internalMutation({
  args: {},
  returns: v.object({
    companyId: v.union(v.id('companies'), v.null()),
    sources: v.array(
      v.object({
        credentialId: v.id('llmCredentials'),
        providerId: v.string(),
        model: v.string(),
        baseUrl: v.union(v.string(), v.null()),
        isDefault: v.boolean(),
        ciphertext: v.string(),
        iv: v.string(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'ai.use' })
    if (!user.companyId) return { companyId: null, sources: [] }
    const companyId = user.companyId
    const verdict = await rateLimiter.limit(ctx, 'llmModelListPerUser', { key: user._id })
    if (!verdict.ok) throw userError('RATE_LIMITED', `Too many model list requests. ${retryAfterText(verdict.retryAfter)}`)
    const rows = await ctx.db
      .query('llmCredentials')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(Object.keys(PROVIDERS).length + 1)
    const sources = []
    for (const r of rows) {
      if (!r.enabled || !PROVIDERS[r.providerId]) continue
      const secret = await ctx.db
        .query('integrationSecrets')
        .withIndex('by_llmCredentialId', (q) => q.eq('llmCredentialId', r._id))
        .unique()
      if (!secret || secret.companyId !== companyId) continue
      sources.push({
        credentialId: r._id,
        providerId: r.providerId,
        model: r.model,
        baseUrl: r.baseUrl ?? null,
        isDefault: r.isDefault,
        ciphertext: secret.ciphertext,
        iv: secret.iv,
      })
    }
    return { companyId, sources }
  },
})

const providerModels = v.object({
  id: v.string(),
  label: v.string(),
  source: v.literal('org'),
  isDefault: v.boolean(),
  /** What the admin saved ('' = automatic). */
  savedModel: v.string(),
  /** The model a call with nothing requested would use; null when unavailable. */
  model: v.union(v.string(), v.null()),
  defaultModel: v.union(v.string(), v.null()),
  models: v.array(publicModelValidator),
  error: v.union(v.string(), v.null()),
})

type ProviderModels = {
  id: string
  label: string
  source: 'org'
  isDefault: boolean
  savedModel: string
  model: string | null
  defaultModel: string | null
  models: { id: string; label: string | null; vision: boolean }[]
  error: string | null
}

/**
 * The organization's providers with their live models, for the assistant's
 * picker and the AI settings page. `hasOrgKey: false` means the Next proxy
 * lists the server keys' models instead.
 */
export const list = action({
  args: {},
  returns: v.object({ hasOrgKey: v.boolean(), providers: v.array(providerModels) }),
  handler: async (ctx): Promise<{ hasOrgKey: boolean; providers: ProviderModels[] }> => {
    const { companyId, sources } = await ctx.runMutation(internal.llmModels.orgSources, {})
    if (!companyId || !sources.length) return { hasOrgKey: false, providers: [] }
    const key = readEncryptionKey()
    const providers: ProviderModels[] = []
    for (const s of sources) {
      const p = PROVIDERS[s.providerId]
      const row: ProviderModels = {
        id: p.id,
        label: p.label,
        source: 'org',
        isDefault: s.isDefault,
        savedModel: s.model,
        model: null,
        defaultModel: null,
        models: [],
        error: null,
      }
      if (!key) {
        providers.push({ ...row, error: 'The organization key cannot be read: encryption is not configured' })
        continue
      }
      let apiKey = ''
      try {
        apiKey = (
          await decryptJson<{ apiKey: string }>({ ciphertext: s.ciphertext, iv: s.iv }, llmCredentialAad(companyId, s.credentialId), key)
        ).apiKey
      } catch {
        providers.push({ ...row, error: 'The organization key cannot be read' })
        continue
      }
      const { choice, models } = await chooseModel(ctx, {
        target: { providerId: p.id, kind: p.kind, baseUrl: providerBaseUrl(p.id, s.baseUrl), apiKey },
        scope: companyId,
        saved: s.model,
      })
      providers.push({
        ...row,
        model: choice.ok ? choice.model : null,
        defaultModel: choice.ok ? choice.defaultModel : null,
        models: pickerModels(models, process.env, choice.ok ? choice.model : null),
        error: choice.ok ? null : choice.error,
      })
    }
    providers.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    return { hasOrgKey: true, providers }
  },
})

/** Internal: the admin's company for a pasted-key lookup, rate limited. */
export const beginPreview = internalMutation({
  args: {},
  returns: v.id('companies'),
  handler: async (ctx): Promise<Id<'companies'>> => {
    const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
    if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
    const verdict = await rateLimiter.limit(ctx, 'llmModelPreviewPerUser', { key: user._id })
    if (!verdict.ok) throw userError('RATE_LIMITED', `Too many model lookups. ${retryAfterText(verdict.retryAfter)}`)
    return user.companyId
  },
})

/**
 * Models a pasted key can use, before it is saved (AI settings). The key is
 * only sent to the provider's fixed endpoint (or the admin's public https
 * base URL for custom) and never stored.
 */
export const preview = action({
  args: { providerId: v.string(), apiKey: v.string(), baseUrl: v.optional(v.string()) },
  returns: v.object({
    models: v.array(publicModelValidator),
    defaultModel: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const p = PROVIDERS[args.providerId]
    if (!p) throw userError('VALIDATION', 'Unknown provider')
    const apiKey = args.apiKey.trim()
    if (apiKey.length < 8 || apiKey.length > 500 || /\s/.test(apiKey)) throw userError('VALIDATION', 'Paste the provider API key')
    let baseUrl = p.baseUrl
    if (p.id === 'custom') {
      const problem = webhookUrlProblem(args.baseUrl ?? '')
      if (problem) throw userError('VALIDATION', `Base URL: ${problem}`)
      baseUrl = new URL(args.baseUrl!.trim()).toString().replace(/\/$/, '')
    }
    const companyId: Id<'companies'> = await ctx.runMutation(internal.llmModels.beginPreview, {})
    const { choice, models } = await chooseModel(ctx, {
      target: { providerId: p.id, kind: p.kind, baseUrl, apiKey },
      scope: companyId,
    })
    return {
      models: pickerModels(models, process.env, choice.ok ? choice.defaultModel : null),
      defaultModel: choice.ok ? choice.defaultModel : null,
      error: choice.ok ? null : choice.error,
    }
  },
})
