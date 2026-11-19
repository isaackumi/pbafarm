import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Platform console and billing tables (PLAT-1xx, docs/architecture/22-platform-console-billing.md).
 * Kept out of schema.ts like integrationTables; schema.ts spreads `billingTables`.
 *
 * Provider-agnostic: amounts are integer minor units (pesewas, cents; XOF has
 * no minor unit so 1 = 1 franc) in one currency per row; `provider` says who
 * collects ('manual' today, 'paystack' / 'stripe' later behind the
 * BillingProvider service, convex/billing/provider.ts).
 */

export const billingInterval = v.union(v.literal('month'), v.literal('year'))

export const subscriptionStatus = v.union(
  v.literal('trialing'),
  v.literal('active'),
  v.literal('past_due'),
  v.literal('suspended'),
  v.literal('cancelled'),
)

export const billingProviderId = v.union(v.literal('manual'), v.literal('paystack'), v.literal('stripe'))

export const paymentMethod = v.union(
  v.literal('manual'),
  v.literal('bank'),
  v.literal('mobile_money'),
  v.literal('card'),
)

export const invoiceStatus = v.union(
  v.literal('open'),
  v.literal('paid'),
  v.literal('void'),
  v.literal('uncollectible'),
)

/** Plan limits; a missing limit is unlimited. */
export const planLimits = v.object({
  sites: v.optional(v.number()),
  users: v.optional(v.number()),
  units: v.optional(v.number()),
  aiCredits: v.optional(v.number()),
  smsIncluded: v.optional(v.number()),
})

export const planPrice = v.object({
  /** lib/currencies code: GHS, XOF, USD, ... */
  currency: v.string(),
  amountMinor: v.number(),
})

export const invoiceLine = v.object({
  description: v.string(),
  quantity: v.number(),
  unitAmountMinor: v.number(),
})

/** Most user ids kept per usage day (distinct active users). */
export const MAX_ACTIVE_USER_IDS = 500

export const billingTables = {
  plans: defineTable({
    code: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    /** At most one price per currency (bounded by the currency list). */
    prices: v.array(planPrice),
    interval: billingInterval,
    limits: planLimits,
    /** Feature flags this plan turns on, e.g. { ai_assistant: true, public_api: false }. */
    features: v.record(v.string(), v.boolean()),
    trialDays: v.number(),
    /** The plan new and backfilled organizations start on. */
    isDefault: v.boolean(),
    active: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_code', ['code'])
    .index('by_isDefault', ['isDefault']),

  /** One subscription per organization (by_companyId, latest wins). */
  subscriptions: defineTable({
    companyId: v.id('companies'),
    planId: v.id('plans'),
    status: subscriptionStatus,
    currency: v.string(),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    trialEndsAt: v.optional(v.number()),
    /** When past_due started, and when the grace period ends (then suspended). */
    pastDueAt: v.optional(v.number()),
    graceEndsAt: v.optional(v.number()),
    suspendedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    seats: v.optional(v.number()),
    provider: billingProviderId,
    providerRef: v.optional(v.string()),
    /** Per-tenant overrides on top of the plan. */
    limitOverrides: v.optional(planLimits),
    featureOverrides: v.optional(v.record(v.string(), v.boolean())),
    /** Extra credits granted by the platform (billingCreditGrants is the ledger). */
    aiCreditsGranted: v.optional(v.number()),
    smsCreditsGranted: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_status', ['status'])
    .index('by_status_and_trialEndsAt', ['status', 'trialEndsAt'])
    .index('by_status_and_currentPeriodEnd', ['status', 'currentPeriodEnd'])
    .index('by_status_and_graceEndsAt', ['status', 'graceEndsAt']),

  billingInvoices: defineTable({
    companyId: v.id('companies'),
    subscriptionId: v.optional(v.id('subscriptions')),
    number: v.string(),
    currency: v.string(),
    /** Bounded: at most 50 lines. */
    lines: v.array(invoiceLine),
    totalMinor: v.number(),
    paidMinor: v.number(),
    status: invoiceStatus,
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    issuedAt: v.number(),
    dueAt: v.number(),
    paidAt: v.optional(v.number()),
    voidedAt: v.optional(v.number()),
    provider: billingProviderId,
    providerRef: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_companyId_and_issuedAt', ['companyId', 'issuedAt'])
    .index('by_status_and_dueAt', ['status', 'dueAt'])
    .index('by_issuedAt', ['issuedAt'])
    .index('by_number', ['number']),

  billingPayments: defineTable({
    companyId: v.id('companies'),
    invoiceId: v.optional(v.id('billingInvoices')),
    currency: v.string(),
    amountMinor: v.number(),
    method: paymentMethod,
    provider: billingProviderId,
    providerRef: v.optional(v.string()),
    /** Recording the same key twice returns the first payment (no double credit). */
    idempotencyKey: v.string(),
    status: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('refunded')),
    receivedAt: v.number(),
    note: v.optional(v.string()),
    recordedBy: v.optional(v.id('users')),
    createdAt: v.number(),
  })
    .index('by_idempotencyKey', ['idempotencyKey'])
    .index('by_companyId_and_receivedAt', ['companyId', 'receivedAt'])
    .index('by_invoiceId', ['invoiceId'])
    .index('by_receivedAt', ['receivedAt']),

  /** Credits granted by the platform (AI credits, SMS credits): the ledger. */
  billingCreditGrants: defineTable({
    companyId: v.id('companies'),
    kind: v.union(v.literal('ai'), v.literal('sms')),
    amount: v.number(),
    reason: v.string(),
    grantedBy: v.id('users'),
    createdAt: v.number(),
  }).index('by_companyId_and_createdAt', ['companyId', 'createdAt']),

  /** Platform-staff notes on an organization (never shown to the tenant). */
  tenantNotes: defineTable({
    companyId: v.id('companies'),
    body: v.string(),
    authorId: v.id('users'),
    createdAt: v.number(),
  }).index('by_companyId_and_createdAt', ['companyId', 'createdAt']),

  /**
   * Platform audit log: every console mutation and billing transition. Rows
   * about one organization are also written to its hash-chained auditLogs so
   * its admins see platform actions (ORG-006).
   */
  platformEvents: defineTable({
    /** Absent for system jobs (billing cron). */
    actorId: v.optional(v.id('users')),
    action: v.string(),
    companyId: v.optional(v.id('companies')),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    details: v.optional(v.any()),
    at: v.number(),
  })
    .index('by_at', ['at'])
    .index('by_companyId_and_at', ['companyId', 'at']),

  /** Per-organization usage per UTC day, written by the usage rollup cron. */
  platformUsageDaily: defineTable({
    companyId: v.id('companies'),
    /** YYYY-MM-DD (UTC). */
    date: v.string(),
    dailyRecords: v.number(),
    /** Distinct people with an audited change that day (ids capped at MAX_ACTIVE_USER_IDS). */
    activeUsers: v.number(),
    activeUserIds: v.array(v.id('users')),
    smsSent: v.number(),
    whatsappSent: v.number(),
    emailSent: v.number(),
    aiCalls: v.number(),
    aiTokens: v.number(),
    aiCostUsd: v.number(),
    computedAt: v.number(),
  })
    .index('by_companyId_and_date', ['companyId', 'date'])
    .index('by_date', ['date']),
}
