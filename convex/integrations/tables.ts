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
}
