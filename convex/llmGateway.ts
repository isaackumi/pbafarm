import { v } from 'convex/values'
import { paginationResultValidator, paginationOptsValidator } from 'convex/server'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { logAudit } from './lib/tenancy'
import { spendDailyQuestion } from './lib/aiPolicy'
import { requireAccount, requireMember } from './lib/permissions'
import { rateLimiter, retryAfterText } from './lib/rateLimits'
import { userError } from './lib/errors'
import { LLM_FAILURE_TEXT, classifyLlmFailure } from './lib/llmErrors'
import { MISSING_KEY_MESSAGE, decryptJson, encryptJson, encryptionConfigured, readEncryptionKey, secretHint } from './lib/crypto'
import { webhookUrlProblem } from './integrations/webhookLogic'
import {
  MAX_MODEL_CHARS,
  PROVIDERS,
  cleanPrice,
  estimateCostUsd,
  llmCredentialAad,
  messagesProblem,
  modelProblem,
  tokenCount,
} from './lib/llmGateway'
import { extraModels } from './lib/llmModels'
import { liveModels, providerBaseUrl } from './llmModels'
import { admissionError, admitCall, afterUsage } from './aiGuard'
import { runGuarded } from './lib/aiGuard'
import { chatAttempt, modelPicker, releaseLease, statusOf, type KeyTarget } from './lib/aiCall'

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
const usageFeature = v.union(v.literal('chat'), v.literal('insights'), v.literal('report'), v.literal('bot'), v.literal('ocr'))
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

