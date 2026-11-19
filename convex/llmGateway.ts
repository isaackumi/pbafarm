import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import { action, internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { logAudit } from './lib/tenancy'
import { requireAccount, requireMember } from './lib/permissions'
import { rateLimiter, retryAfterText } from './lib/rateLimits'
import { userError } from './lib/errors'
import { runEffect } from './lib/effect'
import { FetchLive } from './lib/effectHttp'
import { MISSING_KEY_MESSAGE, decryptJson, encryptJson, encryptionConfigured, readEncryptionKey, secretHint } from './lib/crypto'
import { chatWithUsage, type ChatReply, type LlmError } from './lib/llmProviders'
import { webhookUrlProblem } from './integrations/webhookLogic'
import {
  MAX_MODEL_CHARS,
  PROVIDERS,
  estimateCostUsd,
  gatewayModel,
  llmCredentialAad,
  messagesProblem,
  modelProblem,
  tokenCount,
} from './lib/llmGateway'

/**
 * LLM gateway on the credential model (INT-009, doc 09 §10).
 *
 * - An organization can store its own provider key (integrations.manage).
 *   The key is AES-GCM encrypted in integrationSecrets (llmCredentialId)
 *   with INTEGRATIONS_ENCRYPTION_KEY, like webhook and channel secrets; it is
 *   decrypted only inside `chat` (an action) and never returned.
 * - `chat` is what the Next proxy (pages/api/llm/*) calls first. With no org
 *   key it returns `{ handled: false }` and the proxy falls back to the
 *   server key. With one, it runs the same SEC-004 checks on the Convex side
 *   (ai.use, the company's assistant switch, message caps, per-user and
 *   per-company limits in the shared rate limiter), calls the provider
 *   (convex/lib/llmProviders, Effect + effectHttp) and logs usage.
 * - Every call, on either key, is a row in llmUsage: user, provider, model,
 *   tokens, cost estimate. Server-key rows are reported by the proxy with
 *   `recordServerUsage` (rate limited).
 */

const DAY = 24 * 60 * 60 * 1000
const USAGE_RETENTION_MS = 400 * DAY
const MAX_SUMMARY_ROWS = 5000
const MAX_CREDENTIALS = Object.keys(PROVIDERS).length

const feature = v.union(v.literal('chat'), v.literal('insights'))
const message = v.object({
  role: v.union(v.literal('system'), v.literal('user'), v.literal('assistant')),
  content: v.string(),
})

type Ctx = QueryCtx | MutationCtx

async function requireLlmAdmin(ctx: Ctx) {
  const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  return { user, companyId: user.companyId }
}

async function loadOwn(ctx: Ctx, companyId: Id<'companies'>, credentialId: Id<'llmCredentials'>) {
  const row = await ctx.db.get(credentialId)
  if (!row || row.companyId !== companyId) throw new Error('Provider key not found')
  return row
}

async function companyCredentials(ctx: Ctx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('llmCredentials')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(MAX_CREDENTIALS + 1)
}

function credentialToClient(row: Doc<'llmCredentials'>) {
  return {
    id: row._id,
    providerId: row.providerId,
    providerLabel: PROVIDERS[row.providerId]?.label ?? row.providerId,
    model: row.model,
    baseUrl: row.baseUrl ?? null,
    keyHint: row.keyHint ?? null,
    isDefault: row.isDefault,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  }
}

function cleanBaseUrl(providerId: string, baseUrl?: string) {
  if (providerId !== 'custom') return undefined
  const problem = webhookUrlProblem(baseUrl ?? '')
  if (problem) throw userError('VALIDATION', `Base URL: ${problem}`)
  return new URL(baseUrl!.trim()).toString().replace(/\/$/, '')
}

/** Pick the credential for a call: the requested provider, else the default, else any enabled. */
function pickCredential(rows: Doc<'llmCredentials'>[], providerId?: string) {
  const live = rows.filter((r) => r.enabled)
  return (
    (providerId ? live.find((r) => r.providerId === providerId) : undefined) ??
    live.find((r) => r.isDefault) ??
    live[0] ??
    null
  )
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** AI settings page: providers, the organization's keys (hints only) and a usage summary since `since`. */
export const overview = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const { companyId } = await requireLlmAdmin(ctx)
    const credentials = await companyCredentials(ctx, companyId)
    const rows = await ctx.db
      .query('llmUsage')
      .withIndex('by_companyId_and_createdAt', (q) => q.eq('companyId', companyId).gte('createdAt', since))
      .order('desc')
      .take(MAX_SUMMARY_ROWS)
    const byModel = new Map<string, { providerId: string; model: string; calls: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number; orgKeyCalls: number }>()
    const byUser = new Map<string, { userId: Id<'users'>; calls: number; costUsd: number }>()
    for (const r of rows) {
      const k = `${r.providerId}:${r.model}`
      const m = byModel.get(k) ?? { providerId: r.providerId, model: r.model, calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, orgKeyCalls: 0 }
      m.calls += 1
      if (!r.ok) m.failed += 1
      if (r.source === 'org_key') m.orgKeyCalls += 1
      m.inputTokens += r.inputTokens ?? 0
      m.outputTokens += r.outputTokens ?? 0
      m.costUsd += r.costUsd ?? 0
      byModel.set(k, m)
      const u = byUser.get(r.userId) ?? { userId: r.userId, calls: 0, costUsd: 0 }
      u.calls += 1
      u.costUsd += r.costUsd ?? 0
      byUser.set(r.userId, u)
    }
    const users = []
    for (const u of [...byUser.values()].sort((a, b) => b.calls - a.calls).slice(0, 10)) {
      const doc = await ctx.db.get(u.userId)
      users.push({ ...u, name: doc && doc.companyId === companyId ? doc.name || doc.email || '—' : '—' })
    }
    return {
      encryptionReady: encryptionConfigured(),
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, defaultModel: p.defaultModel, models: p.models })),
      credentials: credentials.map(credentialToClient),
      usage: {
        calls: rows.length,
        truncated: rows.length >= MAX_SUMMARY_ROWS,
        costUsd: Math.round([...byModel.values()].reduce((a, m) => a + m.costUsd, 0) * 10_000) / 10_000,
        byModel: [...byModel.values()].sort((a, b) => b.calls - a.calls),
        byUser: users,
      },
    }
  },
})

