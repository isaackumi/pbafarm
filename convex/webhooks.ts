import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import * as Effect from 'effect/Effect'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { logAudit } from './lib/tenancy'
import {
  MISSING_KEY_MESSAGE,
  decryptJson,
  encryptJson,
  encryptionConfigured,
  readEncryptionKey,
  secretHint,
} from './lib/crypto'
import { EVENT_TYPES } from './automation/templates'
import { rateLimiter, retryAfterText } from './lib/rateLimits'
import { runEffect } from './lib/effect'
import { FetchLive, requestJson, type HttpTransportError } from './lib/effectHttp'
import { randomBase62 } from './integrations/apiScopes'
import {
  DELIVERY_TIMEOUT_MS,
  DISABLE_AFTER_FAILURES,
  MAX_ATTEMPTS,
  MAX_ENDPOINTS_PER_COMPANY,
  MAX_EVENT_TYPES,
  SIGNATURE_HEADER,
  endpointAad,
  nextRetryDelay,
  signatureHeader,
  webhookUrlProblem,
} from './integrations/webhookLogic'
import { requireMember } from './lib/permissions'

/**
 * Outbound webhooks (INT-005, doc 09 §7).
 *
 * - Endpoints per company (admins). The signing secret `whsec_…` is created
 *   in an action, shown once, AES-GCM encrypted in integrationSecrets.
 * - `fanOut` consumes `domainEvents`: `emitDomainEvent` schedules it when an
 *   active endpoint subscribes to the type. One `webhookDeliveries` row per
 *   subscribed endpoint, then `deliver`; the event's `processedBy` gets
 *   'webhooks'.
 * - `deliver` (action) signs and POSTs with effectHttp (10 s timeout, two
 *   quick retries on network/5xx), records the attempt, and schedules the
 *   next attempt with backoff (webhookLogic.RETRY_DELAYS_MS) until
 *   MAX_ATTEMPTS. 20 failed attempts in a row disable the endpoint and notify
 *   the company's admins.
 */

const TEST_EVENT_TYPE = 'webhook.test'
const MAX_DESCRIPTION = 200

type Ctx = QueryCtx | MutationCtx

async function requireWebhookAdmin(ctx: Ctx) {
  const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  return { user, companyId: user.companyId }
}

async function loadOwnEndpoint(ctx: Ctx, companyId: Id<'companies'>, endpointId: Id<'webhookEndpoints'>) {
  const row = await ctx.db.get(endpointId)
  if (!row || row.companyId !== companyId) throw new Error('Webhook endpoint not found')
  return row
}

/** Event types an endpoint can subscribe to: the shared catalog (AUTO-001). */
export function webhookEventCatalog() {
  return EVENT_TYPES.map((e) => ({ id: e.type, label: e.label }))
}

function isKnownEventType(type: string) {
  return EVENT_TYPES.some((e) => e.type === type)
}

/** The JSON body sent for a domain event. Receivers dedupe by `id`. */
export function eventEnvelope(event: Doc<'domainEvents'>) {
  return {
    id: event._id,
    type: event.type,
    occurredAt: new Date(event.createdAt).toISOString(),
    companyId: event.companyId,
    siteId: event.locationId ?? null,
    data: event.payload,
  }
}

function cleanEventTypes(types: string[]): string[] {
  const out = [...new Set(types)]
  if (!out.length) throw new Error('Choose at least one event')
  if (out.length > MAX_EVENT_TYPES) throw new Error('Too many events')
  for (const t of out) if (!isKnownEventType(t)) throw new Error(`Unknown event "${t}"`)
  return out
}

function cleanUrl(url: string): string {
  const problem = webhookUrlProblem(url)
  if (problem) throw new Error(problem)
  return new URL(url.trim()).toString()
}

function endpointToClient(row: Doc<'webhookEndpoints'>) {
  return {
    id: row._id,
    url: row.url,
    description: row.description ?? '',
    eventTypes: row.eventTypes,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    disabledReason: row.disabledReason ?? null,
    secretHint: row.secretHint ?? null,
    lastSuccessAt: row.lastSuccessAt ?? null,
    lastFailureAt: row.lastFailureAt ?? null,
    createdAt: row.createdAt,
  }
}

