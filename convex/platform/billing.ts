/** Platform console: plans, subscriptions, invoices, payments, dunning (PLAT-105, PLAT-107). */
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireConsoleAdmin } from './access'
import { userError } from '../lib/errors'
import { isCurrencyCode } from '../lib/currencies'
import { billingInterval, invoiceLine, invoiceStatus, paymentMethod, planLimits, planPrice, subscriptionStatus } from '../billing/tables'
import { MAX_INVOICE_LINES } from '../billing/model'
import { applyPayment, createInvoice, ensureDefaultPlans, recordPlatformEvent } from '../billing/ops'

const planRow = v.object({
  id: v.id('plans'),
  code: v.string(),
  name: v.string(),
  description: v.union(v.string(), v.null()),
  prices: v.array(planPrice),
  interval: billingInterval,
  limits: planLimits,
  features: v.record(v.string(), v.boolean()),
  trialDays: v.number(),
  isDefault: v.boolean(),
  active: v.boolean(),
  sortOrder: v.number(),
})

async function companyName(ctx: QueryCtx, id: Id<'companies'>, cache: Map<Id<'companies'>, string>) {
  if (!cache.has(id)) cache.set(id, (await ctx.db.get(id))?.name ?? 'Deleted organization')
  return cache.get(id)!
}

export const listPlans = query({
  args: {},
  returns: v.array(planRow),
  handler: async (ctx) => {
    await requireConsoleAdmin(ctx)
    const plans = await ctx.db.query('plans').take(200)
    return plans
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({
        id: p._id,
        code: p.code,
        name: p.name,
        description: p.description ?? null,
        prices: p.prices,
        interval: p.interval,
        limits: p.limits,
        features: p.features,
        trialDays: p.trialDays,
        isDefault: p.isDefault,
        active: p.active,
        sortOrder: p.sortOrder,
      }))
  },
})

const planInput = {
  name: v.string(),
  description: v.optional(v.string()),
  prices: v.array(planPrice),
  interval: billingInterval,
  limits: planLimits,
  features: v.record(v.string(), v.boolean()),
  trialDays: v.number(),
  isDefault: v.boolean(),
  active: v.boolean(),
  sortOrder: v.number(),
}

function validatePlan(p: { name: string; prices: { currency: string; amountMinor: number }[]; trialDays: number; limits: Record<string, number | undefined> }) {
  if (!p.name.trim()) throw userError('VALIDATION', 'Name is required', { field: 'name' })
  if (!p.prices.length) throw userError('VALIDATION', 'Add at least one price', { field: 'prices' })
  const seen = new Set<string>()
  for (const price of p.prices) {
    if (!isCurrencyCode(price.currency)) throw userError('VALIDATION', `Unknown currency ${price.currency}`, { field: 'prices' })
    if (seen.has(price.currency)) throw userError('VALIDATION', `Two prices in ${price.currency}`, { field: 'prices' })
    seen.add(price.currency)
    if (!Number.isInteger(price.amountMinor) || price.amountMinor < 0) {
      throw userError('VALIDATION', 'Prices are whole minor units of 0 or more', { field: 'prices' })
    }
  }
  if (!Number.isInteger(p.trialDays) || p.trialDays < 0 || p.trialDays > 365) {
    throw userError('VALIDATION', 'Trial days must be 0–365', { field: 'trialDays' })
  }
  for (const value of Object.values(p.limits)) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw userError('VALIDATION', 'Limits are whole numbers of 0 or more', { field: 'limits' })
    }
  }
}

async function clearOtherDefaults(ctx: Parameters<typeof ensureDefaultPlans>[0], keep: Id<'plans'>) {
  for (const p of await ctx.db
    .query('plans')
    .withIndex('by_isDefault', (q) => q.eq('isDefault', true))
    .take(20)) {
    if (p._id !== keep) await ctx.db.patch(p._id, { isDefault: false, updatedAt: Date.now() })
  }
}