/** Usage log, newest first. */
export const usage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { companyId } = await requireLlmAdmin(ctx)
    const res = await ctx.db
      .query('llmUsage')
      .withIndex('by_companyId_and_createdAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .paginate(paginationOpts)
    const names = new Map<string, string>()
    const page = []
    for (const r of res.page) {
      if (!names.has(r.userId)) {
        const doc = await ctx.db.get(r.userId)
        names.set(r.userId, doc && doc.companyId === companyId ? doc.name || doc.email || '—' : '—')
      }
      page.push({
        id: r._id,
        user: names.get(r.userId)!,
        providerId: r.providerId,
        model: r.model,
        source: r.source,
        feature: r.feature,
        ok: r.ok,
        error: r.error ?? null,
        inputTokens: r.inputTokens ?? null,
        outputTokens: r.outputTokens ?? null,
        costUsd: r.costUsd ?? null,
        durationMs: r.durationMs ?? null,
        createdAt: r.createdAt,
      })
    }
    return { ...res, page }
  },
})

/** Internal: create or update the organization's credential row for a provider. */
export const upsertCredentialRow = internalMutation({
  args: { providerId: v.string(), model: v.string(), baseUrl: v.optional(v.string()), makeDefault: v.boolean() },
  returns: v.object({ id: v.id('llmCredentials'), companyId: v.id('companies') }),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireLlmAdmin(ctx)
    const problem = modelProblem(args.providerId, args.model)
    if (problem) throw userError('VALIDATION', problem)
    const baseUrl = cleanBaseUrl(args.providerId, args.baseUrl)
    const all = await companyCredentials(ctx, companyId)
    const existing = all.find((r) => r.providerId === args.providerId)
    const now = Date.now()
    const isDefault = args.makeDefault || !all.some((r) => r.isDefault && r._id !== existing?._id)
    if (isDefault) {
      for (const r of all) if (r.isDefault && r._id !== existing?._id) await ctx.db.patch(r._id, { isDefault: false })
    }
    const fields = { model: args.model.trim(), baseUrl, isDefault, updatedBy: user._id, updatedAt: now }
    const id = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert('llmCredentials', {
          companyId,
          providerId: args.providerId,
          enabled: false,
          createdAt: now,
          ...fields,
        })
    return { id, companyId }
  },
})