function deliveryToClient(row: Doc<'webhookDeliveries'>) {
  return {
    id: row._id,
    eventId: row.eventId ?? null,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus ?? null,
    lastError: row.lastError ?? null,
    durationMs: row.durationMs ?? null,
    lastAttemptAt: row.lastAttemptAt ?? null,
    nextAttemptAt: row.nextAttemptAt ?? null,
    redelivery: !!row.redeliveryOf,
    createdAt: row.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Admin: endpoints
// ---------------------------------------------------------------------------

/** Webhooks page: endpoints and the event catalog. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const rows = await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(MAX_ENDPOINTS_PER_COMPANY + 5)
    return {
      encryptionReady: encryptionConfigured(),
      endpoints: rows.map(endpointToClient),
      events: webhookEventCatalog(),
    }
  },
})

/** Delivery log for one endpoint, newest first. */
export const deliveries = query({
  args: { endpointId: v.id('webhookEndpoints'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { endpointId, paginationOpts }) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    await loadOwnEndpoint(ctx, companyId, endpointId)
    const res = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_endpointId_and_createdAt', (q) => q.eq('endpointId', endpointId))
      .order('desc')
      .paginate(paginationOpts)
    return { ...res, page: res.page.map(deliveryToClient) }
  },
})

/** Internal: validate and store an endpoint with its encrypted secret. */
export const insertEndpoint = internalMutation({
  args: {
    url: v.string(),
    description: v.optional(v.string()),
    eventTypes: v.array(v.string()),
    endpointId: v.id('webhookEndpoints'),
    ciphertext: v.string(),
    iv: v.string(),
    keyVersion: v.number(),
    hint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const row = await loadOwnEndpoint(ctx, companyId, args.endpointId)
    const now = Date.now()
    const existing = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_webhookEndpointId', (q) => q.eq('webhookEndpointId', args.endpointId))
      .unique()
    const secretRow = {
      companyId,
      webhookEndpointId: args.endpointId,
      ciphertext: args.ciphertext,
      iv: args.iv,
      keyVersion: args.keyVersion,
      updatedAt: now,
    }
    if (existing) await ctx.db.replace(existing._id, secretRow)
    else await ctx.db.insert('integrationSecrets', secretRow)
    await ctx.db.patch(args.endpointId, { secretHint: args.hint, updatedAt: now })
    await logAudit(ctx, {
      actionType: existing ? 'webhook_secret_rotate' : 'webhook_secret_set',
      tableName: 'webhookEndpoints',
      recordId: args.endpointId,
      newValues: { url: row.url, keyVersion: args.keyVersion },
    })
    return null
  },
})

/** Internal: create the endpoint row (secret stored right after by the action). */
export const createEndpointRow = internalMutation({
  args: { url: v.string(), description: v.optional(v.string()), eventTypes: v.array(v.string()) },
  returns: v.object({ id: v.id('webhookEndpoints'), companyId: v.id('companies') }),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireWebhookAdmin(ctx)
    const url = cleanUrl(args.url)
    const eventTypes = cleanEventTypes(args.eventTypes)
    const description = args.description?.trim() || undefined
    if (description && description.length > MAX_DESCRIPTION) throw new Error('Description is too long')
    const existing = await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(MAX_ENDPOINTS_PER_COMPANY + 1)
    if (existing.length >= MAX_ENDPOINTS_PER_COMPANY) {
      throw new Error(`A company can have at most ${MAX_ENDPOINTS_PER_COMPANY} webhook endpoints`)
    }
    const now = Date.now()
    // Disabled until its secret is stored, so nothing is sent unsigned.
    const id = await ctx.db.insert('webhookEndpoints', {
      companyId,
      url,
      description,
      eventTypes,
      status: 'disabled',
      disabledReason: 'Setting up',
      consecutiveFailures: 0,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'webhook_create',
      tableName: 'webhookEndpoints',
      recordId: id,
      newValues: { url, eventTypes },
    })
    return { id, companyId }
  },
})

/** Internal: turn a newly created endpoint on once its secret is stored. */
export const activateNew = internalMutation({
  args: { endpointId: v.id('webhookEndpoints') },
  returns: v.null(),
  handler: async (ctx, { endpointId }) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const row = await loadOwnEndpoint(ctx, companyId, endpointId)
    if (row.disabledReason === 'Setting up') {
      await ctx.db.patch(endpointId, { status: 'active', disabledReason: undefined, updatedAt: Date.now() })
    }
    return null
  },
})

