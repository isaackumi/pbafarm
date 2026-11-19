/**
 * Pure billing rules (PLAT-105, PLAT-108). No database access: the cron,
 * the console and the tests share these.
 */
import type { Doc } from '../_generated/dataModel'
import type { Limits } from '../lib/planLimits'

export const DAY_MS = 86_400_000
export const DEFAULT_GRACE_DAYS = 7
export const MAX_INVOICE_LINES = 50
export const BILLING_CURRENCIES = ['GHS', 'XOF', 'USD'] as const

/** Days a past_due subscription keeps access before suspension (env BILLING_GRACE_DAYS, 0–90). */
export function graceDays(raw: string | undefined = process.env.BILLING_GRACE_DAYS): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 90 ? Math.floor(n) : DEFAULT_GRACE_DAYS
}

/** `from` plus one billing interval (calendar month / year, UTC). */
export function addInterval(from: number, interval: 'month' | 'year', count = 1): number {
  const d = new Date(from)
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + count)
  else d.setUTCMonth(d.getUTCMonth() + count)
  return d.getTime()
}

export type SubscriptionPatch = Partial<
  Pick<Doc<'subscriptions'>, 'status' | 'pastDueAt' | 'graceEndsAt' | 'suspendedAt' | 'updatedAt'>
>

export type Transition = {
  from: Doc<'subscriptions'>['status']
  to: Doc<'subscriptions'>['status']
  reason: 'trial_ended' | 'period_ended' | 'grace_ended'
  patch: SubscriptionPatch
}

/**
 * The daily cron's rule for one subscription at `now`:
 * - trialing, trial over                 → past_due (grace starts)
 * - active (manual), period over unpaid  → past_due (grace starts)
 * - past_due, grace over                 → suspended (organization suspended)
 * Anything else: no change (null).
 */
export function nextTransition(
  sub: Pick<Doc<'subscriptions'>, 'status' | 'trialEndsAt' | 'currentPeriodEnd' | 'graceEndsAt' | 'provider'>,
  now: number,
  grace = DEFAULT_GRACE_DAYS,
): Transition | null {
  const toPastDue = (reason: Transition['reason']): Transition => ({
    from: sub.status,
    to: 'past_due',
    reason,
    patch: { status: 'past_due', pastDueAt: now, graceEndsAt: now + grace * DAY_MS, updatedAt: now },
  })
  switch (sub.status) {
    case 'trialing':
      return sub.trialEndsAt !== undefined && sub.trialEndsAt <= now ? toPastDue('trial_ended') : null
    case 'active':
      // Card providers renew themselves and report failures by webhook.
      return sub.provider === 'manual' && sub.currentPeriodEnd <= now ? toPastDue('period_ended') : null
    case 'past_due':
      return sub.graceEndsAt !== undefined && sub.graceEndsAt <= now
        ? { from: 'past_due', to: 'suspended', reason: 'grace_ended', patch: { status: 'suspended', suspendedAt: now, updatedAt: now } }
        : null
    default:
      return null
  }
}

/**
 * Period after an invoice for this subscription is paid in full: the
 * invoice's own period when it has one, otherwise one interval from the
 * later of now and the current period end (paying early does not lose days).
 */
export function renewedPeriod(
  sub: Pick<Doc<'subscriptions'>, 'currentPeriodEnd' | 'status'>,
  interval: 'month' | 'year',
  now: number,
  invoice?: Pick<Doc<'billingInvoices'>, 'periodStart' | 'periodEnd'>,
): { currentPeriodStart: number; currentPeriodEnd: number } {
  if (invoice?.periodStart !== undefined && invoice.periodEnd !== undefined && invoice.periodEnd > now) {
    return { currentPeriodStart: invoice.periodStart, currentPeriodEnd: invoice.periodEnd }
  }
  const start = sub.status === 'active' && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
  return { currentPeriodStart: start, currentPeriodEnd: addInterval(start, interval) }
}