/** Internal: store the encrypted key and turn the credential on. */
export const storeCredentialSecret = internalMutation({
  args: { credentialId: v.id('llmCredentials'), ciphertext: v.string(), iv: v.string(), keyVersion: v.number(), hint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireLlmAdmin(ctx)
    const row = await loadOwn(ctx, companyId, args.credentialId)
    const now = Date.now()
    const existing = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_llmCredentialId', (q) => q.eq('llmCredentialId', args.credentialId))
      .unique()
    const secretRow = {
      companyId,
      llmCredentialId: args.credentialId,
      ciphertext: args.ciphertext,
      iv: args.iv,
      keyVersion: args.keyVersion,
      updatedAt: now,
    }
    if (existing) await ctx.db.replace(existing._id, secretRow)
    else await ctx.db.insert('integrationSecrets', secretRow)
    await ctx.db.patch(args.credentialId, { keyHint: args.hint, enabled: true, updatedAt: now })
    await logAudit(ctx, {
      actionType: existing ? 'llm_key_rotate' : 'llm_key_set',
      tableName: 'llmCredentials',
      recordId: args.credentialId,
      newValues: { providerId: row.providerId, model: row.model, keyVersion: args.keyVersion },
    })
    return null
  },
})

/** Save (or replace) the organization's key for a provider. The key is never returned. */
export const saveCredential = action({
  args: {
    providerId: v.string(),
    model: v.string(),
    apiKey: v.string(),
    baseUrl: v.optional(v.string()),
    makeDefault: v.optional(v.boolean()),
  },
  returns: v.object({ id: v.id('llmCredentials') }),
  handler: async (ctx, args): Promise<{ id: Id<'llmCredentials'> }> => {
    const key = readEncryptionKey()
    if (!key) throw new Error(MISSING_KEY_MESSAGE)
    const apiKey = args.apiKey.trim()
    if (apiKey.length < 8 || apiKey.length > 500 || /\s/.test(apiKey)) throw userError('VALIDATION', 'Paste the provider API key')
    const { id, companyId }: { id: Id<'llmCredentials'>; companyId: Id<'companies'> } = await ctx.runMutation(
      internal.llmGateway.upsertCredentialRow,
      { providerId: args.providerId, model: args.model, baseUrl: args.baseUrl, makeDefault: args.makeDefault ?? false },
    )
    const sealed = await encryptJson({ apiKey }, llmCredentialAad(companyId, id), key)
    await ctx.runMutation(internal.llmGateway.storeCredentialSecret, { credentialId: id, ...sealed, hint: secretHint(apiKey) ?? '…' })
    return { id }
  },
})

/** Change the model, turn a key on/off, or make it the default. */
export const updateCredential = mutation({
  args: {
    credentialId: v.id('llmCredentials'),
    model: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    makeDefault: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireLlmAdmin(ctx)
    const row = await loadOwn(ctx, companyId, args.credentialId)
    const patch: Partial<Doc<'llmCredentials'>> = { updatedAt: Date.now(), updatedBy: user._id }
    if (args.model !== undefined) {
      const problem = modelProblem(row.providerId, args.model)
      if (problem) throw userError('VALIDATION', problem)
      patch.model = args.model.trim()
    }
    if (args.enabled === true && !row.keyHint) throw userError('VALIDATION', 'Save a key first')
    if (args.enabled !== undefined) patch.enabled = args.enabled
    if (args.makeDefault) {
      for (const r of await companyCredentials(ctx, companyId)) {
        if (r.isDefault && r._id !== row._id) await ctx.db.patch(r._id, { isDefault: false })
      }
      patch.isDefault = true
    }
    await ctx.db.patch(row._id, patch)
    await logAudit(ctx, {
      actionType: 'llm_key_update',
      tableName: 'llmCredentials',
      recordId: row._id,
      previousValues: { model: row.model, enabled: row.enabled, isDefault: row.isDefault },
      newValues: { model: patch.model, enabled: patch.enabled, isDefault: patch.isDefault },
    })
    return null
  },
})