async function sealSecret(companyId: string, endpointId: string) {
  const key = readEncryptionKey()
  if (!key) throw new Error(MISSING_KEY_MESSAGE)
  const secret = `whsec_${randomBase62(32)}`
  const sealed = await encryptJson({ secret }, endpointAad(companyId, endpointId), key)
  return { secret, sealed, hint: secretHint(secret) }
}

/** Add an endpoint. The signing secret is in the result only: shown once. */
export const create = action({
  args: {
    url: v.string(),
    description: v.optional(v.string()),
    eventTypes: v.array(v.string()),
  },
  returns: v.object({ id: v.id('webhookEndpoints'), secret: v.string() }),
  handler: async (ctx, args): Promise<{ id: Id<'webhookEndpoints'>; secret: string }> => {
    if (!readEncryptionKey()) throw new Error(MISSING_KEY_MESSAGE)
    const { id, companyId }: { id: Id<'webhookEndpoints'>; companyId: Id<'companies'> } =
      await ctx.runMutation(internal.webhooks.createEndpointRow, args)
    const { secret, sealed, hint } = await sealSecret(companyId, id)
    await ctx.runMutation(internal.webhooks.insertEndpoint, {
      url: args.url,
      eventTypes: args.eventTypes,
      endpointId: id,
      ...sealed,
      hint,
    })
    await ctx.runMutation(internal.webhooks.activateNew, { endpointId: id })
    return { id, secret }
  },
})

/** Internal: owner check for an action on an endpoint. */
export const endpointOwner = internalQuery({
  args: { endpointId: v.id('webhookEndpoints') },
  returns: v.object({ companyId: v.id('companies'), url: v.string(), eventTypes: v.array(v.string()) }),
  handler: async (ctx, { endpointId }) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const row = await loadOwnEndpoint(ctx, companyId, endpointId)
    return { companyId, url: row.url, eventTypes: row.eventTypes }
  },
})

/** Replace the signing secret; the old one stops working at once. */
export const rotateSecret = action({
  args: { endpointId: v.id('webhookEndpoints') },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, { endpointId }): Promise<{ secret: string }> => {
    const owner: { companyId: Id<'companies'>; url: string; eventTypes: string[] } =
      await ctx.runQuery(internal.webhooks.endpointOwner, { endpointId })
    const { secret, sealed, hint } = await sealSecret(owner.companyId, endpointId)
    await ctx.runMutation(internal.webhooks.insertEndpoint, {
      url: owner.url,
      eventTypes: owner.eventTypes,
      endpointId,
      ...sealed,
      hint,
    })
    return { secret }
  },
})

/** Change URL, events, description, or turn an endpoint on/off. */
export const update = mutation({
  args: {
    endpointId: v.id('webhookEndpoints'),
    url: v.optional(v.string()),
    description: v.optional(v.string()),
    eventTypes: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const row = await loadOwnEndpoint(ctx, companyId, args.endpointId)
    const patch: Partial<Doc<'webhookEndpoints'>> = { updatedAt: Date.now() }
    if (args.url !== undefined) patch.url = cleanUrl(args.url)
    if (args.eventTypes !== undefined) patch.eventTypes = cleanEventTypes(args.eventTypes)
    if (args.description !== undefined) {
      const d = args.description.trim()
      if (d.length > MAX_DESCRIPTION) throw new Error('Description is too long')
      patch.description = d || undefined
    }
    if (args.enabled === true) {
      if (!row.secretHint) throw new Error('This endpoint has no signing secret yet. Rotate the secret first.')
      Object.assign(patch, { status: 'active', disabledReason: undefined, consecutiveFailures: 0 })
    } else if (args.enabled === false) {
      Object.assign(patch, { status: 'disabled', disabledReason: 'Turned off by an admin' })
    }
    await ctx.db.patch(args.endpointId, patch)
    await logAudit(ctx, {
      actionType: 'webhook_update',
      tableName: 'webhookEndpoints',
      recordId: args.endpointId,
      previousValues: { url: row.url, eventTypes: row.eventTypes, status: row.status },
      newValues: { url: patch.url, eventTypes: patch.eventTypes, status: patch.status },
    })
    return null
  },
})