export const createPlan = mutation({
  args: { code: v.string(), ...planInput },
  returns: v.id('plans'),
  handler: async (ctx, args) => {
    const admin = await requireConsoleAdmin(ctx)
    const code = args.code.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)) {
      throw userError('VALIDATION', 'Code: 2–40 lowercase letters, digits, - or _', { field: 'code' })
    }
    validatePlan(args)
    const dup = await ctx.db
      .query('plans')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (dup) throw userError('DUPLICATE', 'A plan with this code exists', { field: 'code' })
    const now = Date.now()
    const id = await ctx.db.insert('plans', { ...args, code, name: args.name.trim(), createdAt: now, updatedAt: now })
    if (args.isDefault) await clearOtherDefaults(ctx, id)
    await recordPlatformEvent(ctx, { actorId: admin._id, action: 'plan.created', targetTable: 'plans', targetId: id, details: { code } })
    return id
  },
})

/** Edit a plan. Code is fixed; prices apply to the next invoice. */
export const updatePlan = mutation({
  args: { planId: v.id('plans'), ...planInput },
  returns: v.null(),
  handler: async (ctx, { planId, ...rest }) => {
    const admin = await requireConsoleAdmin(ctx)
    const plan = await ctx.db.get(planId)
    if (!plan) throw userError('NOT_FOUND', 'Plan not found')
    validatePlan(rest)
    if (plan.isDefault && !rest.isDefault) {
      throw userError('CONFLICT', 'Make another plan the default first')
    }
    if (rest.isDefault && !rest.active) throw userError('VALIDATION', 'The default plan must be active')
    await ctx.db.patch(planId, { ...rest, name: rest.name.trim(), updatedAt: Date.now() })
    if (rest.isDefault) await clearOtherDefaults(ctx, planId)
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'plan.updated',
      targetTable: 'plans',
      targetId: planId,
      details: { code: plan.code, before: { prices: plan.prices, limits: plan.limits, active: plan.active }, after: { prices: rest.prices, limits: rest.limits, active: rest.active } },
    })
    return null
  },
})

/** Create the default plan set (Starter / Growth / Enterprise) when there are no plans. */
export const seedDefaultPlans = mutation({
  args: {},
  returns: v.id('plans'),
  handler: async (ctx) => {
    const admin = await requireConsoleAdmin(ctx)
    const had = await ctx.db.query('plans').first()
    const plan = await ensureDefaultPlans(ctx)
    if (!had) await recordPlatformEvent(ctx, { actorId: admin._id, action: 'plan.defaults_seeded', targetTable: 'plans' })
    return plan._id
  },
})

export const listSubscriptions = query({
  args: { status: v.optional(subscriptionStatus) },
  returns: v.array(
    v.object({
      id: v.id('subscriptions'),
      companyId: v.id('companies'),
      companyName: v.string(),
      planName: v.string(),
      status: subscriptionStatus,
      currency: v.string(),
      currentPeriodEnd: v.number(),
      trialEndsAt: v.union(v.number(), v.null()),
      graceEndsAt: v.union(v.number(), v.null()),
      provider: v.string(),
    }),
  ),
  handler: async (ctx, { status }) => {
    await requireConsoleAdmin(ctx)
    const rows = status
      ? await ctx.db
          .query('subscriptions')
          .withIndex('by_status', (q) => q.eq('status', status))
          .order('desc')
          .take(300)
      : await ctx.db.query('subscriptions').order('desc').take(300)
    const names = new Map<Id<'companies'>, string>()
    const out = []
    for (const s of rows) {
      out.push({
        id: s._id,
        companyId: s.companyId,
        companyName: await companyName(ctx, s.companyId, names),
        planName: (await ctx.db.get(s.planId))?.name ?? 'Unknown plan',
        status: s.status,
        currency: s.currency,
        currentPeriodEnd: s.currentPeriodEnd,
        trialEndsAt: s.trialEndsAt ?? null,
        graceEndsAt: s.graceEndsAt ?? null,
        provider: s.provider,
      })
    }
    return out
  },
})

