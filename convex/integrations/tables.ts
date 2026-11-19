import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Tables for Phase 11 (INT-*, docs/architecture/09 §3). Kept out of
 * schema.ts so parallel work on other tables does not conflict; schema.ts
 * spreads `integrationTables`. The domain-event outbox (`domainEvents`) is
 * defined in schema.ts by AUTO-001.
 */

export const integrationTables = {
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

  /**
   * Daily weather per site with coordinates (INT-006, doc 09 §9), from
   * Open-Meteo. One row per site and local date; forecast rows are replaced
   * by observed values on later fetches.
   */
  weatherObservations: defineTable({
    companyId: v.id('companies'),
    locationId: v.id('farmLocations'),
    /** YYYY-MM-DD in the site's time zone. */
    date: v.string(),
    tempMaxC: v.optional(v.number()),
    tempMinC: v.optional(v.number()),
    precipitationMm: v.optional(v.number()),
    windMaxKmh: v.optional(v.number()),
    /** WMO weather code. */
    weatherCode: v.optional(v.number()),
    /** True when the date was in the future at fetch time. */
    isForecast: v.boolean(),
    source: v.literal('open_meteo'),
    fetchedAt: v.number(),
  })
    .index('by_locationId_and_date', ['locationId', 'date'])
    .index('by_companyId_and_date', ['companyId', 'date']),

  /**
   * Water-quality readings from sensors and gateways (INT-007), posted to
   * /ingest/v1/readings with an `ingest:write` API key.
   */
  sensorReadings: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    cageId: v.optional(v.id('cages')),
    /** The sender's own device id. */
    deviceId: v.string(),
    /** Catalog key (convex/integrations/sensorLogic.ts), e.g. 'dissolved_oxygen'. */
    parameter: v.string(),
    value: v.number(),
    measuredAt: v.number(),
    receivedAt: v.number(),
    apiKeyId: v.id('apiKeys'),
  })
    .index('by_companyId_and_measuredAt', ['companyId', 'measuredAt'])
    .index('by_cageId_and_parameter_and_measuredAt', ['cageId', 'parameter', 'measuredAt'])
    .index('by_companyId_and_deviceId_and_measuredAt', ['companyId', 'deviceId', 'measuredAt']),

  /**
   * Inbound signed webhooks (INT-003, doc 09 §7). A partner POSTs to
   * /webhooks/in/<publicId>, signed like our outbound webhooks
   * (`X-PBA-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`). The secret is
   * AES-GCM encrypted in integrationSecrets (inboundWebhookId), shown once.
   */
  inboundWebhooks: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    /** Public id in the URL: `inw_<24 base62>`. Not a secret. */
    publicId: v.string(),
    status: v.union(v.literal('active'), v.literal('disabled')),
    secretHint: v.optional(v.string()),
    lastReceivedAt: v.optional(v.number()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_publicId', ['publicId']),

  /**
   * One row per inbound delivery. Accepted rows are the replay guard:
   * (webhook, externalId) is processed once; resends bump `duplicates`.
   * Rejected rows (bad signature, stale timestamp) are logged, rate limited.
   */
  inboundWebhookEvents: defineTable({
    companyId: v.id('companies'),
    webhookId: v.id('inboundWebhooks'),
    /** Sender's event id (X-PBA-Event-Id header or body `id`). */
    externalId: v.optional(v.string()),
    eventType: v.optional(v.string()),
    status: v.union(v.literal('accepted'), v.literal('rejected')),
    /** Why a request was rejected (never contains the secret). */
    reason: v.optional(v.string()),
    /** The JSON body of an accepted event (≤ 64 KB). */
    payload: v.optional(v.string()),
    payloadBytes: v.number(),
    /** Signature timestamp (unix seconds). */
    signedAt: v.optional(v.number()),
    /** Hex SHA-256 of the signed `${t}.${body}`: replay key the signature covers. */
    signedDigest: v.optional(v.string()),
    duplicates: v.optional(v.number()),
    lastDuplicateAt: v.optional(v.number()),
    domainEventId: v.optional(v.id('domainEvents')),
    receivedAt: v.number(),
  })
    .index('by_webhookId_and_externalId', ['webhookId', 'externalId'])
    .index('by_webhookId_and_signedDigest', ['webhookId', 'signedDigest'])
    .index('by_webhookId_and_receivedAt', ['webhookId', 'receivedAt'])
    .index('by_companyId_and_receivedAt', ['companyId', 'receivedAt'])
    .index('by_receivedAt', ['receivedAt']),

  /**
   * Organization LLM provider keys (INT-009). Non-secret settings only; the
   * key is AES-GCM encrypted in integrationSecrets (llmCredentialId).
   */
  llmCredentials: defineTable({
    companyId: v.id('companies'),
    /** lib/llmClient.js LLM_PROVIDERS id (convex/lib/llmGateway.ts mirror). */
    providerId: v.string(),
    /** Default model for this key. */
    model: v.string(),
    /** Custom (OpenAI-compatible) provider only. */
    baseUrl: v.optional(v.string()),
    keyHint: v.optional(v.string()),
    isDefault: v.boolean(),
    enabled: v.boolean(),
    updatedBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_companyId_and_providerId', ['companyId', 'providerId']),

  /** One row per assistant model call (INT-009): who, which model, tokens, cost estimate. */
  llmUsage: defineTable({
    companyId: v.id('companies'),
    /** Absent for scheduled calls (the weekly report, AI-003). */
    userId: v.optional(v.id('users')),
    providerId: v.string(),
    model: v.string(),
    /** Whose key paid: the organization's or the platform's. */
    source: v.union(v.literal('org_key'), v.literal('server_key')),
    feature: v.union(v.literal('chat'), v.literal('insights'), v.literal('report')),
    ok: v.boolean(),
    error: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    /** USD estimate from convex/lib/llmGateway.ts MODEL_PRICES; absent when unknown. */
    costUsd: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_companyId_and_createdAt', ['companyId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),
}
