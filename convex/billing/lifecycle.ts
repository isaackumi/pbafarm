/**
 * Subscription lifecycle (PLAT-108): the daily billing cron, and the
 * backfill that gives every existing organization a subscription (PLAT-109).
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { currentSubscription } from '../lib/planLimits'
import { graceDays, nextTransition, priceIn, type Transition } from './model'
import {
  createInvoice,
  ensureDefaultPlans,
  notifyBilling,
  recordPlatformEvent,
  startSubscription,
  suspendCompany,
} from './ops'

const BATCH = 100

async function openInvoiceFor(ctx: MutationCtx, sub: Doc<'subscriptions'>) {
  for await (const inv of ctx.db
    .query('billingInvoices')
    .withIndex('by_companyId_and_issuedAt', (q) => q.eq('companyId', sub.companyId))
    .order('desc')) {
    if (inv.subscriptionId === sub._id && inv.status === 'open') return inv
    if (inv.issuedAt < sub.currentPeriodStart) break
  }
  return null
}

async function applyTransition(ctx: MutationCtx, sub: Doc<'subscriptions'>, t: Transition, grace: number) {
  await ctx.db.patch(sub._id, t.patch)
  const plan = await ctx.db.get(sub.planId)
  let invoiceNumber: string | null = null
  if (t.to === 'past_due' && plan) {
    // Renewal invoice for the next period, due when grace ends (once).
    const existing = await openInvoiceFor(ctx, sub)
    const amount = priceIn(plan, sub.currency)
    if (existing) invoiceNumber = existing.number
    else if (amount !== null && amount > 0) {
      const inv = await createInvoice(ctx, {
        companyId: sub.companyId,
        subscriptionId: sub._id,
        currency: sub.currency,
        lines: [{ description: `${plan.name} plan (${plan.interval})`, quantity: Math.max(1, sub.seats ?? 1), unitAmountMinor: amount }],
        dueInDays: grace,
      })
      invoiceNumber = inv.number
    }
  }
  if (t.to === 'suspended') {
    await suspendCompany(ctx, sub.companyId, { source: 'billing', reason: 'Unpaid after the grace period' })
  }
  await recordPlatformEvent(ctx, {
    action: `subscription.${t.to}`,
    companyId: sub.companyId,
    targetTable: 'subscriptions',
    targetId: sub._id,
    details: { from: t.from, to: t.to, reason: t.reason, invoiceNumber },
  })
  const when = t.patch.graceEndsAt ? new Date(t.patch.graceEndsAt).toISOString().slice(0, 10) : null
  if (t.to === 'past_due') {
    await notifyBilling(ctx, sub.companyId, {
      title: t.reason === 'trial_ended' ? 'Your PBA Farm trial has ended' : 'Your PBA Farm plan is due for renewal',
      message:
        `Pay ${invoiceNumber ? `invoice ${invoiceNumber}` : 'your plan'} by ${when} to keep access. ` +
        'Open Billing for the amount and how to pay.',
      dedupeKey: `billing.past_due.${sub._id}.${t.patch.pastDueAt}`,
    })
  } else if (t.to === 'suspended') {
    await notifyBilling(ctx, sub.companyId, {
      title: 'PBA Farm access suspended',
      message: 'Your organization was suspended because the plan was not paid. Pay the open invoice on the Billing page to restore access.',
      level: 'error',
      dedupeKey: `billing.suspended.${sub._id}.${t.patch.suspendedAt}`,
    })
  }
}

/** Daily cron: trial over → past_due; period over (manual) → past_due; grace over → suspended. */
export const runDaily = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ pastDue: v.number(), suspended: v.number(), more: v.boolean() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    const grace = graceDays()
    let pastDue = 0
    let suspended = 0
    const trials = await ctx.db
      .query('subscriptions')
      .withIndex('by_status_and_trialEndsAt', (q) => q.eq('status', 'trialing').lte('trialEndsAt', now))
      .take(BATCH)
    const renewals = await ctx.db
      .query('subscriptions')
      .withIndex('by_status_and_currentPeriodEnd', (q) => q.eq('status', 'active').lte('currentPeriodEnd', now))
      .take(BATCH)
    const graceOver = await ctx.db
      .query('subscriptions')
      .withIndex('by_status_and_graceEndsAt', (q) => q.eq('status', 'past_due').lte('graceEndsAt', now))
      .take(BATCH)
    for (const sub of [...trials, ...renewals, ...graceOver]) {
      const t = nextTransition(sub, now, grace)
      if (!t) continue
      await applyTransition(ctx, sub, t, grace)
      if (t.to === 'past_due') pastDue += 1
      else if (t.to === 'suspended') suspended += 1
    }
    const more = trials.length === BATCH || renewals.length === BATCH || graceOver.length === BATCH
    if (more) await ctx.scheduler.runAfter(0, internal.billing.lifecycle.runDaily, { now })
    return { pastDue, suspended, more }
  },
})

/**
 * Give every approved organization without a subscription one on a plan
 * (default: the default plan), dry run by default:
 *   npx convex run billing/lifecycle:backfillSubscriptions '{}'                 # report only
 *   npx convex run billing/lifecycle:backfillSubscriptions '{"dryRun":false}'   # write
 * `status` 'active' (default) starts a paid period now; 'trialing' starts the plan's trial.
 */
export const backfillSubscriptions = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    planCode: v.optional(v.string()),
    status: v.optional(v.union(v.literal('active'), v.literal('trialing'))),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    dryRun: v.boolean(),
    scanned: v.number(),
    wouldCreate: v.number(),
    created: v.number(),
    planCode: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false
    let plan: Doc<'plans'> | null = null
    if (args.planCode) {
      plan = await ctx.db
        .query('plans')
        .withIndex('by_code', (q) => q.eq('code', args.planCode!))
        .first()
      if (!plan) throw new Error(`No plan with code ${args.planCode}`)
    } else if (!dryRun) {
      plan = await ensureDefaultPlans(ctx)
    } else {
      plan = await ctx.db
        .query('plans')
        .withIndex('by_isDefault', (q) => q.eq('isDefault', true))
        .first()
    }
    const page = await ctx.db.query('companies').paginate({ numItems: BATCH, cursor: args.cursor ?? null })
    let wouldCreate = 0
    let created = 0
    for (const company of page.page) {
      if (company.status !== 'approved') continue
      if (await currentSubscription(ctx, company._id)) continue
      wouldCreate += 1
      if (!dryRun && plan) {
        const id = await startSubscription(ctx, company._id, plan, { status: args.status ?? 'active' })
        await recordPlatformEvent(ctx, {
          action: 'subscription.backfilled',
          companyId: company._id,
          targetTable: 'subscriptions',
          targetId: id,
          details: { planCode: plan.code, status: args.status ?? 'active' },
        })
        created += 1
      }
    }
    if (!dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.billing.lifecycle.backfillSubscriptions, {
        dryRun: false,
        planCode: args.planCode,
        status: args.status,
        cursor: page.continueCursor,
      })
    }
    return {
      dryRun,
      scanned: page.page.length,
      wouldCreate,
      created,
      planCode: plan?.code ?? (dryRun ? 'starter (created on first real run)' : null),
      isDone: page.isDone,
    }
  },
})