/** Delete a key; calls fall back to the next key or the server's. */
export const removeCredential = mutation({
  args: { credentialId: v.id('llmCredentials') },
  returns: v.null(),
  handler: async (ctx, { credentialId }) => {
    const { companyId } = await requireLlmAdmin(ctx)
    const row = await loadOwn(ctx, companyId, credentialId)
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_llmCredentialId', (q) => q.eq('llmCredentialId', credentialId))
      .unique()
    if (secret) await ctx.db.delete(secret._id)
    await ctx.db.delete(credentialId)
    if (row.isDefault) {
      const next = (await companyCredentials(ctx, companyId)).find((r) => r.enabled)
      if (next) await ctx.db.patch(next._id, { isDefault: true })
    }
    await logAudit(ctx, {
      actionType: 'llm_key_remove',
      tableName: 'llmCredentials',
      recordId: credentialId,
      previousValues: { providerId: row.providerId, model: row.model },
    })
    return null
  },
})

/** For /api/llm/status: whether the caller's organization has its own key (no secrets). */
export const orgKeyStatus = query({
  args: {},
  returns: v.object({ hasOrgKey: v.boolean(), providerId: v.union(v.string(), v.null()), model: v.union(v.string(), v.null()) }),
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    if (!user.companyId) return { hasOrgKey: false, providerId: null, model: null }
    const cred = pickCredential(await companyCredentials(ctx, user.companyId))
    return { hasOrgKey: !!cred, providerId: cred?.providerId ?? null, model: cred?.model ?? null }
  },
})

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export type BeginResult =
  | { handled: false }
  | {
      handled: true
      companyId: Id<'companies'>
      userId: Id<'users'>
      credentialId: Id<'llmCredentials'>
      providerId: string
      model: string
      baseUrl: string | null
      ciphertext: string
      iv: string
    }

/**
 * Internal: SEC-004 checks and the org credential for a call. Limits are
 * only spent when the org key will be used; otherwise the Next proxy's own
 * limits apply to the server-key call.
 */
export const begin = internalMutation({
  args: { providerId: v.optional(v.string()), model: v.optional(v.string()) },
  handler: async (ctx, args): Promise<BeginResult> => {
    const { user } = await requireMember(ctx, { permission: 'ai.use' })
    const companyId = user.companyId
    if (!companyId) return { handled: false }
    const company = await ctx.db.get(companyId)
    if (company?.settings?.aiAssistantEnabled !== true) {
      throw userError('FORBIDDEN', 'Assistant is disabled for your company')
    }
    const cred = pickCredential(await companyCredentials(ctx, companyId), args.providerId)
    if (!cred) return { handled: false }
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_llmCredentialId', (q) => q.eq('llmCredentialId', cred._id))
      .unique()
    if (!secret) return { handled: false }
    const limits = [
      ['llmPerUserMinute', user._id],
      ['llmPerUserHour', user._id],
      ['llmPerCompanyHour', companyId],
    ] as const
    for (const [name, key] of limits) {
      const verdict = await rateLimiter.check(ctx, name, { key })
      if (!verdict.ok) {
        throw userError('RATE_LIMITED', `Too many assistant requests. ${retryAfterText(verdict.retryAfter)}`)
      }
    }
    for (const [name, key] of limits) await rateLimiter.limit(ctx, name, { key })
    return {
      handled: true,
      companyId,
      userId: user._id,
      credentialId: cred._id,
      providerId: cred.providerId,
      model: gatewayModel(cred.providerId, cred.model, args.model),
      baseUrl: cred.baseUrl ?? null,
      ciphertext: secret.ciphertext,
      iv: secret.iv,
    }
  },
})

const usageFields = {
  providerId: v.string(),
  model: v.string(),
  feature,
  ok: v.boolean(),
  error: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  durationMs: v.optional(v.number()),
}

async function insertUsage(
  ctx: MutationCtx,
  row: {
    companyId: Id<'companies'>
    userId: Id<'users'>
    source: 'org_key' | 'server_key'
    providerId: string
    model: string
    feature: 'chat' | 'insights'
    ok: boolean
    error?: string
    inputTokens?: number
    outputTokens?: number
    durationMs?: number
  },
) {
  const inputTokens = tokenCount(row.inputTokens)
  const outputTokens = tokenCount(row.outputTokens)
  await ctx.db.insert('llmUsage', {
    ...row,
    model: row.model.slice(0, MAX_MODEL_CHARS),
    error: row.error?.slice(0, 300),
    inputTokens,
    outputTokens,
    durationMs: tokenCount(row.durationMs),
    costUsd: estimateCostUsd(row.model, inputTokens, outputTokens),
    createdAt: Date.now(),
  })
}