/** Delete an endpoint and its secret. Its delivery log is removed by retention. */
export const remove = mutation({
  args: { endpointId: v.id('webhookEndpoints') },
  returns: v.null(),
  handler: async (ctx, { endpointId }) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const row = await loadOwnEndpoint(ctx, companyId, endpointId)
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_webhookEndpointId', (q) => q.eq('webhookEndpointId', endpointId))
      .unique()
    if (secret) await ctx.db.delete(secret._id)
    await ctx.db.delete(endpointId)
    await logAudit(ctx, {
      actionType: 'webhook_remove',
      tableName: 'webhookEndpoints',
      recordId: endpointId,
      previousValues: { url: row.url, eventTypes: row.eventTypes },
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

async function queueDelivery(
  ctx: MutationCtx,
  row: {
    companyId: Id<'companies'>
    endpointId: Id<'webhookEndpoints'>
    eventId?: Id<'domainEvents'>
    eventType: string
    payload: string
    redeliveryOf?: Id<'webhookDeliveries'>
  },
) {
  const now = Date.now()
  const id = await ctx.db.insert('webhookDeliveries', {
    ...row,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId: id })
  return id
}

/**
 * Domain-event consumer: one delivery per active endpoint subscribed to the
 * event's type. Idempotent: an existing (event, endpoint) delivery is kept.
 */
export const fanOut = internalMutation({
  args: { eventId: v.id('domainEvents') },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId)
    if (!event) return null
    const endpoints = await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_companyId_and_status', (q) => q.eq('companyId', event.companyId).eq('status', 'active'))
      .take(MAX_ENDPOINTS_PER_COMPANY + 5)
    const payload = JSON.stringify(eventEnvelope(event))
    const processedBy = event.processedBy ?? []
    if (!processedBy.includes('webhooks')) {
      await ctx.db.patch(eventId, { processedBy: [...processedBy, 'webhooks'] })
    }
    for (const endpoint of endpoints) {
      if (!endpoint.eventTypes.includes(event.type)) continue
      const existing = await ctx.db
        .query('webhookDeliveries')
        .withIndex('by_eventId_and_endpointId', (q) => q.eq('eventId', eventId).eq('endpointId', endpoint._id))
        .first()
      if (existing) continue
      await queueDelivery(ctx, {
        companyId: event.companyId,
        endpointId: endpoint._id,
        eventId,
        eventType: event.type,
        payload,
      })
    }
    return null
  },
})

/**
 * Automation "call webhook" action (AUTO-002 + INT-005): queue one delivery
 * of the triggering event (or, for schedule rules, the check result) to an
 * endpoint of the rule's company. Returns false when the endpoint is gone,
 * off, or another company's.
 */
export async function queueRuleWebhook(
  ctx: MutationCtx,
  a: {
    companyId: Id<'companies'>
    endpointId: Id<'webhookEndpoints'>
    rule: { id: Id<'automationRules'>; name: string }
    runId: Id<'automationRuns'>
    eventId?: Id<'domainEvents'>
    check?: unknown
  },
): Promise<boolean> {
  const endpoint = await ctx.db.get(a.endpointId)
  if (!endpoint || endpoint.companyId !== a.companyId || endpoint.status !== 'active') return false
  const event = a.eventId ? await ctx.db.get(a.eventId) : null
  const rule = { id: a.rule.id, name: a.rule.name, runId: a.runId }
  const now = Date.now()
  const body = event
    ? { ...eventEnvelope(event), rule }
    : {
        id: a.runId,
        type: 'automation.rule',
        occurredAt: new Date(now).toISOString(),
        companyId: a.companyId,
        siteId: null,
        data: { check: a.check ?? null },
        rule,
      }
  await queueDelivery(ctx, {
    companyId: a.companyId,
    endpointId: a.endpointId,
    eventId: event?._id,
    eventType: body.type,
    payload: JSON.stringify(body),
  })
  return true
}

/** Send a `webhook.test` ping to an endpoint now. */
export const sendTest = mutation({
  args: { endpointId: v.id('webhookEndpoints') },
  returns: v.id('webhookDeliveries'),
  handler: async (ctx, { endpointId }) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const row = await loadOwnEndpoint(ctx, companyId, endpointId)
    if (row.status !== 'active') throw new Error('Turn the endpoint on before sending a test')
    const limit = await rateLimiter.limit(ctx, 'webhookTestPerCompany', { key: companyId })
    if (!limit.ok) throw new Error(`Too many test sends. ${retryAfterText(limit.retryAfter)}`)
    const now = Date.now()
    const payload = JSON.stringify({
      id: `test_${now}`,
      type: TEST_EVENT_TYPE,
      occurredAt: new Date(now).toISOString(),
      companyId,
      siteId: null,
      data: { message: 'Test delivery from PBA Farm' },
    })
    return await queueDelivery(ctx, { companyId, endpointId, eventType: TEST_EVENT_TYPE, payload })
  },
})

/** Send a delivery again as a new delivery (same payload and event id). */
export const redeliver = mutation({
  args: { deliveryId: v.id('webhookDeliveries') },
  returns: v.id('webhookDeliveries'),
  handler: async (ctx, { deliveryId }) => {
    const { companyId } = await requireWebhookAdmin(ctx)
    const row = await ctx.db.get(deliveryId)
    if (!row || row.companyId !== companyId) throw new Error('Delivery not found')
    const endpoint = await loadOwnEndpoint(ctx, companyId, row.endpointId)
    if (endpoint.status !== 'active') throw new Error('Turn the endpoint on before redelivering')
    const id = await queueDelivery(ctx, {
      companyId,
      endpointId: row.endpointId,
      eventId: row.eventId,
      eventType: row.eventType,
      payload: row.payload,
      redeliveryOf: deliveryId,
    })
    await logAudit(ctx, {
      actionType: 'webhook_redeliver',
      tableName: 'webhookDeliveries',
      recordId: id,
      newValues: { redeliveryOf: deliveryId, eventType: row.eventType },
    })
    return id
  },
})

/** Internal: what `deliver` needs (ciphertext only; decrypted in the action). */
export const loadForDelivery = internalQuery({
  args: { deliveryId: v.id('webhookDeliveries') },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId)
    if (!delivery || delivery.status !== 'pending') return null
    const endpoint = await ctx.db.get(delivery.endpointId)
    if (!endpoint || endpoint.status !== 'active') return { skip: 'Endpoint is off or removed' as const }
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_webhookEndpointId', (q) => q.eq('webhookEndpointId', endpoint._id))
      .unique()
    if (!secret) return { skip: 'Endpoint has no signing secret' as const }
    return {
      companyId: delivery.companyId,
      endpointId: endpoint._id,
      url: endpoint.url,
      eventId: delivery.eventId ?? null,
      eventType: delivery.eventType,
      payload: delivery.payload,
      attempts: delivery.attempts,
      secret: { ciphertext: secret.ciphertext, iv: secret.iv },
    }
  },
})