const invoiceRow = v.object({
  id: v.id('billingInvoices'),
  companyId: v.id('companies'),
  companyName: v.string(),
  number: v.string(),
  currency: v.string(),
  totalMinor: v.number(),
  paidMinor: v.number(),
  status: invoiceStatus,
  issuedAt: v.number(),
  dueAt: v.number(),
})

export const listInvoices = query({
  args: { status: v.optional(invoiceStatus) },
  returns: v.array(invoiceRow),
  handler: async (ctx, { status }) => {
    await requireConsoleAdmin(ctx)
    const rows = status
      ? await ctx.db
          .query('billingInvoices')
          .withIndex('by_status_and_dueAt', (q) => q.eq('status', status))
          .order('desc')
          .take(300)
      : await ctx.db.query('billingInvoices').withIndex('by_issuedAt').order('desc').take(300)
    const names = new Map<Id<'companies'>, string>()
    const out = []
    for (const i of rows) {
      out.push({
        id: i._id,
        companyId: i.companyId,
        companyName: await companyName(ctx, i.companyId, names),
        number: i.number,
        currency: i.currency,
        totalMinor: i.totalMinor,
        paidMinor: i.paidMinor,
        status: i.status,
        issuedAt: i.issuedAt,
        dueAt: i.dueAt,
      })
    }
    return out
  },
})

export const createInvoiceForTenant = mutation({
  args: {
    companyId: v.id('companies'),
    currency: v.string(),
    lines: v.array(invoiceLine),
    dueInDays: v.number(),
    /** Attach to the tenant's subscription: paying it in full renews the plan. */
    renewsSubscription: v.boolean(),
  },
  returns: v.object({ id: v.id('billingInvoices'), number: v.string() }),
  handler: async (ctx, args) => {
    const admin = await requireConsoleAdmin(ctx)
    if (!(await ctx.db.get(args.companyId))) throw userError('NOT_FOUND', 'Organization not found')
    if (!isCurrencyCode(args.currency)) throw userError('VALIDATION', 'Unknown currency', { field: 'currency' })
    if (!args.lines.length || args.lines.length > MAX_INVOICE_LINES) {
      throw userError('VALIDATION', `1–${MAX_INVOICE_LINES} lines`, { field: 'lines' })
    }
    for (const l of args.lines) {
      if (!l.description.trim() || !(l.quantity > 0) || !Number.isInteger(l.unitAmountMinor) || l.unitAmountMinor < 0) {
        throw userError('VALIDATION', 'Each line needs a description, a positive quantity and a whole amount', { field: 'lines' })
      }
    }
    if (!Number.isInteger(args.dueInDays) || args.dueInDays < 0 || args.dueInDays > 120) {
      throw userError('VALIDATION', 'Due in 0–120 days', { field: 'dueInDays' })
    }
    let subscriptionId: Id<'subscriptions'> | undefined
    if (args.renewsSubscription) {
      const sub = await ctx.db
        .query('subscriptions')
        .withIndex('by_companyId', (q) => q.eq('companyId', args.companyId))
        .order('desc')
        .first()
      if (!sub) throw userError('NOT_FOUND', 'This organization has no subscription to renew')
      subscriptionId = sub._id
    }
    const inv = await createInvoice(ctx, {
      companyId: args.companyId,
      subscriptionId,
      currency: args.currency,
      lines: args.lines,
      dueInDays: args.dueInDays,
      createdBy: admin._id,
    })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'invoice.created',
      companyId: args.companyId,
      targetTable: 'billingInvoices',
      targetId: inv._id,
      details: { number: inv.number, currency: inv.currency, totalMinor: inv.totalMinor },
    })
    return { id: inv._id, number: inv.number }
  },
})

export const voidInvoice = mutation({
  args: { invoiceId: v.id('billingInvoices'), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { invoiceId, reason }) => {
    const admin = await requireConsoleAdmin(ctx)
    const inv = await ctx.db.get(invoiceId)
    if (!inv) throw userError('NOT_FOUND', 'Invoice not found')
    if (inv.status !== 'open') throw userError('CONFLICT', 'Only an open invoice can be voided')
    if (inv.paidMinor > 0) throw userError('CONFLICT', 'This invoice has payments; refund them first')
    await ctx.db.patch(invoiceId, { status: 'void', voidedAt: Date.now() })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'invoice.voided',
      companyId: inv.companyId,
      targetTable: 'billingInvoices',
      targetId: invoiceId,
      details: { number: inv.number, reason: reason.trim() },
    })
    return null
  },
})

