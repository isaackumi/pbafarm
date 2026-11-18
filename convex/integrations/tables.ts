import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Tables for Phase 11 (INT-*) and the shared domain-event outbox
 * (docs/architecture/07 §2–3, 09 §3). Kept out of schema.ts so parallel work
 * on other tables does not conflict; schema.ts spreads `integrationTables`.
 */

/** Flat event data: ≤ 40 keys of scalars (doc 07 §3). */
export const domainEventData = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean(), v.null()),
)

export const domainEventOrigin = v.union(
  v.literal('user'),
  v.literal('automation'),
  v.literal('system'),
  v.literal('api'),
)

export const integrationTables = {
  /**
   * Transactional outbox of business events. Written only through
   * `emitDomainEvent` (convex/lib/events.ts) in the same mutation as the
   * change; consumers (webhooks, automation) run from `internal.events.dispatch`.
   */
  domainEvents: defineTable({
    companyId: v.id('companies'),
    /** Catalog key, e.g. 'daily.batch.recorded' (convex/lib/events.ts). */
    type: v.string(),
    subjectTable: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    actorUserId: v.optional(v.id('users')),
    actorApiKeyId: v.optional(v.id('apiKeys')),
    origin: domainEventOrigin,
    /** YYYY-MM-DD the event belongs to (record date), when there is one. */
    businessDate: v.optional(v.string()),
    data: domainEventData,
    dispatchStatus: v.union(v.literal('pending'), v.literal('dispatched'), v.literal('failed')),
    /** Consumer errors from the last dispatch, short text. */
    dispatchError: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index('by_companyId_and_occurredAt', ['companyId', 'occurredAt'])
    .index('by_companyId_and_type_and_occurredAt', ['companyId', 'type', 'occurredAt'])
    .index('by_dispatchStatus_and_occurredAt', ['dispatchStatus', 'occurredAt']),

  /**
   * Organization API keys (INT-004). Only the SHA-256 of the full key is
   * stored; the key is shown once at creation.
   */
  apiKeys: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    /** Public lookup id inside the key: `pbk_<prefix>_<secret>`. */
    prefix: v.string(),
    /** Hex SHA-256 of the full key. */
    hash: v.string(),
    scopes: v.array(v.string()),
    /** Optional site restriction; empty or absent = all sites. */
    locationIds: v.optional(v.array(v.id('farmLocations'))),
    createdBy: v.id('users'),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id('users')),
    /** Updated at most every few minutes to avoid write contention. */
    lastUsedAt: v.optional(v.number()),
  })
    .index('by_prefix', ['prefix'])
    .index('by_companyId', ['companyId']),

  /**
   * Stored responses for API writes sent with an Idempotency-Key, so a
   * retried request returns the first result instead of writing twice.
   */
  apiIdempotencyKeys: defineTable({
    companyId: v.id('companies'),
    apiKeyId: v.id('apiKeys'),
    key: v.string(),
    /** 'POST /api/v1/daily-records' */
    route: v.string(),
    /** Hex SHA-256 of the request body: a reused key with another body is refused. */
    requestHash: v.string(),
    responseStatus: v.number(),
    /** JSON response body. */
    responseBody: v.string(),
    createdAt: v.number(),
  })
    .index('by_apiKeyId_and_key', ['apiKeyId', 'key'])
    .index('by_createdAt', ['createdAt']),

  /**
   * Outbound webhook endpoints (INT-005, doc 09 §7). The signing secret is
   * encrypted in integrationSecrets (webhookEndpointId) and shown once.
   */
  webhookEndpoints: defineTable({
    companyId: v.id('companies'),
    url: v.string(),
    description: v.optional(v.string()),
    /** Subscribed domain event types (convex/lib/events.ts catalog). */
    eventTypes: v.array(v.string()),
    status: v.union(v.literal('active'), v.literal('disabled')),
    /** Failed attempts since the last success; 20 disables the endpoint. */
    consecutiveFailures: v.number(),
    disabledReason: v.optional(v.string()),
    /** "…4F2a" of the signing secret, for the UI. */
    secretHint: v.optional(v.string()),
    lastSuccessAt: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_companyId_and_status', ['companyId', 'status']),

  /** One row per (endpoint, event) delivery, and per redelivery or test. */
  webhookDeliveries: defineTable({
    companyId: v.id('companies'),
    endpointId: v.id('webhookEndpoints'),
    /** Absent for test pings. */
    eventId: v.optional(v.id('domainEvents')),
    eventType: v.string(),
    /** The exact JSON body sent (kept so redelivery sends the same payload). */
    payload: v.string(),
    status: v.union(v.literal('pending'), v.literal('succeeded'), v.literal('failed')),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    responseStatus: v.optional(v.number()),
    /** Short error text (never the response body). */
    lastError: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    /** Set on a manual redelivery: the delivery it repeats. */
    redeliveryOf: v.optional(v.id('webhookDeliveries')),
    createdAt: v.number(),
  })
    .index('by_endpointId_and_createdAt', ['endpointId', 'createdAt'])
    .index('by_eventId_and_endpointId', ['eventId', 'endpointId'])
    .index('by_createdAt', ['createdAt']),
}