export function invoiceTotal(lines: { quantity: number; unitAmountMinor: number }[]): number {
  return lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitAmountMinor), 0)
}

/** Monthly recurring amount of a plan price (yearly prices / 12), in minor units. */
export function monthlyAmount(amountMinor: number, interval: 'month' | 'year'): number {
  return interval === 'year' ? Math.round(amountMinor / 12) : amountMinor
}

/** Usage health 0–100 for the tenants list: recent activity, billing state, limit pressure. */
export function healthScore(input: {
  status: Doc<'subscriptions'>['status'] | 'none'
  suspended: boolean
  daysSinceActivity: number | null
  activeUsers30d: number
  members: number
}): number {
  if (input.suspended || input.status === 'suspended' || input.status === 'cancelled') return 0
  let score = 100
  if (input.daysSinceActivity === null) score -= 50
  else if (input.daysSinceActivity > 30) score -= 45
  else if (input.daysSinceActivity > 7) score -= 25
  else if (input.daysSinceActivity > 2) score -= 10
  if (input.status === 'past_due') score -= 30
  if (input.members > 0) {
    const engagement = Math.min(1, input.activeUsers30d / input.members)
    score -= Math.round((1 - engagement) * 20)
  }
  return Math.max(0, Math.min(100, score))
}

export type PlanSeed = {
  code: string
  name: string
  description: string
  prices: { currency: string; amountMinor: number }[]
  interval: 'month' | 'year'
  limits: Limits
  features: Record<string, boolean>
  trialDays: number
  isDefault: boolean
  sortOrder: number
}

/** Plans created when none exist (backfill, console "seed defaults"). Prices are placeholders for the owner to set. */
export const DEFAULT_PLANS: PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'One farm site, small team.',
    prices: [
      { currency: 'GHS', amountMinor: 25_000 },
      { currency: 'XOF', amountMinor: 12_500 },
      { currency: 'USD', amountMinor: 2_000 },
    ],
    interval: 'month',
    limits: { sites: 1, users: 5, units: 20, aiCredits: 100, smsIncluded: 50 },
    features: { ai_assistant: true, sms_alerts: true, whatsapp: false, public_api: false, webhooks: false, hatchery: false, multi_site_reports: false },
    trialDays: 14,
    isDefault: true,
    sortOrder: 10,
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'Several sites, integrations and WhatsApp alerts.',
    prices: [
      { currency: 'GHS', amountMinor: 75_000 },
      { currency: 'XOF', amountMinor: 37_500 },
      { currency: 'USD', amountMinor: 6_000 },
    ],
    interval: 'month',
    limits: { sites: 5, users: 25, units: 150, aiCredits: 1_000, smsIncluded: 500 },
    features: { ai_assistant: true, sms_alerts: true, whatsapp: true, public_api: true, webhooks: true, hatchery: true, multi_site_reports: true },
    trialDays: 14,
    isDefault: false,
    sortOrder: 20,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'No limits; invoiced yearly.',
    prices: [
      { currency: 'GHS', amountMinor: 2_500_000 },
      { currency: 'XOF', amountMinor: 1_250_000 },
      { currency: 'USD', amountMinor: 200_000 },
    ],
    interval: 'year',
    limits: {},
    features: { ai_assistant: true, sms_alerts: true, whatsapp: true, public_api: true, webhooks: true, hatchery: true, multi_site_reports: true },
    trialDays: 30,
    isDefault: false,
    sortOrder: 30,
  },
]

/** Currency to bill an organization in: its own when the plan has a price in it, else the plan's first. */
export function billingCurrency(plan: Pick<Doc<'plans'>, 'prices'>, preferred: string | undefined): string {
  if (preferred && plan.prices.some((p) => p.currency === preferred)) return preferred
  return plan.prices[0]?.currency ?? 'USD'
}

export function priceIn(plan: Pick<Doc<'plans'>, 'prices'>, currency: string): number | null {
  return plan.prices.find((p) => p.currency === currency)?.amountMinor ?? null
}