/**
 * Record a payment received outside a provider (bank transfer, mobile money,
 * cash). Idempotent by `idempotencyKey`: the console sends one key per form,
 * so a double click or retry records it once.
 */
export const recordPayment = mutation({
  args: {
    companyId: v.id('companies'),
    invoiceId: v.optional(v.id('billingInvoices')),
    currency: v.string(),
    amountMinor: v.number(),
    method: paymentMethod,
    providerRef: v.optional(v.string()),
    idempotencyKey: v.string(),
    receivedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.object({
    paymentId: v.id('billingPayments'),
    duplicate: v.boolean(),
    invoicePaid: v.boolean(),
    reactivated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const admin = await requireConsoleAdmin(ctx)
    const result = await applyPayment(ctx, { ...args, provider: 'manual', recordedBy: admin._id })
    if (!result.duplicate) {
      await recordPlatformEvent(ctx, {
        actorId: admin._id,
        action: 'payment.recorded',
        companyId: args.companyId,
        targetTable: 'billingPayments',
        targetId: result.paymentId,
        details: { currency: args.currency, amountMinor: args.amountMinor, method: args.method, invoicePaid: result.invoicePaid, reactivated: result.reactivated },
      })
    }
    return result
  },
})

export const listPayments = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('billingPayments'),
      companyId: v.id('companies'),
      companyName: v.string(),
      currency: v.string(),
      amountMinor: v.number(),
      method: paymentMethod,
      providerRef: v.union(v.string(), v.null()),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireConsoleAdmin(ctx)
    const names = new Map<Id<'companies'>, string>()
    const out = []
    for (const p of await ctx.db.query('billingPayments').withIndex('by_receivedAt').order('desc').take(300)) {
      out.push({
        id: p._id,
        companyId: p.companyId,
        companyName: await companyName(ctx, p.companyId, names),
        currency: p.currency,
        amountMinor: p.amountMinor,
        method: p.method,
        providerRef: p.providerRef ?? null,
        receivedAt: p.receivedAt,
      })
    }
    return out
  },
})

/** Dunning: past_due subscriptions, soonest suspension first, with what they owe. */
export const dunning = query({
  args: {},
  returns: v.array(
    v.object({
      subscriptionId: v.id('subscriptions'),
      companyId: v.id('companies'),
      companyName: v.string(),
      pastDueAt: v.union(v.number(), v.null()),
      graceEndsAt: v.union(v.number(), v.null()),
      owed: v.array(v.object({ currency: v.string(), amountMinor: v.number() })),
      openInvoices: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireConsoleAdmin(ctx)
    const names = new Map<Id<'companies'>, string>()
    const out = []
    for (const s of await ctx.db
      .query('subscriptions')
      .withIndex('by_status_and_graceEndsAt', (q) => q.eq('status', 'past_due'))
      .take(300)) {
      const owed = new Map<string, number>()
      let openInvoices = 0
      for (const inv of await ctx.db
        .query('billingInvoices')
        .withIndex('by_companyId_and_issuedAt', (q) => q.eq('companyId', s.companyId))
        .order('desc')
        .take(20)) {
        if (inv.status !== 'open') continue
        openInvoices += 1
        owed.set(inv.currency, (owed.get(inv.currency) ?? 0) + inv.totalMinor - inv.paidMinor)
      }
      out.push({
        subscriptionId: s._id,
        companyId: s.companyId,
        companyName: await companyName(ctx, s.companyId, names),
        pastDueAt: s.pastDueAt ?? null,
        graceEndsAt: s.graceEndsAt ?? null,
        owed: [...owed.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor })),
        openInvoices,
      })
    }
    return out
  },
})
