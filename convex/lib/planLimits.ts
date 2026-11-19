/**
 * Plan entitlements (PLAT-106, docs/architecture/22-platform-console-billing.md §4).
 *
 * An organization's limits and feature flags are its plan's, with the
 * subscription's per-tenant overrides on top. A missing limit is unlimited.
 * An organization without a subscription (created before billing, before the
 * backfill ran) is not limited.
 *
 * Counts are bounded: each count reads at most `limit + 1` rows, so the check
 * costs the same however large an unlimited competitor's tables are.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { userError } from './errors'

type Ctx = QueryCtx | MutationCtx

export type LimitKind = 'sites' | 'users' | 'units' | 'aiCredits' | 'smsIncluded'

export const LIMIT_LABELS: Record<LimitKind, { one: string; many: string }> = {
  sites: { one: 'site', many: 'sites' },
  users: { one: 'active member', many: 'active members' },
  units: { one: 'unit', many: 'units' },
  aiCredits: { one: 'assistant credit', many: 'assistant credits' },
  smsIncluded: { one: 'SMS', many: 'SMS' },
}

/** Feature flag keys the app checks (plans may carry others). */
export const FEATURE_KEYS = ['ai_assistant', 'public_api', 'webhooks', 'sms_alerts', 'whatsapp', 'hatchery', 'multi_site_reports'] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export type Limits = Partial<Record<LimitKind, number>>

export type Entitlements = {
  subscription: Doc<'subscriptions'> | null
  plan: Doc<'plans'> | null
  limits: Limits
  features: Record<string, boolean>
}

/** The organization's subscription (latest row), or null. */
export async function currentSubscription(ctx: Ctx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('subscriptions')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .order('desc')
    .first()
}

/** Plan limits with overrides applied, and credits granted added to the credit limits. */
export function mergeLimits(plan: Pick<Doc<'plans'>, 'limits'> | null, sub: Doc<'subscriptions'> | null): Limits {
  const out: Limits = { ...(plan?.limits ?? {}) }
  for (const [k, value] of Object.entries(sub?.limitOverrides ?? {})) {
    if (value !== undefined) out[k as LimitKind] = value
  }
  if (out.aiCredits !== undefined && sub?.aiCreditsGranted) out.aiCredits += sub.aiCreditsGranted
  if (out.smsIncluded !== undefined && sub?.smsCreditsGranted) out.smsIncluded += sub.smsCreditsGranted
  return out
}

export async function entitlements(ctx: Ctx, companyId: Id<'companies'>): Promise<Entitlements> {
  const subscription = await currentSubscription(ctx, companyId)
  if (!subscription) return { subscription: null, plan: null, limits: {}, features: {} }
  const plan = await ctx.db.get(subscription.planId)
  return {
    subscription,
    plan,
    limits: mergeLimits(plan, subscription),
    features: { ...(plan?.features ?? {}), ...(subscription.featureOverrides ?? {}) },
  }
}

/**
 * Current usage for one limit, counting at most `cap` rows (pass the limit;
 * the answer is exact below it and `cap` at or above it).
 */
export async function countUsage(
  ctx: Ctx,
  companyId: Id<'companies'>,
  kind: LimitKind,
  cap: number,
  since = 0,
): Promise<number> {
  let n = 0
  switch (kind) {
    case 'sites':
      for await (const row of ctx.db.query('farmLocations').withIndex('by_company', (q) => q.eq('companyId', companyId))) {
        if (row.active !== false) n += 1
        if (n >= cap) break
      }
      return n
    case 'users':
      for await (const row of ctx.db.query('memberships').withIndex('by_companyId', (q) => q.eq('companyId', companyId))) {
        if (row.status === 'active') n += 1
        if (n >= cap) break
      }
      return n
    case 'units':
      for await (const _row of ctx.db.query('cages').withIndex('by_company', (q) => q.eq('companyId', companyId))) {
        n += 1
        if (n >= cap) break
      }
      return n
    case 'aiCredits':
      // One credit per assistant call on the platform's key this period.
      for await (const row of ctx.db
        .query('llmUsage')
        .withIndex('by_companyId_and_createdAt', (q) => q.eq('companyId', companyId).gte('createdAt', since))) {
        if (row.source === 'server_key') n += 1
        if (n >= cap) break
      }
      return n
    case 'smsIncluded':
      for await (const row of ctx.db
        .query('notificationDispatches')
        .withIndex('by_company_and_createdAt', (q) => q.eq('companyId', companyId).gte('createdAt', since))) {
        for (const d of row.deliveries) if (d.channel === 'sms' && d.status === 'sent') n += 1
        if (n >= cap) break
      }
      return Math.min(n, cap)
  }
}

/**
 * Refuse a create that would take the organization past its plan limit, with
 * a message the owner can act on. `adding` is how many the create adds.
 */
export async function assertPlanLimit(
  ctx: Ctx,
  companyId: Id<'companies'> | undefined | null,
  kind: LimitKind,
  adding = 1,
): Promise<void> {
  if (!companyId) return
  const ent = await entitlements(ctx, companyId)
  const max = ent.limits[kind]
  if (max === undefined) return
  const since = ent.subscription?.currentPeriodStart ?? 0
  const used = await countUsage(ctx, companyId, kind, max + 1, since)
  if (used + adding > max) {
    const label = LIMIT_LABELS[kind]
    const planName = ent.plan?.name ?? 'current'
    throw userError(
      'FORBIDDEN',
      `Your ${planName} plan includes ${max} ${max === 1 ? label.one : label.many}. ` +
        `An owner can upgrade on the Billing page to add more.`,
      { reason: 'PLAN_LIMIT', limit: kind, max, used },
    )
  }
}

/** Whether a feature is on for the organization. No subscription: every feature on (pre-billing behaviour). */
export async function hasFeature(ctx: Ctx, companyId: Id<'companies'>, feature: FeatureKey | string): Promise<boolean> {
  const ent = await entitlements(ctx, companyId)
  if (!ent.subscription) return true
  return ent.features[feature] === true
}

/** Throw unless the feature is on. */
export async function assertFeature(ctx: Ctx, companyId: Id<'companies'>, feature: FeatureKey | string, label?: string) {
  if (await hasFeature(ctx, companyId, feature)) return
  throw userError('FORBIDDEN', `${label ?? 'This feature'} is not included in your plan. An owner can upgrade on the Billing page.`, {
    reason: 'PLAN_FEATURE',
    feature,
  })
}