export async function companyCredentials(ctx: Ctx, companyId: Id<'companies'>) {
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
export function pickCredential(rows: Doc<'llmCredentials'>[], providerId?: string) {
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
/**
 * A provider failure as a ConvexError members may see: the message for its
 * kind (quota, rate limit, key, model…), never the provider's own text, which
 * stays in the server log and the usage log (llmUsage.error) for admins.
 */
function upstreamError(raw: string, status?: number) {
  const f = classifyLlmFailure({ status, message: raw })
  return userError('UPSTREAM', LLM_FAILURE_TEXT[f.kind], {
    kind: f.kind,
    status: status ?? null,
    retryAfterSec: f.retryAfterSec,
  })
}

export const overview = query({
  args: { since: v.number() },
  returns: v.object({
    encryptionReady: v.boolean(),
    providers: v.array(v.object({ id: v.string(), label: v.string() })),
    credentials: v.array(
      v.object({
        id: v.id('llmCredentials'),
        providerId: v.string(),
        providerLabel: v.string(),
        model: v.string(),
        baseUrl: v.union(v.string(), v.null()),
        keyHint: v.union(v.string(), v.null()),
        isDefault: v.boolean(),
        enabled: v.boolean(),
        updatedAt: v.number(),
      }),
    ),
    usage: v.object({
      calls: v.number(),
      truncated: v.boolean(),
      costUsd: v.number(),
      byModel: v.array(
        v.object({
          providerId: v.string(),
          model: v.string(),
          calls: v.number(),
          failed: v.number(),
          inputTokens: v.number(),
          outputTokens: v.number(),
          costUsd: v.number(),
          orgKeyCalls: v.number(),
        }),
      ),
      byUser: v.array(
        v.object({
          name: v.string(),
          userId: v.id('users'),
          calls: v.number(),
          costUsd: v.number(),
        }),
      ),
    }),
  }),
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
      if (r.userId) {
        const u = byUser.get(r.userId) ?? { userId: r.userId, calls: 0, costUsd: 0 }
        u.calls += 1
        u.costUsd += r.costUsd ?? 0
        byUser.set(r.userId, u)
      }
    }
    const users = []
    for (const u of [...byUser.values()].sort((a, b) => b.calls - a.calls).slice(0, 10)) {
      const doc = await ctx.db.get(u.userId)
      users.push({ ...u, name: doc && doc.companyId === companyId ? doc.name || doc.email || '—' : '—' })
    }
    return {
      encryptionReady: encryptionConfigured(),
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label })),
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
  returns: paginationResultValidator(
    v.object({
      id: v.id('llmUsage'),
      user: v.string(),
      providerId: v.string(),
      model: v.string(),
      source: v.union(v.literal('org_key'), v.literal('server_key')),
      feature: usageFeature,
      ok: v.boolean(),
      error: v.union(v.string(), v.null()),
      inputTokens: v.union(v.number(), v.null()),
      outputTokens: v.union(v.number(), v.null()),
      costUsd: v.union(v.number(), v.null()),
      durationMs: v.union(v.number(), v.null()),
      createdAt: v.number(),
    }),
  ),
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
      if (r.userId && !names.has(r.userId)) {
        const doc = await ctx.db.get(r.userId)
        names.set(r.userId, doc && doc.companyId === companyId ? doc.name || doc.email || '—' : '—')
      }
      page.push({
        id: r._id,
        // Scheduled calls (weekly report) have no user.
        user: r.userId ? names.get(r.userId)! : 'Scheduled',
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

/** Internal: the admin's company (integrations.manage). */
export const adminCompany = internalQuery({
  args: {},
  returns: v.id('companies'),
  handler: async (ctx) => (await requireLlmAdmin(ctx)).companyId,
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
    const provider = PROVIDERS[args.providerId]
    if (!provider) throw userError('VALIDATION', 'Unknown provider')
    const problem = modelProblem(args.providerId, args.model)
    if (problem) throw userError('VALIDATION', problem)
    // The key's live model list: a refused key (4xx) is not saved; a chosen
    // model the provider does not offer is refused. An unreachable provider
    // does not block saving (calls fall back to the default later).
    const adminCompany: Id<'companies'> = await ctx.runQuery(internal.llmGateway.adminCompany, {})
    const baseUrl = args.providerId === 'custom' ? cleanBaseUrl('custom', args.baseUrl) ?? '' : provider.baseUrl
    const live = await liveModels(ctx, { providerId: provider.id, kind: provider.kind, baseUrl, apiKey }, adminCompany)
    if (!live.models && live.status && live.status >= 400 && live.status < 500) {
      throw userError('VALIDATION', `${provider.label} refused the key: ${live.error}`)
    }
    const model = args.model.trim()
    if (model && live.models && !live.models.some((m) => m.id === model) && !extraModels(process.env).includes(model)) {
      throw userError('VALIDATION', `Model "${model}" is not offered for ${provider.label}`)
    }
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
      /** The credential's saved model ('' = automatic). */
      savedModel: string
      /** What the browser asked for, if anything. */
      requestedModel: string | null
      baseUrl: string | null
      ciphertext: string
      iv: string
      /** AI protections (D-023): the call's lease, deadline and open breakers. */
      leaseId: Id<'aiLeases'>
      deadlineAt: number
      attemptMs: number
      blocked: string[]
    }

/**
 * Internal: SEC-004 checks and the org credential for a call. Limits are
 * only spent when the org key will be used; otherwise the Next proxy's own
 * limits apply to the server-key call.
 */
export const begin = internalMutation({
  args: { providerId: v.optional(v.string()), model: v.optional(v.string()) },
  returns: v.union(
    v.object({ handled: v.literal(false) }),
    v.object({
      handled: v.literal(true),
      companyId: v.id('companies'),
      userId: v.id('users'),
      credentialId: v.id('llmCredentials'),
      providerId: v.string(),
      savedModel: v.string(),
      requestedModel: v.union(v.string(), v.null()),
      baseUrl: v.union(v.string(), v.null()),
      ciphertext: v.string(),
      iv: v.string(),
      leaseId: v.id('aiLeases'),
      deadlineAt: v.number(),
      attemptMs: v.number(),
      blocked: v.array(v.string()),
    }),
  ),
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
    // AI protections: budget and concurrency refuse before anything is spent.
    const admitted = await admitCall(ctx, {
      companyId,
      userId: user._id,
      server: false,
      feature: 'gateway',
      providerId: cred.providerId,
      credentialId: cred._id,
    })
    if (!admitted.ok) throw admissionError(admitted)
    // Admin's daily cap per member (AI-POLICY); refuses before anything is spent.
    await spendDailyQuestion(ctx, company, user._id)
    for (const [name, key] of limits) await rateLimiter.limit(ctx, name, { key })
    return {
      leaseId: admitted.leaseId,
      deadlineAt: admitted.deadlineAt,
      attemptMs: admitted.attemptMs,
      blocked: admitted.blocked,
      handled: true,
      companyId,
      userId: user._id,
      credentialId: cred._id,
      providerId: cred.providerId,
      savedModel: cred.model,
      requestedModel: args.model?.trim().slice(0, MAX_MODEL_CHARS) || null,
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
  /** Provider HTTP status of a failure (circuit breaker). */
  status: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  /** USD per million tokens as the provider listed them (OpenRouter), for the estimate. */
  inputPerM: v.optional(v.number()),
  outputPerM: v.optional(v.number()),
}

/** Also used by the farm bot (BOT-002) for its own calls. */
export async function insertUsage(
  ctx: MutationCtx,
  row: {
    companyId: Id<'companies'>
    userId?: Id<'users'>
    source: 'org_key' | 'server_key'
    providerId: string
    model: string
    feature: 'chat' | 'insights' | 'report' | 'bot' | 'ocr'
    ok: boolean
    error?: string
    /** Provider HTTP status of a failure, when known (circuit breaker). */
    status?: number
    inputTokens?: number
    outputTokens?: number
    durationMs?: number
    inputPerM?: number
    outputPerM?: number
    /** A member's session reported this row (Next proxy, server key): not trusted for shared breakers. */
    reportedBy?: Id<'users'>
  },
) {
  const { inputPerM, outputPerM, status, reportedBy, ...fields } = row
  const inputTokens = tokenCount(row.inputTokens)
  const outputTokens = tokenCount(row.outputTokens)
  const model = row.model.slice(0, MAX_MODEL_CHARS)
  const costUsd = estimateCostUsd(row.model, inputTokens, outputTokens, cleanPrice(inputPerM, outputPerM))
  await ctx.db.insert('llmUsage', {
    ...fields,
    model,
    error: row.error?.slice(0, 300),
    inputTokens,
    outputTokens,
    durationMs: tokenCount(row.durationMs),
    costUsd,
    createdAt: Date.now(),
  })
  // AI protections: monthly spend (budgets, warnings) and the model's circuit breaker.
  await afterUsage(ctx, {
    companyId: row.companyId,
    source: row.source,
    providerId: row.providerId,
    model,
    ok: row.ok,
    error: row.error,
    status: typeof status === 'number' ? status : undefined,
    costUsd,
    tokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    reporter: reportedBy,
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
/** Client-reported figures are capped (a member's session can call this directly). */
const MAX_REPORTED_INPUT_TOKENS = 250_000
const MAX_REPORTED_OUTPUT_TOKENS = 64_000
const MAX_REPORTED_PRICE_PER_M = 20

/**
 * The Next proxy reports a call it made on the server key. The member's own
 * session calls this, so it is bound to the caller's live server-key lease
 * from `llmQuota.consumeServerKeyQuota` (at most two rows per lease: the
 * first attempt and an Auto fallback), token counts and prices are capped.
 * The row counts toward the member's own company (budget and its share of the
 * server key) but never moves a breaker or the shared server-key pool (D-023,
 * Q-048).
 */
export const recordServerUsage = mutation({
  args: { ...usageFields, leaseId: v.id('aiLeases') },
  returns: v.null(),
  handler: async (ctx, { leaseId, ...args }) => {
    const { user } = await requireMember(ctx, { permission: 'ai.use' })
    if (!user.companyId) return null
    if (!PROVIDERS[args.providerId]) throw userError('VALIDATION', 'Unknown provider')
    const lease = await ctx.db.get(leaseId)
    if (!lease || lease.userId !== user._id || lease.companyId !== user.companyId || !lease.server || lease.expiresAt < Date.now()) return null
    if ((lease.reports ?? 0) >= 2) return null
    const verdict = await rateLimiter.limit(ctx, 'llmUsageReportPerUser', { key: user._id })
    if (!verdict.ok) return null
    await ctx.db.patch(lease._id, { reports: (lease.reports ?? 0) + 1 })
    const price =
      (args.inputPerM ?? 0) <= MAX_REPORTED_PRICE_PER_M && (args.outputPerM ?? 0) <= MAX_REPORTED_PRICE_PER_M
        ? { inputPerM: args.inputPerM, outputPerM: args.outputPerM }
        : { inputPerM: undefined, outputPerM: undefined }
    await insertUsage(ctx, {
      ...args,
      ...price,
      inputTokens: args.inputTokens === undefined ? undefined : Math.min(args.inputTokens, MAX_REPORTED_INPUT_TOKENS),
      outputTokens: args.outputTokens === undefined ? undefined : Math.min(args.outputTokens, MAX_REPORTED_OUTPUT_TOKENS),
      companyId: user.companyId,
      userId: user._id,
      source: 'server_key',
      reportedBy: user._id,
    })
    return null
  },
})

type ReportLease = { leaseId: Id<'aiLeases'>; deadlineAt: number; attemptMs: number; blocked: string[] }
export type ReportBegin =
  | { mode: 'none'; reason: 'disabled' | 'no_key' | 'rate_limited' | 'busy' | 'budget' }
  | ({
      mode: 'org_key'
      credentialId: Id<'llmCredentials'>
      providerId: string
      model: string
      baseUrl: string | null
      ciphertext: string
      iv: string
    } & ReportLease)
  | ({ mode: 'server_key'; providerId: string; model: string } & ReportLease)

const reportLease = { leaseId: v.id('aiLeases'), deadlineAt: v.number(), attemptMs: v.number(), blocked: v.array(v.string()) }

/**
 * Internal: quota and key for a weekly report (AI-003). Same switches as
 * `begin` (the company's assistant setting, the shared rate limiter; the
 * per-user limits too when a member asked for it) but no session: the cron
 * runs it. `serverProviderId` is a provider whose key is set in the Convex
 * environment (the action checks), used when the organization has none.
 * Quota is only spent when a key will be used.
 */
export const beginReport = internalMutation({
  args: {
    companyId: v.id('companies'),
    userId: v.optional(v.id('users')),
    serverProviderId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      mode: v.literal('none'),
      reason: v.union(v.literal('disabled'), v.literal('no_key'), v.literal('rate_limited'), v.literal('busy'), v.literal('budget')),
    }),
    v.object({
      mode: v.literal('org_key'),
      credentialId: v.id('llmCredentials'),
      providerId: v.string(),
      model: v.string(),
      baseUrl: v.union(v.string(), v.null()),
      ciphertext: v.string(),
      iv: v.string(),
      ...reportLease,
    }),
    v.object({ mode: v.literal('server_key'), providerId: v.string(), model: v.string(), ...reportLease }),
  ),
  handler: async (ctx, { companyId, userId, serverProviderId }): Promise<ReportBegin> => {
    const company = await ctx.db.get(companyId)
    if (company?.settings?.aiAssistantEnabled !== true) return { mode: 'none', reason: 'disabled' }
    const cred = pickCredential(await companyCredentials(ctx, companyId))
    const secret = cred
      ? await ctx.db
          .query('integrationSecrets')
          .withIndex('by_llmCredentialId', (q) => q.eq('llmCredentialId', cred._id))
          .unique()
      : null
    const server = serverProviderId && PROVIDERS[serverProviderId] ? PROVIDERS[serverProviderId] : null
    if (!(cred && secret) && !server) return { mode: 'none', reason: 'no_key' }
    const limits: Array<readonly ['llmPerUserMinute' | 'llmPerUserHour' | 'llmPerCompanyHour', string]> = [
      ['llmPerCompanyHour', companyId],
      ...(userId ? ([['llmPerUserMinute', userId], ['llmPerUserHour', userId]] as const) : []),
    ]
    for (const [name, key] of limits) {
      if (!(await rateLimiter.check(ctx, name, { key })).ok) return { mode: 'none', reason: 'rate_limited' }
    }
    // AI protections (D-023): budget and concurrency, before quota is spent.
    const useOrg = !!(cred && secret)
    const admitted = await admitCall(ctx, {
      companyId,
      userId: userId ?? null,
      server: !useOrg,
      feature: 'report',
      providerId: useOrg ? cred!.providerId : server!.id,
      credentialId: useOrg ? cred!._id : null,
    })
    if (!admitted.ok) return { mode: 'none', reason: admitted.kind }
    for (const [name, key] of limits) await rateLimiter.limit(ctx, name, { key })
    const lease = { leaseId: admitted.leaseId, deadlineAt: admitted.deadlineAt, attemptMs: admitted.attemptMs, blocked: admitted.blocked }
    if (cred && secret) {
      return {
        ...lease,
        mode: 'org_key',
        credentialId: cred._id,
        providerId: cred.providerId,
        model: cred.model,
        baseUrl: cred.baseUrl ?? null,
        ciphertext: secret.ciphertext,
        iv: secret.iv,
      }
    }
    // Model resolved by the action from the live list (D-022).
    return { ...lease, mode: 'server_key', providerId: server!.id, model: '' }
  },
})

/** Internal: log a report call (no user for scheduled runs). */
export const recordReportUsage = internalMutation({
  args: {
    companyId: v.id('companies'),
    userId: v.optional(v.id('users')),
    source: v.union(v.literal('org_key'), v.literal('server_key')),
    providerId: v.string(),
    model: v.string(),
    ok: v.boolean(),
    error: v.optional(v.string()),
    status: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    inputPerM: v.optional(v.number()),
    outputPerM: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await insertUsage(ctx, { ...args, feature: 'report' })
    return null
  },
})

export type GatewayReply =
  | { handled: false }
  | {
      handled: true
      text: string
      providerId: string
      /** The model actually used. */
      model: string
      /** The requested model was unavailable and `model` replaced it. */
      fallback: boolean
      requestedModel: string | null
      inputTokens: number | null
      outputTokens: number | null
    }

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
  returns: v.union(
    v.object({ handled: v.literal(false) }),
    v.object({
      handled: v.literal(true),
      text: v.string(),
      providerId: v.string(),
      model: v.string(),
      fallback: v.boolean(),
      requestedModel: v.union(v.string(), v.null()),
      inputTokens: v.union(v.number(), v.null()),
      outputTokens: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args): Promise<GatewayReply> => {
    const problem = messagesProblem(args.messages)
    if (problem) throw userError('VALIDATION', problem)
    const begun: BeginResult = await ctx.runMutation(internal.llmGateway.begin, {
      providerId: args.providerId,
      model: args.model,
    })
    if (!begun.handled) return { handled: false }
    try {
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
      // Only a model in the key's live list (or LLM_EXTRA_MODELS / env default) is called.
      const picker = modelPicker(ctx, {
        sources: [
          {
            providerId: provider.id,
            kind: provider.kind,
            listBaseUrl: providerBaseUrl(provider.id, provider.id === 'custom' ? begun.baseUrl ?? '' : null),
            // Only the admin's saved URL for custom; fixed endpoints otherwise.
            callBaseUrl: provider.id === 'custom' ? begun.baseUrl ?? '' : provider.baseUrl,
            apiKey,
            scope: begun.companyId,
            source: 'org_key',
          },
        ],
        requested: begun.requestedModel,
        saved: begun.savedModel,
        blocked: new Set(begun.blocked),
        explicit: !!begun.requestedModel,
      })
      const result = await runGuarded({
        now: Date.now,
        deadlineAt: begun.deadlineAt,
        attemptMs: begun.attemptMs,
        explicit: !!begun.requestedModel,
        blocked: new Set(begun.blocked),
        first: picker.first,
        next: picker.next,
        attempt: chatAttempt({ messages: args.messages, temperature, referer: args.referer }),
        record: async (t: KeyTarget, o) => {
          await ctx.runMutation(internal.llmGateway.recordUsage, {
            companyId: begun.companyId,
            userId: begun.userId,
            providerId: t.providerId,
            model: t.model,
            feature: args.feature,
            ok: o.ok,
            error: o.ok ? undefined : o.message,
            status: statusOf(o.status),
            inputTokens: o.value?.usage.inputTokens,
            outputTokens: o.value?.usage.outputTokens,
            durationMs: o.durationMs,
            ...(t.price ?? {}),
          })
        },
      })
      if (!result.ok) {
        // Raw provider text stays in the log; members get the kind's message (llmErrors).
        console.warn(`[llm gateway] ${begun.providerId}/${result.target?.model ?? '-'}: ${result.message}`)
        if (result.kind === 'not_configured') throw upstreamError(picker.lastError() ?? result.message)
        throw userError('UPSTREAM', LLM_FAILURE_TEXT[result.kind], {
          kind: result.kind,
          status: result.status,
          retryAfterSec: result.retryAfterSec,
        })
      }
      const model = result.target.model
      return {
        handled: true,
        text: result.value.text,
        providerId: result.target.providerId,
        model,
        fallback: result.fallback || (!!begun.requestedModel && model !== begun.requestedModel),
        requestedModel: begun.requestedModel,
        inputTokens: result.value.usage.inputTokens ?? null,
        outputTokens: result.value.usage.outputTokens ?? null,
      }
    } finally {
      await releaseLease(ctx, begun.leaseId)
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

