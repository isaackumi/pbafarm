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
  /** Water readings read off a logbook page (BOT-006). */
  dissolvedOxygen: v.optional(v.number()),
  temperatureC: v.optional(v.number()),
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
    kind: v.union(v.literal('text'), v.literal('button'), v.literal('image'), v.literal('audio'), v.literal('unsupported')),
    /** Untrusted user text, capped (an image's caption). */
    text: v.optional(v.string()),
    /** Button / list / callback payload we generated (still untrusted). */
    buttonId: v.optional(v.string()),
    /** Telegram callback query to acknowledge. */
    callbackQueryId: v.optional(v.string()),
    /** Sender's profile name, for the /account card. */
    profileName: v.optional(v.string()),
    /** Photo (BOT-006) or voice note (BOT-005): WhatsApp media id or Telegram file_id, declared type and size. Untrusted. */
    mediaId: v.optional(v.string()),
    mediaMime: v.optional(v.string()),
    mediaSize: v.optional(v.number()),
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
    /** Spoken language of voice notes (BOT-005, VOICE command): en, fr, tw, ee, gaa. Else from the account locale. */
    voiceLanguage: v.optional(v.string()),
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
    /** The logbook photo this draft was read from (BOT-006). */
    scanId: v.optional(v.id('logbookScans')),
    /** The voice note this draft was heard from (BOT-005). */
    voiceNoteId: v.optional(v.id('voiceNotes')),
    /** Fields heard with low confidence, shown as CHECK: 'unit', 'feedKg', 'mortality', 'quantityKg'. */
    needsCheck: v.optional(v.array(v.string())),
    /** What was heard for a CHECK field, e.g. "aduasa", for the explanation line. */
    checkHeard: v.optional(v.string()),
    /** Fields the worker did not say: shown blank, never as 0. */
    notSaid: v.optional(v.array(v.string())),
    /** Closest units when the cage was unclear (picker buttons, best first, at most 10). */
    unitChoices: v.optional(v.array(v.object({ cageId: v.id('cages'), name: v.string() }))),
  })
    .index('by_bindingId_and_status', ['bindingId', 'status'])
    .index('by_scanId', ['scanId'])
    .index('by_voiceNoteId', ['voiceNoteId'])
    .index('by_bindingId_and_fingerprint', ['bindingId', 'fingerprint'])
    .index('by_status_and_expiresAt', ['status', 'expiresAt'])
    .index('by_companyId', ['companyId']),

  /**
   * A photo of a paper logbook page sent to the bot (BOT-006). The image is
   * a `files` row (entityType 'logbookScans'); each extracted row that
   * matched a unit is a pendingBotActions draft with this scanId, so nothing
   * is saved until the user taps. One scan per (binding, message).
   */
  logbookScans: defineTable({
    companyId: v.id('companies'),
    /** The binding's active site when set (the file's site scope). */
    locationId: v.optional(v.id('farmLocations')),
    userId: v.id('users'),
    bindingId: v.id('channelBindings'),
    provider: botProvider,
    sourceMessageId: v.string(),
    status: v.union(
      v.literal('processing'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    error: v.optional(v.string()),
    fileId: v.optional(v.id('files')),
    providerId: v.optional(v.string()),
    model: v.optional(v.string()),
    /** Page date read by the model (YYYY-MM-DD), when it found one. */
    pageDate: v.optional(v.string()),
    /** Rows read off the page; capped (MAX_ROWS in bot/logbook.ts). */
    rowCount: v.optional(v.number()),
    draftCount: v.optional(v.number()),
    /** Rows that did not become a draft, with the reason, for the reply. */
    flagged: v.optional(v.array(v.object({ unit: v.string(), reason: v.string() }))),
    createdAt: v.number(),
  })
    .index('by_bindingId_and_sourceMessageId', ['bindingId', 'sourceMessageId'])
    .index('by_companyId_and_createdAt', ['companyId', 'createdAt']),

  /**
   * A voice note sent to the bot (BOT-005). One per (binding, message): the
   * row is the idempotency key for its workflow run. The audio is a `files`
   * row (entityType 'voiceNotes') deleted after 30 days; the transcript stays
   * with the drafts (pendingBotActions.voiceNoteId).
   */
  voiceNotes: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    userId: v.id('users'),
    bindingId: v.id('channelBindings'),
    provider: botProvider,
    sourceMessageId: v.string(),
    /** WhatsApp media id or Telegram file_id (untrusted). */
    mediaId: v.string(),
    /** Provider timestamp of the message (ms): the drafts' farm date. */
    sentAt: v.number(),
    /** en, fr, tw, ee or gaa. */
    language: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('stored'),
      v.literal('transcribed'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    error: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    fileId: v.optional(v.id('files')),
    mime: v.optional(v.string()),
    size: v.optional(v.number()),
    /** What was heard, in the spoken language (capped). */
    transcript: v.optional(v.string()),
    /** The English line shown under the transcript. */
    english: v.optional(v.string()),
    /** Words heard with low confidence. */
    lowConfidence: v.optional(v.array(v.string())),
    vendor: v.optional(v.string()),
    model: v.optional(v.string()),
    draftCount: v.optional(v.number()),
    /** When the audio was deleted (30-day retention). */
    audioDeletedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_bindingId_and_sourceMessageId', ['bindingId', 'sourceMessageId'])
    .index('by_companyId_and_createdAt', ['companyId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  /**
   * An approval request (stocking, top-up, transfer) sent to one approver's
   * bound chat with Approve / Reject buttons (BOT-007). One row per
   * (request, binding); the decision itself goes through the same helper as
   * the web approval and is audited there with the chat channel.
   */
  botApprovalPrompts: defineTable({
    bindingId: v.id('channelBindings'),
    userId: v.id('users'),
    companyId: v.id('companies'),
    provider: botProvider,
    kind: v.union(v.literal('stocking'), v.literal('topup'), v.literal('transfer')),
    /** stockingHistory / topupHistory / fishTransfers id. */
    recordId: v.string(),
    subject: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('sent'),
      v.literal('awaiting_reason'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('closed'),
      v.literal('expired'),
      v.literal('skipped'),
      v.literal('failed'),
    ),
    createdAt: v.number(),
    /** Held until the approver's quiet hours end. */
    sendAt: v.number(),
    sentAt: v.optional(v.number()),
    /** Buttons stop working after this; the web Approvals page still does. */
    expiresAt: v.number(),
    reasonAskedAt: v.optional(v.number()),
    decidedAt: v.optional(v.number()),
    /** The chat message (button tap or reason text) that carried the decision. */
    sourceMessageId: v.optional(v.string()),
    /** Why the prompt was skipped, closed or a tap was refused. */
    note: v.optional(v.string()),
  })
    .index('by_kind_and_recordId', ['kind', 'recordId'])
    .index('by_bindingId_and_status', ['bindingId', 'status'])
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
