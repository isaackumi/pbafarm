import { v, type Infer } from 'convex/values'

/**
 * Validators shared by the automation tables and their API (AUTO-002,
 * D-008, docs/architecture/07-automation-engine-design.md).
 */

/** Scalar a condition compares against. */
export const conditionValue = v.union(v.string(), v.number(), v.boolean())

export const conditionOp = v.union(
  v.literal('eq'),
  v.literal('neq'),
  v.literal('gt'),
  v.literal('gte'),
  v.literal('lt'),
  v.literal('lte'),
  v.literal('is_set'),
  v.literal('not_set'),
)

/**
 * One comparison. `field` and `valueFrom` are dotted paths into the run
 * context: `payload.*` (event data), `check.*` (schedule check result) and
 * `settings.farmRules.*` (company thresholds).
 */
export const automationCondition = v.object({
  field: v.string(),
  op: conditionOp,
  value: v.optional(conditionValue),
  valueFrom: v.optional(v.string()),
})

/** Who an action reaches. Users are always limited to the rule's company. */
export const automationRecipients = v.object({
  everyone: v.optional(v.boolean()),
  /** 'admin' also matches super_admin. */
  roles: v.optional(v.array(v.union(v.literal('user'), v.literal('admin')))),
  userIds: v.optional(v.array(v.id('users'))),
})

export const notifyChannel = v.union(
  v.literal('in_app'),
  v.literal('sms'),
  v.literal('whatsapp'),
  v.literal('email'),
)

export const automationAction = v.union(
  v.object({
    kind: v.literal('notify'),
    channels: v.array(notifyChannel),
    recipients: automationRecipients,
    /** Text with {{placeholders}} from the run context. */
    title: v.string(),
    message: v.string(),
    link: v.optional(v.string()),
    level: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('error'))),
    /** In-app dedupe key template; a key already used is never sent again. */
    dedupeKey: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('create_task'),
    recipients: automationRecipients,
    title: v.string(),
    description: v.optional(v.string()),
    dueInHours: v.optional(v.number()),
  }),
  /** POST the triggering event (or check result) to a webhook endpoint (INT-005). */
  v.object({
    kind: v.literal('webhook'),
    endpointId: v.id('webhookEndpoints'),
  }),
)

export const automationTrigger = v.union(
  v.object({ kind: v.literal('event'), eventType: v.string() }),
  v.object({
    kind: v.literal('schedule'),
    /** 'HH:MM' in the company time zone. */
    localTime: v.string(),
    /** 0 = Sunday … 6 = Saturday; empty or missing = every day. */
    daysOfWeek: v.optional(v.array(v.number())),
    /** Check from the code catalog (convex/automation/checks.ts). */
    check: v.string(),
    params: v.optional(v.record(v.string(), conditionValue)),
  }),
)

export const runStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('retrying'),
  v.literal('succeeded'),
  v.literal('partial'),
  v.literal('failed'),
  v.literal('skipped'),
)

export const deliveryStatus = v.union(
  v.literal('pending'),
  v.literal('sent'),
  v.literal('failed'),
  v.literal('skipped'),
)

export const runDelivery = v.object({
  channel: v.union(v.literal('sms'), v.literal('whatsapp'), v.literal('email')),
  userId: v.id('users'),
  to: v.string(),
  subject: v.string(),
  body: v.string(),
  status: deliveryStatus,
  attempts: v.number(),
  error: v.optional(v.string()),
  retryable: v.optional(v.boolean()),
  providerMessageId: v.optional(v.string()),
})

export const quietHours = v.object({ start: v.string(), end: v.string() })

export type AutomationCondition = Infer<typeof automationCondition>
export type AutomationAction = Infer<typeof automationAction>
export type AutomationTrigger = Infer<typeof automationTrigger>
export type AutomationRecipients = Infer<typeof automationRecipients>
export type RunDelivery = Infer<typeof runDelivery>
export type ConditionValue = Infer<typeof conditionValue>