/** Internal: store one attempt's outcome; schedule the next or give up. */
export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id('webhookDeliveries'),
    ok: v.boolean(),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    /** Stop retrying (e.g. the endpoint was turned off). */
    final: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const delivery = await ctx.db.get(a.deliveryId)
    if (!delivery || delivery.status !== 'pending') return null
    const now = Date.now()
    const attempts = delivery.attempts + (a.final && !a.responseStatus && !a.ok ? 0 : 1)
    const endpoint = await ctx.db.get(delivery.endpointId)
    if (a.ok) {
      await ctx.db.patch(a.deliveryId, {
        status: 'succeeded',
        attempts,
        lastAttemptAt: now,
        nextAttemptAt: undefined,
        responseStatus: a.responseStatus,
        lastError: undefined,
        durationMs: a.durationMs,
      })
      if (endpoint) await ctx.db.patch(endpoint._id, { consecutiveFailures: 0, lastSuccessAt: now })
      return null
    }
    const delay = a.final ? null : nextRetryDelay(attempts)
    await ctx.db.patch(a.deliveryId, {
      status: delay === null ? 'failed' : 'pending',
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: delay === null ? undefined : now + delay,
      responseStatus: a.responseStatus,
      lastError: a.error?.slice(0, 300),
      durationMs: a.durationMs,
    })
    if (delay !== null) {
      await ctx.scheduler.runAfter(delay, internal.webhooks.deliver, { deliveryId: a.deliveryId })
    }
    if (endpoint && !a.final) {
      const failures = endpoint.consecutiveFailures + 1
      const disable = endpoint.status === 'active' && failures >= DISABLE_AFTER_FAILURES
      await ctx.db.patch(endpoint._id, {
        consecutiveFailures: failures,
        lastFailureAt: now,
        ...(disable
          ? { status: 'disabled' as const, disabledReason: `Turned off after ${failures} failed deliveries in a row` }
          : {}),
      })
      if (disable) await notifyAdminsDisabled(ctx, endpoint)
    }
    return null
  },
})

