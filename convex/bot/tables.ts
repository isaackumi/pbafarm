import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Farm bot tables (BOT-001..004, doc 23). Spread into the schema like
 * integrationTables. Conversation threads live in the agent component.
 */
export const botProvider = v.union(v.literal('whatsapp'), v.literal('telegram'))

export const pendingStatus = v.union(
  v.literal('pending'),
  v.literal('committed'),
  v.literal('cancelled'),
  v.literal('expired'),
  v.literal('undone'),
  v.literal('failed'),
)

/** Feed and/or mortality for one unit and date (a daily record). */
export const dailyEntryPayload = v.object({
  kind: v.literal('daily_entry'),
  cageId: v.id('cages'),
  cageName: v.string(),
  feedKg: v.number(),
  feedTypeId: v.optional(v.id('feedTypes')),
  feedTypeName: v.optional(v.string()),
  mortality: v.number(),
  mortalityCause: v.optional(v.string()),
  notes: v.optional(v.string()),
})

/** Feed taken out of the store, optionally to a unit's bin. */
export const feedIssuePayload = v.object({
  kind: v.literal('feed_issue'),
  feedTypeId: v.id('feedTypes'),
  feedTypeName: v.string(),
  quantityKg: v.number(),
  cageId: v.optional(v.id('cages')),
  cageName: v.optional(v.string()),
  notes: v.optional(v.string()),
})

export const pendingPayload = v.union(dailyEntryPayload, feedIssuePayload)

export const botTables = {
  /**
   * Every inbound webhook message, stored before any processing (BOT-001).
   * (provider, externalId) is unique: a provider retry is a no-op.
   */
  channelInbound: defineTable({
    provider: botProvider,
    /** WhatsApp message id (wamid) or Telegram update_id. */
    externalId: v.string(),
    /** E.164 phone (WhatsApp) or Telegram chat id. */
    address: v.string(),
    kind: v.union(v.literal('text'), v.literal('button'), v.literal('unsupported')),
    /** Untrusted user text, capped. */
    text: v.optional(v.string()),
    /** Button / list / callback payload we generated (still untrusted). */
    buttonId: v.optional(v.string()),
    /** Telegram callback query to acknowledge. */
    callbackQueryId: v.optional(v.string()),
    /** Sender's profile name, for the /account card. */
    profileName: v.optional(v.string()),
    /** Provider timestamp of the message (ms). */
    sentAt: v.number(),
    receivedAt: v.number(),
    status: v.union(v.literal('queued'), v.literal('processed'), v.literal('ignored'), v.literal('failed')),
    bindingId: v.optional(v.id('channelBindings')),
    error: v.optional(v.string()),
  })
    .index('by_provider_and_externalId', ['provider', 'externalId'])
    .index('by_receivedAt', ['receivedAt']),

  /** A chat address bound to one user and one organization (doc 23 §3). */
  channelBindings: defineTable({
    provider: botProvider,
    address: v.string(),
    userId: v.id('users'),
    companyId: v.id('companies'),
    activeSiteId: v.optional(v.id('farmLocations')),
    verifiedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
    /** Agent component thread (BOT-002). */
    threadId: v.optional(v.string()),
    /** Telegram / WhatsApp profile name, for the /account card. */
    displayName: v.optional(v.string()),
    /** Last inbound message: WhatsApp free-form replies only within 24 h. */
    lastInboundAt: v.optional(v.number()),
    /** Daily reminder (BOT-004), opt-in. "HH:MM" in `reminderTimezone`. */
    reminderEnabled: v.optional(v.boolean()),
    reminderTime: v.optional(v.string()),
    reminderTimezone: v.optional(v.string()),
    /** Farm date of the last reminder sent, so each day sends once. */
    lastReminderDate: v.optional(v.string()),
  })
    .index('by_provider_and_address', ['provider', 'address'])
    .index('by_userId', ['userId'])
    .index('by_reminderEnabled', ['reminderEnabled'])
    .index('by_companyId', ['companyId']),

  /** One-time codes / deep-link tokens issued on /account (hash only). */
  channelConnectCodes: defineTable({
    userId: v.id('users'),
    companyId: v.id('companies'),
    provider: botProvider,
    codeHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_provider_and_codeHash', ['provider', 'codeHash'])
    .index('by_userId', ['userId'])
    .index('by_companyId', ['companyId']),

  /**
   * A write the bot proposed and the user has not confirmed yet (BOT-003).
   * Validated against the binding's scope at proposal and again at commit.
   */
  pendingBotActions: defineTable({
    bindingId: v.id('channelBindings'),
    userId: v.id('users'),
    companyId: v.id('companies'),
    siteId: v.optional(v.id('farmLocations')),
    provider: botProvider,
    payload: pendingPayload,
    /** Farm date of the entry: the message time in the site's timezone. */
    date: v.string(),
    /** Provider timestamp of the message that carried the entry. */
    eventTime: v.number(),
    sourceMessageId: v.string(),
    summary: v.string(),
    /** kind|unit|date|qty: the 10-minute duplicate guard. */
    fingerprint: v.string(),
    /** A same-looking entry was proposed in the last 10 minutes. */
    duplicateOf: v.optional(v.id('pendingBotActions')),
    status: pendingStatus,
    createdAt: v.number(),
    expiresAt: v.number(),
    committedAt: v.optional(v.number()),
    undoUntil: v.optional(v.number()),
    dailyRecordId: v.optional(v.id('dailyRecords')),
    feedUsageId: v.optional(v.id('feedUsage')),
    error: v.optional(v.string()),
  })
    .index('by_bindingId_and_status', ['bindingId', 'status'])
    .index('by_bindingId_and_fingerprint', ['bindingId', 'fingerprint'])
    .index('by_status_and_expiresAt', ['status', 'expiresAt'])
    .index('by_companyId', ['companyId']),

  /**
   * Messages the bot sent, with Meta's pricing from status webhooks, so
   * WhatsApp conversation cost is tracked per organization (BOT-001).
   */
  channelMessageCosts: defineTable({
    provider: botProvider,
    providerMessageId: v.string(),
    companyId: v.id('companies'),
    bindingId: v.optional(v.id('channelBindings')),
    kind: v.union(v.literal('free_form'), v.literal('template')),
    sentAt: v.number(),
    status: v.optional(v.string()),
    billable: v.optional(v.boolean()),
    pricingModel: v.optional(v.string()),
    category: v.optional(v.string()),
    pricingType: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_providerMessageId', ['providerMessageId'])
    .index('by_companyId_and_sentAt', ['companyId', 'sentAt']),
}
