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
}
