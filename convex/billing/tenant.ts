/**
 * Tenant-facing billing (PLAT-113): the /billing page for organization
 * owners. Readable while the organization is suspended, so the owner can see
 * what is owed and pay.
 */
import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireUser } from '../lib/authz'
import { memberContext, requirePermission } from '../lib/permissions'
import { countUsage, entitlements, LIMIT_LABELS, type LimitKind } from '../lib/planLimits'
import { billingInterval, invoiceStatus, subscriptionStatus } from './tables'
import { priceIn } from './model'

export const myBilling = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      companyName: v.string(),
      suspended: v.boolean(),
      suspensionReason: v.union(v.string(), v.null()),
      plan: v.union(
        v.null(),
        v.object({
          code: v.string(),
          name: v.string(),
          description: v.union(v.string(), v.null()),
          interval: billingInterval,
          currency: v.string(),
          amountMinor: v.union(v.number(), v.null()),
        }),
      ),
      status: v.union(subscriptionStatus, v.literal('none')),
      currentPeriodEnd: v.union(v.number(), v.null()),
      trialEndsAt: v.union(v.number(), v.null()),
      graceEndsAt: v.union(v.number(), v.null()),
      limits: v.array(v.object({ kind: v.string(), label: v.string(), used: v.number(), max: v.union(v.number(), v.null()) })),
      features: v.record(v.string(), v.boolean()),
      invoices: v.array(
        v.object({
          id: v.id('billingInvoices'),
          number: v.string(),
          currency: v.string(),
          totalMinor: v.number(),
          paidMinor: v.number(),
          status: invoiceStatus,
          issuedAt: v.number(),
          dueAt: v.number(),
        }),
      ),
      paymentInstructions: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx, { allowSuspended: true })
    const m = await memberContext(ctx, user)
    if (!m.companyId) return null
    requirePermission(m, 'org.settings.manage')
    const company = await ctx.db.get(m.companyId)
    if (!company) return null
    const ent = await entitlements(ctx, m.companyId)
    const sub = ent.subscription
    const since = sub?.currentPeriodStart ?? 0
    const limits = []
    for (const kind of Object.keys(LIMIT_LABELS) as LimitKind[]) {
      const max = ent.limits[kind]
      limits.push({
        kind,
        label: LIMIT_LABELS[kind].many,
        used: await countUsage(ctx, m.companyId, kind, (max ?? 500) + 1, since),
        max: max ?? null,
      })
    }
    const invoices = (
      await ctx.db
        .query('billingInvoices')
        .withIndex('by_companyId_and_issuedAt', (q) => q.eq('companyId', m.companyId!))
        .order('desc')
        .take(24)
    )
      .filter((i) => i.status !== 'void')
      .map((i) => ({
        id: i._id,
        number: i.number,
        currency: i.currency,
        totalMinor: i.totalMinor,
        paidMinor: i.paidMinor,
        status: i.status,
        issuedAt: i.issuedAt,
        dueAt: i.dueAt,
      }))
    return {
      companyName: company.name,
      suspended: company.suspendedAt !== undefined,
      suspensionReason: company.suspendedAt !== undefined ? (company.suspensionReason ?? null) : null,
      plan:
        ent.plan && sub
          ? {
              code: ent.plan.code,
              name: ent.plan.name,
              description: ent.plan.description ?? null,
              interval: ent.plan.interval,
              currency: sub.currency,
              amountMinor: priceIn(ent.plan, sub.currency),
            }
          : null,
      status: sub?.status ?? ('none' as const),
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
      graceEndsAt: sub?.graceEndsAt ?? null,
      limits,
      features: ent.features,
      invoices,
      // Manual collection today (BillingProvider 'manual'): set BILLING_PAYMENT_INSTRUCTIONS on the deployment.
      paymentInstructions: process.env.BILLING_PAYMENT_INSTRUCTIONS?.trim() || null,
    }
  },
})