export const recordUsage = internalMutation({
  args: { companyId: v.id('companies'), userId: v.id('users'), ...usageFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    await insertUsage(ctx, { ...args, source: 'org_key' })
    return null
  },
})

/** The Next proxy reports a call it made on the server's key. */
export const recordServerUsage = mutation({
  args: usageFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'ai.use' })
    if (!user.companyId) return null
    if (!PROVIDERS[args.providerId]) throw userError('VALIDATION', 'Unknown provider')
    const verdict = await rateLimiter.limit(ctx, 'llmUsageReportPerUser', { key: user._id })
    if (!verdict.ok) return null
    await insertUsage(ctx, { ...args, companyId: user.companyId, userId: user._id, source: 'server_key' })
    return null
  },
})

export type GatewayReply =
  | { handled: false }
  | { handled: true; text: string; providerId: string; model: string; inputTokens: number | null; outputTokens: number | null }

/**
 * One chat completion on the organization's key, or `{ handled: false }`
 * when it has none (the caller then uses the server key).
 */
export const chat = action({
  args: {
    feature,
    messages: v.array(message),
    providerId: v.optional(v.string()),
    model: v.optional(v.string()),
    temperature: v.optional(v.number()),
    referer: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<GatewayReply> => {
    const problem = messagesProblem(args.messages)
    if (problem) throw userError('VALIDATION', problem)
    const begun: BeginResult = await ctx.runMutation(internal.llmGateway.begin, {
      providerId: args.providerId,
      model: args.model,
    })
    if (!begun.handled) return { handled: false }
    const key = readEncryptionKey()
    if (!key) throw userError('UPSTREAM', 'The organization key cannot be read: encryption is not configured')
    const { apiKey } = await decryptJson<{ apiKey: string }>(
      { ciphertext: begun.ciphertext, iv: begun.iv },
      llmCredentialAad(begun.companyId, begun.credentialId),
      key,
    )
    const provider = PROVIDERS[begun.providerId]
    const temperature =
      typeof args.temperature === 'number' && Number.isFinite(args.temperature)
        ? Math.min(1, Math.max(0, args.temperature))
        : 0.3
    const started = Date.now()
    const program = Effect.gen(function* () {
      const outcome = yield* Effect.result(
        chatWithUsage({
          kind: provider.kind,
          providerId: provider.id,
          // Only the admin's saved URL for custom; fixed endpoints otherwise.
          baseUrl: provider.id === 'custom' ? begun.baseUrl ?? '' : provider.baseUrl,
          apiKey,
          model: begun.model,
          messages: args.messages,
          temperature,
          referer: args.referer,
        }),
      )
      const reply: ChatReply | null = Result.isSuccess(outcome) ? outcome.success : null
      yield* Effect.promise(() =>
        ctx.runMutation(internal.llmGateway.recordUsage, {
          companyId: begun.companyId,
          userId: begun.userId,
          providerId: begun.providerId,
          model: begun.model,
          feature: args.feature,
          ok: !!reply,
          error: Result.isFailure(outcome) ? outcome.failure.message : undefined,
          inputTokens: reply?.usage.inputTokens,
          outputTokens: reply?.usage.outputTokens,
          durationMs: Date.now() - started,
        }),
      )
      if (Result.isFailure(outcome)) return yield* Effect.fail(outcome.failure)
      return outcome.success
    }).pipe(Effect.provide(FetchLive))
    const reply = await runEffect(program, {
      toUserError: (e: LlmError) => userError('UPSTREAM', e.message, e.status ? { status: e.status } : undefined),
    })
    return {
      handled: true,
      text: reply.text,
      providerId: begun.providerId,
      model: begun.model,
      inputTokens: reply.usage.inputTokens ?? null,
      outputTokens: reply.usage.outputTokens ?? null,
    }
  },
})

/** Usage log retention: 400 days (a year of history for cost reviews). */
export const pruneUsage = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query('llmUsage')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', Date.now() - USAGE_RETENTION_MS))
      .take(500)
    for (const row of old) await ctx.db.delete(row._id)
    return old.length
  },
})

