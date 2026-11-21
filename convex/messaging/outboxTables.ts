import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/** Channels a message can leave on: company channels plus the Telegram bot (Paper 57b). */
export const outboxChannel = v.union(
  v.literal('sms'),
  v.literal('whatsapp'),
  v.literal('telegram'),
  v.literal('email'),
)
export type OutboxChannel = 'sms' | 'whatsapp' | 'telegram' | 'email'

/** queued = waiting for its (next) attempt; sent = accepted by the provider. */
export const outboxStatus = v.union(v.literal('queued'), v.literal('sent'), v.literal('failed'))
export type OutboxStatus = 'queued' | 'sent' | 'failed'

/** What produced the message; `code` rows never store the message text. */
export const outboxSource = v.union(
  v.literal('automation'),
  v.literal('notification'),
  v.literal('report'),
  v.literal('code'),
  v.literal('test'),
  v.literal('bot_reminder'),
  v.literal('bot_approval'),
)
export type OutboxSource =
  | 'automation'
  | 'notification'
  | 'report'
  | 'code'
  | 'test'
  | 'bot_reminder'
  | 'bot_approval'

/**
 * Outbound message log (Paper 57b Outbox) and monthly usage counters.
 * Spread into the schema like botTables. See convex/messaging/outbox.ts.
 */
export const outboxTables = {
  /**
   * One row per outbound message (doc 18). Only a masked address is kept;
   * the full number or email stays on the dispatch that owns the send.
   * Rows from automation runs and notification dispatches are upserted by
   * `key` as the attempt moves queued → sent / failed. Kept 90 days.
   */
  outboundMessages: defineTable({
    companyId: v.id('companies'),
    channel: outboxChannel,
    status: outboxStatus,
    source: outboxSource,
    /** Upsert key, unique per company (e.g. "nd:<dispatchId>:<index>"). */
    key: v.optional(v.string()),
    recipientUserId: v.optional(v.id('users')),
    /** Snapshot of the recipient's name at first write (search and display). */
    recipientName: v.optional(v.string()),
    /** Non-user recipients: what they are to the farm ('customer', 'supplier'). */
    recipientRole: v.optional(v.union(v.literal('customer'), v.literal('supplier'))),
    /** Masked address only, e.g. "+233 ••• ••410" or "k…@farm.com". */
    toMasked: v.string(),
    /** userId or a hash of the address; groups WhatsApp conversations. */
    recipientKey: v.string(),
    /** Preview, at most 300 characters; absent for sign-in codes. */
    body: v.optional(v.string()),
    /** Recipient name and body, for the Outbox search. */
    searchText: v.string(),
    error: v.optional(v.string()),
    attempts: v.number(),
    /** Next attempt of a queued message (retry back-off). */
    nextAttemptAt: v.optional(v.number()),
    /** The dispatch or run that owns the send; a failed row can be retried through it. */
    dispatchId: v.optional(v.id('notificationDispatches')),
    runId: v.optional(v.id('automationRuns')),
    deliveryIndex: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_createdAt', ['companyId', 'createdAt'])
    .index('by_companyId_and_status_and_createdAt', ['companyId', 'status', 'createdAt'])
    .index('by_companyId_and_key', ['companyId', 'key'])
    .index('by_companyId_and_channel_and_recipientKey_and_sentAt', ['companyId', 'channel', 'recipientKey', 'sentAt'])
    .index('by_createdAt', ['createdAt'])
    .searchIndex('search_text', { searchField: 'searchText', filterFields: ['companyId', 'status'] }),

  /** Messages sent per company, channel and UTC month ("YYYY-MM"). */
  messageUsage: defineTable({
    companyId: v.id('companies'),
    period: v.string(),
    channel: outboxChannel,
    /** Messages accepted by the provider. */
    count: v.number(),
    /** WhatsApp: 24-hour conversations opened (first message to a recipient in 24 h). */
    conversations: v.number(),
    updatedAt: v.number(),
  }).index('by_companyId_and_period_and_channel', ['companyId', 'period', 'channel']),
}
