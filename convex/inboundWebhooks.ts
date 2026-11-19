import { v } from 'convex/values'
import { paginationResultValidator, paginationOptsValidator } from 'convex/server'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { logAudit } from './lib/tenancy'
import { insertAuditLog } from './lib/auditChain'
import { emitDomainEvent } from './lib/events'
import { rateLimiter } from './lib/rateLimits'
import { requireMember } from './lib/permissions'
import { MISSING_KEY_MESSAGE, encryptJson, encryptionConfigured, readEncryptionKey, secretHint } from './lib/crypto'
import { randomBase62 } from './integrations/apiScopes'
import {
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  MAX_INBOUND_PER_COMPANY,
  MAX_STORED_PAYLOAD,
  PUBLIC_ID_RE,
  SIGNATURE_HEADER,
  TOLERANCE_SEC,
  inboundAad,
} from './integrations/inboundLogic'

/**
 * Inbound signed webhooks (INT-003, doc 09 §7).
 *
 * - Admins (integrations.manage) create an inbound webhook: a public URL
 *   `/webhooks/in/<publicId>` and a signing secret `whsec_…` shown once,
 *   AES-GCM encrypted in integrationSecrets (same model as INT-005).
 * - The httpAction (integrations/inboundHttp.ts) reads the ciphertext with
 *   `internal.inboundWebhooks.lookup`, decrypts and verifies the signature
 *   in the action, then calls `record`, which stores the event once per
 *   (webhook, event id), emits `inbound.webhook.received` for automation
 *   rules and outbound webhooks, and writes the audit log.
 * - Rejected requests are logged (rate limited) so admins can see them.
 */

const MAX_NAME = 80
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

type Ctx = QueryCtx | MutationCtx

async function requireInboundAdmin(ctx: Ctx) {
  const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  return { user, companyId: user.companyId }
}

async function loadOwn(ctx: Ctx, companyId: Id<'companies'>, webhookId: Id<'inboundWebhooks'>) {
  const row = await ctx.db.get(webhookId)
  if (!row || row.companyId !== companyId) throw new Error('Inbound webhook not found')
  return row
}

function cleanName(name: string) {
  const n = name.trim()
  if (!n) throw new Error('Name the webhook')
  if (n.length > MAX_NAME) throw new Error('Name is too long')
  return n
}

function toClient(row: Doc<'inboundWebhooks'>) {
  return {
    id: row._id,
    name: row.name,
    publicId: row.publicId,
    path: `/webhooks/in/${row.publicId}`,
    status: row.status,
    secretHint: row.secretHint ?? null,
    lastReceivedAt: row.lastReceivedAt ?? null,
    createdAt: row.createdAt,
  }
}