async function notifyAdminsDisabled(ctx: MutationCtx, endpoint: Doc<'webhookEndpoints'>) {
  const admins = (
    await ctx.db
      .query('users')
      .withIndex('by_companyId', (q) => q.eq('companyId', endpoint.companyId))
      .take(200)
  ).filter((u) => (u.role === 'admin' || u.role === 'super_admin') && u.active !== false)
  for (const admin of admins) {
    await ctx.db.insert('notifications', {
      userId: admin._id,
      title: 'Webhook turned off',
      message: `${endpoint.url} failed ${DISABLE_AFTER_FAILURES} times in a row and was turned off. Fix it, then turn it back on.`,
      type: 'warning',
      read: false,
      link: '/webhooks',
      companyId: endpoint.companyId,
    })
  }
}

function describeHttpError(e: HttpTransportError): { status?: number; message: string } {
  switch (e._tag) {
    case 'HttpStatusError':
      return { status: e.status, message: `Endpoint answered ${e.status}` }
    case 'HttpTimeoutError':
      return { message: `No answer within ${DELIVERY_TIMEOUT_MS / 1000} s` }
    case 'HttpNetworkError':
      return { message: 'Could not connect to the endpoint' }
  }
}

/** Sign and POST one delivery; one attempt (with quick transient retries). */
export const deliver = internalAction({
  args: { deliveryId: v.id('webhookDeliveries') },
  returns: v.null(),
  handler: async (ctx, { deliveryId }) => {
    const job = await ctx.runQuery(internal.webhooks.loadForDelivery, { deliveryId })
    if (!job) return null
    if ('skip' in job) {
      await ctx.runMutation(internal.webhooks.recordAttempt, { deliveryId, ok: false, error: job.skip, final: true })
      return null
    }
    let secret: string
    try {
      secret = (await decryptJson<{ secret: string }>(job.secret, endpointAad(job.companyId, job.endpointId))).secret
    } catch {
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        error: 'Signing secret cannot be read; rotate the secret',
        final: true,
      })
      return null
    }
    const started = Date.now()
    const program = Effect.gen(function* () {
      const signature = yield* Effect.promise(() => signatureHeader(secret, job.payload, Date.now()))
      return yield* requestJson(
        {
          url: job.url,
          method: 'POST',
          redirect: 'manual',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'PBAFarm-Webhooks/1',
            [SIGNATURE_HEADER]: signature,
            'X-PBA-Event-Id': job.eventId ?? 'test',
            'X-PBA-Event-Type': job.eventType,
            'X-PBA-Delivery-Id': deliveryId,
          },
          body: job.payload,
        },
        // A receiver dedupes by event id, so repeating a timed-out POST is safe.
        { timeoutMs: DELIVERY_TIMEOUT_MS, retries: 2, retryBaseDelayMs: 500 },
      )
    }).pipe(
      Effect.map((res) => ({ ok: true as const, status: res.status })),
      Effect.catch((e: HttpTransportError) => Effect.succeed({ ok: false as const, ...describeHttpError(e) })),
      Effect.provide(FetchLive),
    )
    const outcome = await runEffect(program)
    await ctx.runMutation(internal.webhooks.recordAttempt, {
      deliveryId,
      ok: outcome.ok,
      responseStatus: outcome.status,
      error: outcome.ok ? undefined : outcome.message,
      durationMs: Date.now() - started,
    })
    return null
  },
})

/** Retention: deliveries older than 30 days, in batches. */
export const pruneDeliveries = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const old = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    for (const row of old) await ctx.db.delete(row._id)
    return old.length
  },
})

export { MAX_ATTEMPTS }