function eventToClient(row: Doc<'inboundWebhookEvents'>) {
  return {
    id: row._id,
    externalId: row.externalId ?? null,
    eventType: row.eventType ?? null,
    status: row.status,
    reason: row.reason ?? null,
    payloadBytes: row.payloadBytes,
    payloadPreview: row.payload ? row.payload.slice(0, 500) : null,
    duplicates: row.duplicates ?? 0,
    lastDuplicateAt: row.lastDuplicateAt ?? null,
    receivedAt: row.receivedAt,
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const overview = query({
  args: {},
  returns: v.object({
    encryptionReady: v.boolean(),
    webhooks: v.array(
      v.object({
        id: v.id('inboundWebhooks'),
        name: v.string(),
        publicId: v.string(),
        path: v.string(),
        status: v.union(v.literal('active'), v.literal('disabled')),
        secretHint: v.union(v.string(), v.null()),
        lastReceivedAt: v.union(v.number(), v.null()),
        createdAt: v.number(),
      }),
    ),
    signing: v.object({
      signatureHeader: v.string(),
      eventIdHeader: v.string(),
      eventTypeHeader: v.string(),
      toleranceSec: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const { companyId } = await requireInboundAdmin(ctx)
    const rows = await ctx.db
      .query('inboundWebhooks')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(MAX_INBOUND_PER_COMPANY + 5)
    return {
      encryptionReady: encryptionConfigured(),
      webhooks: rows.map(toClient),
      signing: {
        signatureHeader: SIGNATURE_HEADER,
        eventIdHeader: EVENT_ID_HEADER,
        eventTypeHeader: EVENT_TYPE_HEADER,
        toleranceSec: TOLERANCE_SEC,
      },
    }
  },
})

/** Delivery log for one inbound webhook, newest first. */
export const events = query({
  args: { webhookId: v.id('inboundWebhooks'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      id: v.id('inboundWebhookEvents'),
      externalId: v.union(v.string(), v.null()),
      eventType: v.union(v.string(), v.null()),
      status: v.union(v.literal('accepted'), v.literal('rejected')),
      reason: v.union(v.string(), v.null()),
      payloadBytes: v.number(),
      payloadPreview: v.union(v.string(), v.null()),
      duplicates: v.number(),
      lastDuplicateAt: v.union(v.number(), v.null()),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx, { webhookId, paginationOpts }) => {
    const { companyId } = await requireInboundAdmin(ctx)
    await loadOwn(ctx, companyId, webhookId)
    const res = await ctx.db
      .query('inboundWebhookEvents')
      .withIndex('by_webhookId_and_receivedAt', (q) => q.eq('webhookId', webhookId))
      .order('desc')
      .paginate(paginationOpts)
    return { ...res, page: res.page.map(eventToClient) }
  },
})

/** Internal: create the row, disabled until its secret is stored. */
export const createRow = internalMutation({
  args: { name: v.string() },
  returns: v.object({ id: v.id('inboundWebhooks'), companyId: v.id('companies') }),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireInboundAdmin(ctx)
    const name = cleanName(args.name)
    const existing = await ctx.db
      .query('inboundWebhooks')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(MAX_INBOUND_PER_COMPANY + 1)
    if (existing.length >= MAX_INBOUND_PER_COMPANY) {
      throw new Error(`A company can have at most ${MAX_INBOUND_PER_COMPANY} inbound webhooks`)
    }
    const now = Date.now()
    const id = await ctx.db.insert('inboundWebhooks', {
      companyId,
      name,
      publicId: `inw_${randomBase62(24)}`,
      status: 'disabled',
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })
    await logAudit(ctx, { actionType: 'inbound_webhook_create', tableName: 'inboundWebhooks', recordId: id, newValues: { name } })
    return { id, companyId }
  },
})

/** Internal: store (or replace) the encrypted secret; activates a new webhook. */
export const storeSecret = internalMutation({
  args: {
    webhookId: v.id('inboundWebhooks'),
    ciphertext: v.string(),
    iv: v.string(),
    keyVersion: v.number(),
    hint: v.string(),
    activate: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireInboundAdmin(ctx)
    const row = await loadOwn(ctx, companyId, args.webhookId)
    const now = Date.now()
    const existing = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_inboundWebhookId', (q) => q.eq('inboundWebhookId', args.webhookId))
      .unique()
    const secretRow = {
      companyId,
      inboundWebhookId: args.webhookId,
      ciphertext: args.ciphertext,
      iv: args.iv,
      keyVersion: args.keyVersion,
      updatedAt: now,
    }
    if (existing) await ctx.db.replace(existing._id, secretRow)
    else await ctx.db.insert('integrationSecrets', secretRow)
    await ctx.db.patch(args.webhookId, {
      secretHint: args.hint,
      updatedAt: now,
      ...(args.activate ? { status: 'active' as const } : {}),
    })
    await logAudit(ctx, {
      actionType: existing ? 'inbound_webhook_secret_rotate' : 'inbound_webhook_secret_set',
      tableName: 'inboundWebhooks',
      recordId: args.webhookId,
      newValues: { name: row.name, keyVersion: args.keyVersion },
    })
    return null
  },
})

/** Internal: owner check for an action. */
export const owner = internalQuery({
  args: { webhookId: v.id('inboundWebhooks') },
  returns: v.object({ companyId: v.id('companies') }),
  handler: async (ctx, { webhookId }) => {
    const { companyId } = await requireInboundAdmin(ctx)
    await loadOwn(ctx, companyId, webhookId)
    return { companyId }
  },
})

async function sealSecret(companyId: string, webhookId: string) {
  const key = readEncryptionKey()
  if (!key) throw new Error(MISSING_KEY_MESSAGE)
  const secret = `whsec_${randomBase62(32)}`
  const sealed = await encryptJson({ secret }, inboundAad(companyId, webhookId), key)
  return { secret, sealed, hint: secretHint(secret) ?? '…' }
}

/** Create an inbound webhook. The secret is in the result only: shown once. */
export const create = action({
  args: { name: v.string() },
  returns: v.object({ id: v.id('inboundWebhooks'), secret: v.string() }),
  handler: async (ctx, args): Promise<{ id: Id<'inboundWebhooks'>; secret: string }> => {
    if (!readEncryptionKey()) throw new Error(MISSING_KEY_MESSAGE)
    const { id, companyId }: { id: Id<'inboundWebhooks'>; companyId: Id<'companies'> } = await ctx.runMutation(
      internal.inboundWebhooks.createRow,
      args,
    )
    const { secret, sealed, hint } = await sealSecret(companyId, id)
    await ctx.runMutation(internal.inboundWebhooks.storeSecret, { webhookId: id, ...sealed, hint, activate: true })
    return { id, secret }
  },
})

/** Replace the secret; requests signed with the old one fail at once. */
export const rotateSecret = action({
  args: { webhookId: v.id('inboundWebhooks') },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, { webhookId }): Promise<{ secret: string }> => {
    const { companyId }: { companyId: Id<'companies'> } = await ctx.runQuery(internal.inboundWebhooks.owner, { webhookId })
    const { secret, sealed, hint } = await sealSecret(companyId, webhookId)
    await ctx.runMutation(internal.inboundWebhooks.storeSecret, { webhookId, ...sealed, hint, activate: false })
    return { secret }
  },
})

export const update = mutation({
  args: { webhookId: v.id('inboundWebhooks'), name: v.optional(v.string()), enabled: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireInboundAdmin(ctx)
    const row = await loadOwn(ctx, companyId, args.webhookId)
    const patch: Partial<Doc<'inboundWebhooks'>> = { updatedAt: Date.now() }
    if (args.name !== undefined) patch.name = cleanName(args.name)
    if (args.enabled === true) {
      if (!row.secretHint) throw new Error('This webhook has no secret yet. Rotate the secret first.')
      patch.status = 'active'
    } else if (args.enabled === false) patch.status = 'disabled'
    await ctx.db.patch(args.webhookId, patch)
    await logAudit(ctx, {
      actionType: 'inbound_webhook_update',
      tableName: 'inboundWebhooks',
      recordId: args.webhookId,
      previousValues: { name: row.name, status: row.status },
      newValues: { name: patch.name, status: patch.status },
    })
    return null
  },
})

/** Delete a webhook and its secret; its event log goes with retention. */
export const remove = mutation({
  args: { webhookId: v.id('inboundWebhooks') },
  returns: v.null(),
  handler: async (ctx, { webhookId }) => {
    const { companyId } = await requireInboundAdmin(ctx)
    const row = await loadOwn(ctx, companyId, webhookId)
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_inboundWebhookId', (q) => q.eq('inboundWebhookId', webhookId))
      .unique()
    if (secret) await ctx.db.delete(secret._id)
    await ctx.db.delete(webhookId)
    await logAudit(ctx, {
      actionType: 'inbound_webhook_remove',
      tableName: 'inboundWebhooks',
      recordId: webhookId,
      previousValues: { name: row.name },
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Receiving (called by the httpAction; no user)
// ---------------------------------------------------------------------------

export type InboundLookup =
  | { found: false }
  | {
      found: true
      webhookId: Id<'inboundWebhooks'>
      companyId: Id<'companies'>
      active: boolean
      ciphertext: string | null
      iv: string | null
      keyVersion: number | null
    }

/** The webhook and its encrypted secret by public id. Decrypted only in the httpAction. */
export const lookup = internalQuery({
  args: { publicId: v.string() },
  returns: v.union(
    v.object({ found: v.literal(false) }),
    v.object({
      found: v.literal(true),
      webhookId: v.id('inboundWebhooks'),
      companyId: v.id('companies'),
      active: v.boolean(),
      ciphertext: v.union(v.string(), v.null()),
      iv: v.union(v.string(), v.null()),
      keyVersion: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { publicId }): Promise<InboundLookup> => {
    if (!PUBLIC_ID_RE.test(publicId)) return { found: false }
    const row = await ctx.db
      .query('inboundWebhooks')
      .withIndex('by_publicId', (q) => q.eq('publicId', publicId))
      .unique()
    if (!row) return { found: false }
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_inboundWebhookId', (q) => q.eq('inboundWebhookId', row._id))
      .unique()
    return {
      found: true,
      webhookId: row._id,
      companyId: row.companyId,
      active: row.status === 'active',
      ciphertext: secret?.ciphertext ?? null,
      iv: secret?.iv ?? null,
      keyVersion: secret?.keyVersion ?? null,
    }
  },
})

/** Per-webhook request limit, checked before the body is verified. */
export const admit = internalMutation({
  args: { webhookId: v.id('inboundWebhooks') },
  returns: v.object({ ok: v.boolean(), retryAfterMs: v.optional(v.number()) }),
  handler: async (ctx, { webhookId }) => {
    const res = await rateLimiter.limit(ctx, 'inboundPerWebhook', { key: webhookId })
    return res.ok ? { ok: true } : { ok: false, retryAfterMs: res.retryAfter }
  },
})

/** Log a rejected request (rate limited: a flood of bad requests writes a bounded number of rows). */
export const logRejected = internalMutation({
  args: {
    webhookId: v.id('inboundWebhooks'),
    reason: v.string(),
    payloadBytes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hook = await ctx.db.get(args.webhookId)
    if (!hook) return null
    const res = await rateLimiter.limit(ctx, 'inboundRejectLogPerWebhook', { key: args.webhookId })
    if (!res.ok) return null
    await ctx.db.insert('inboundWebhookEvents', {
      companyId: hook.companyId,
      webhookId: hook._id,
      status: 'rejected',
      reason: args.reason.slice(0, 200),
      payloadBytes: args.payloadBytes,
      receivedAt: Date.now(),
    })
    return null
  },
})

export type RecordResult = { status: 'accepted' | 'duplicate' | 'disabled'; eventId?: Id<'inboundWebhookEvents'> }

/**
 * Store a verified event once. A repeat of (webhook, event id) returns
 * `duplicate` and changes nothing but the counter: idempotent for senders
 * that retry.
 */
export const record = internalMutation({
  args: {
    webhookId: v.id('inboundWebhooks'),
    externalId: v.string(),
    eventType: v.optional(v.string()),
    payload: v.string(),
    payloadBytes: v.number(),
    signedAt: v.number(),
  },
  returns: v.object({
    status: v.union(v.literal('disabled'), v.literal('accepted'), v.literal('duplicate')),
    eventId: v.optional(v.id('inboundWebhookEvents')),
  }),
  handler: async (ctx, args): Promise<RecordResult> => {
    const hook = await ctx.db.get(args.webhookId)
    if (!hook || hook.status !== 'active') return { status: 'disabled' }
    const now = Date.now()
    // Only accepted rows carry an externalId (unverified ids are never logged).
    const seen = await ctx.db
      .query('inboundWebhookEvents')
      .withIndex('by_webhookId_and_externalId', (q) => q.eq('webhookId', args.webhookId).eq('externalId', args.externalId))
      .first()
    if (seen) {
      await ctx.db.patch(seen._id, { duplicates: (seen.duplicates ?? 0) + 1, lastDuplicateAt: now })
      return { status: 'duplicate', eventId: seen._id }
    }
    const eventId = await ctx.db.insert('inboundWebhookEvents', {
      companyId: hook.companyId,
      webhookId: hook._id,
      externalId: args.externalId,
      eventType: args.eventType,
      status: 'accepted',
      payload: args.payload.length <= MAX_STORED_PAYLOAD ? args.payload : undefined,
      payloadBytes: args.payloadBytes,
      signedAt: args.signedAt,
      receivedAt: now,
    })
    const domainEventId = await emitDomainEvent(
      ctx,
      'inbound.webhook.received',
      {
        webhookName: hook.name,
        webhookId: hook._id,
        eventType: args.eventType ?? '',
        externalId: args.externalId,
        inboundEventId: eventId,
      },
      { companyId: hook.companyId },
    )
    if (domainEventId) await ctx.db.patch(eventId, { domainEventId })
    await ctx.db.patch(hook._id, { lastReceivedAt: now })
    await insertAuditLog(ctx, {
      companyId: hook.companyId,
      actionType: 'inbound_webhook_received',
      tableName: 'inboundWebhookEvents',
      recordId: eventId,
      newValues: { webhook: hook.name, externalId: args.externalId, eventType: args.eventType, bytes: args.payloadBytes },
    })
    return { status: 'accepted', eventId }
  },
})

/** Event log retention: 30 days. */
export const pruneEvents = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query('inboundWebhookEvents')
      .withIndex('by_receivedAt', (q) => q.lt('receivedAt', Date.now() - RETENTION_MS))
      .take(500)
    for (const row of old) await ctx.db.delete(row._id)
    return old.length
  },
})
