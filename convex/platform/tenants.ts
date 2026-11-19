/**
 * Platform console: tenants (PLAT-102, PLAT-103, PLAT-104).
 * Every function: requireConsoleAdmin (super_admin + verified second factor).
 * Every mutation: recordPlatformEvent (platform log + the tenant's own audit chain).
 */
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { requireConsoleAdmin } from './access'
import { userError } from '../lib/errors'
import { PLATFORM_SCAN_LIMIT } from '../lib/scope'
import { countUsage, entitlements, LIMIT_LABELS, type LimitKind } from '../lib/planLimits'
import { planLimits, subscriptionStatus } from '../billing/tables'
import { DAY_MS, healthScore } from '../billing/model'
import { recordPlatformEvent, startSubscription, suspendCompany, unsuspendCompany } from '../billing/ops'
import { revokeMemberSessions } from '../companies'
import { utcDate } from './usage'

const companyStatus = v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'))
const tenantState = v.union(v.literal('pending'), v.literal('active'), v.literal('suspended'), v.literal('rejected'))
const subStatusOrNone = v.union(subscriptionStatus, v.literal('none'))

function stateOf(c: Doc<'companies'>): 'pending' | 'active' | 'suspended' | 'rejected' {
  if (c.status === 'pending') return 'pending'
  if (c.status === 'rejected') return 'rejected'
  return c.suspendedAt !== undefined ? 'suspended' : 'active'
}

async function lastActivityAt(ctx: QueryCtx, companyId: Id<'companies'>): Promise<number | null> {
  const row = await ctx.db
    .query('auditLogs')
    .withIndex('by_companyId_and_seq', (q) => q.eq('companyId', companyId))
    .order('desc')
    .first()
  return row ? (row.at ?? row._creationTime) : null
}

async function activeUsers30d(ctx: QueryCtx, companyId: Id<'companies'>, now: number): Promise<number> {
  const ids = new Set<string>()
  for await (const r of ctx.db
    .query('platformUsageDaily')
    .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId).gte('date', utcDate(now - 30 * DAY_MS)))) {
    for (const id of r.activeUserIds) ids.add(id)
  }
  return ids.size
}

const tenantRow = v.object({
  companyId: v.id('companies'),
  name: v.string(),
  contactEmail: v.union(v.string(), v.null()),
  state: tenantState,
  createdAt: v.number(),
  planCode: v.union(v.string(), v.null()),
  planName: v.union(v.string(), v.null()),
  subscriptionStatus: subStatusOrNone,
  trialEndsAt: v.union(v.number(), v.null()),
  sites: v.number(),
  members: v.number(),
  lastActivityAt: v.union(v.number(), v.null()),
  activeUsers30d: v.number(),
  health: v.number(),
})

const PAGE = 50
const COUNT_CAP = 500

/**
 * Tenants list: filter and sort over the organizations (bounded scan of
 * companies + subscriptions), then the page's rows are enriched with counts,
 * last activity and health.
 */
export const list = query({
  args: {
    search: v.optional(v.string()),
    state: v.optional(tenantState),
    planCode: v.optional(v.string()),
    subscriptionStatus: v.optional(subStatusOrNone),
    sort: v.optional(v.union(v.literal('name'), v.literal('newest'), v.literal('oldest'), v.literal('trialEnding'))),
    offset: v.optional(v.number()),
  },
  returns: v.object({ rows: v.array(tenantRow), total: v.number(), offset: v.number(), pageSize: v.number(), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    await requireConsoleAdmin(ctx)
    const now = Date.now()
    const companies = await ctx.db.query('companies').take(PLATFORM_SCAN_LIMIT + 1)
    const truncated = companies.length > PLATFORM_SCAN_LIMIT
    const subs = new Map<Id<'companies'>, Doc<'subscriptions'>>()
    for await (const s of ctx.db.query('subscriptions')) {
      const prev = subs.get(s.companyId)
      if (!prev || prev._creationTime < s._creationTime) subs.set(s.companyId, s)
    }
    const plans = new Map((await ctx.db.query('plans').take(200)).map((p) => [p._id, p]))
    const needle = args.search?.trim().toLowerCase() ?? ''

    let rows = companies.slice(0, PLATFORM_SCAN_LIMIT).map((c) => {
      const sub = subs.get(c._id) ?? null
      const plan = sub ? (plans.get(sub.planId) ?? null) : null
      return { c, sub, plan }
    })
    rows = rows.filter(({ c, sub, plan }) => {
      if (args.state && stateOf(c) !== args.state) return false
      if (args.planCode && plan?.code !== args.planCode) return false
      if (args.subscriptionStatus && (sub?.status ?? 'none') !== args.subscriptionStatus) return false
      if (needle) {
        const hay = `${c.name} ${c.abbreviation ?? ''} ${c.contactEmail ?? ''} ${c._id}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    const sort = args.sort ?? 'newest'
    rows.sort((a, b) => {
      if (sort === 'name') return a.c.name.localeCompare(b.c.name)
      if (sort === 'oldest') return a.c._creationTime - b.c._creationTime
      if (sort === 'trialEnding') return (a.sub?.trialEndsAt ?? Infinity) - (b.sub?.trialEndsAt ?? Infinity)
      return b.c._creationTime - a.c._creationTime
    })
    const offset = Math.max(0, Math.floor(args.offset ?? 0))
    const page = rows.slice(offset, offset + PAGE)
    const out = []
    for (const { c, sub, plan } of page) {
      const [sites, members, last, active30] = await Promise.all([
        countUsage(ctx, c._id, 'sites', COUNT_CAP),
        countUsage(ctx, c._id, 'users', COUNT_CAP),
        lastActivityAt(ctx, c._id),
        activeUsers30d(ctx, c._id, now),
      ])
      out.push({
        companyId: c._id,
        name: c.name,
        contactEmail: c.contactEmail ?? null,
        state: stateOf(c),
        createdAt: c._creationTime,
        planCode: plan?.code ?? null,
        planName: plan?.name ?? null,
        subscriptionStatus: sub?.status ?? ('none' as const),
        trialEndsAt: sub?.trialEndsAt ?? null,
        sites,
        members,
        lastActivityAt: last,
        activeUsers30d: active30,
        health: healthScore({
          status: sub?.status ?? 'none',
          suspended: c.suspendedAt !== undefined,
          daysSinceActivity: last === null ? null : Math.floor((now - last) / DAY_MS),
          activeUsers30d: active30,
          members,
        }),
      })
    }
    return { rows: out, total: rows.length, offset, pageSize: PAGE, truncated }
  },
})

const limitsShape = v.object({
  sites: v.optional(v.number()),
  users: v.optional(v.number()),
  units: v.optional(v.number()),
  aiCredits: v.optional(v.number()),
  smsIncluded: v.optional(v.number()),
})

const usageDay = v.object({
  date: v.string(),
  dailyRecords: v.number(),
  activeUsers: v.number(),
  smsSent: v.number(),
  whatsappSent: v.number(),
  aiCalls: v.number(),
  aiTokens: v.number(),
  aiCostUsd: v.number(),
})

export const detail = query({
  args: { companyId: v.id('companies') },
  returns: v.union(
    v.null(),
    v.object({
      company: v.object({
        companyId: v.id('companies'),
        name: v.string(),
        abbreviation: v.union(v.string(), v.null()),
        contactEmail: v.union(v.string(), v.null()),
        contactPhone: v.union(v.string(), v.null()),
        address: v.union(v.string(), v.null()),
        status: companyStatus,
        state: tenantState,
        createdAt: v.number(),
        approvedAt: v.union(v.number(), v.null()),
        suspendedAt: v.union(v.number(), v.null()),
        suspensionReason: v.union(v.string(), v.null()),
        suspensionSource: v.union(v.literal('platform'), v.literal('billing'), v.null()),
        currency: v.union(v.string(), v.null()),
      }),
      subscription: v.union(
        v.null(),
        v.object({
          subscriptionId: v.id('subscriptions'),
          planId: v.id('plans'),
          planCode: v.string(),
          planName: v.string(),
          status: subscriptionStatus,
          currency: v.string(),
          currentPeriodStart: v.number(),
          currentPeriodEnd: v.number(),
          trialEndsAt: v.union(v.number(), v.null()),
          graceEndsAt: v.union(v.number(), v.null()),
          seats: v.union(v.number(), v.null()),
          provider: v.string(),
          limitOverrides: v.union(limitsShape, v.null()),
          featureOverrides: v.union(v.record(v.string(), v.boolean()), v.null()),
          aiCreditsGranted: v.number(),
          smsCreditsGranted: v.number(),
        }),
      ),
      limits: v.array(v.object({ kind: v.string(), label: v.string(), used: v.number(), max: v.union(v.number(), v.null()) })),
      features: v.record(v.string(), v.boolean()),
      sites: v.array(v.object({ id: v.id('farmLocations'), name: v.string(), code: v.union(v.string(), v.null()), active: v.boolean() })),
      members: v.array(
        v.object({
          userId: v.id('users'),
          name: v.string(),
          email: v.union(v.string(), v.null()),
          roleKey: v.string(),
          status: v.string(),
        }),
      ),
      usage: v.array(usageDay),
      invoices: v.array(
        v.object({
          id: v.id('billingInvoices'),
          number: v.string(),
          currency: v.string(),
          totalMinor: v.number(),
          paidMinor: v.number(),
          status: v.string(),
          issuedAt: v.number(),
          dueAt: v.number(),
        }),
      ),
      payments: v.array(
        v.object({
          id: v.id('billingPayments'),
          currency: v.string(),
          amountMinor: v.number(),
          method: v.string(),
          providerRef: v.union(v.string(), v.null()),
          receivedAt: v.number(),
          invoiceId: v.union(v.id('billingInvoices'), v.null()),
        }),
      ),
      notes: v.array(v.object({ id: v.id('tenantNotes'), body: v.string(), author: v.string(), createdAt: v.number() })),
      events: v.array(
        v.object({ id: v.id('platformEvents'), action: v.string(), actor: v.union(v.string(), v.null()), at: v.number(), details: v.any() }),
      ),
      exports: v.array(v.object({ id: v.id('dataExports'), status: v.string(), createdAt: v.number(), sizeBytes: v.union(v.number(), v.null()) })),
      lastActivityAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { companyId }) => {
    await requireConsoleAdmin(ctx)
    const c = await ctx.db.get(companyId)
    if (!c) return null
    const now = Date.now()
    const ent = await entitlements(ctx, companyId)
    const sub = ent.subscription
    const since = sub?.currentPeriodStart ?? 0
    const limits = []
    for (const kind of Object.keys(LIMIT_LABELS) as LimitKind[]) {
      const max = ent.limits[kind]
      limits.push({
        kind,
        label: LIMIT_LABELS[kind].many,
        used: await countUsage(ctx, companyId, kind, (max ?? COUNT_CAP) + 1, since),
        max: max ?? null,
      })
    }
    const sites = (
      await ctx.db
        .query('farmLocations')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(100)
    ).map((l) => ({ id: l._id, name: l.name, code: l.code ?? null, active: l.active !== false }))
    const members = []
    for (const m of await ctx.db
      .query('memberships')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(200)) {
      const u = await ctx.db.get(m.userId)
      members.push({ userId: m.userId, name: u?.name ?? 'Unknown', email: u?.email ?? null, roleKey: m.roleKey, status: m.status })
    }
    const usage = (
      await ctx.db
        .query('platformUsageDaily')
        .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId).gte('date', utcDate(now - 60 * DAY_MS)))
        .take(61)
    ).map((r) => ({
      date: r.date,
      dailyRecords: r.dailyRecords,
      activeUsers: r.activeUsers,
      smsSent: r.smsSent,
      whatsappSent: r.whatsappSent,
      aiCalls: r.aiCalls,
      aiTokens: r.aiTokens,
      aiCostUsd: r.aiCostUsd,
    }))
    const invoices = (
      await ctx.db
        .query('billingInvoices')
        .withIndex('by_companyId_and_issuedAt', (q) => q.eq('companyId', companyId))
        .order('desc')
        .take(50)
    ).map((i) => ({
      id: i._id,
      number: i.number,
      currency: i.currency,
      totalMinor: i.totalMinor,
      paidMinor: i.paidMinor,
      status: i.status,
      issuedAt: i.issuedAt,
      dueAt: i.dueAt,
    }))
    const payments = (
      await ctx.db
        .query('billingPayments')
        .withIndex('by_companyId_and_receivedAt', (q) => q.eq('companyId', companyId))
        .order('desc')
        .take(50)
    ).map((p) => ({
      id: p._id,
      currency: p.currency,
      amountMinor: p.amountMinor,
      method: p.method,
      providerRef: p.providerRef ?? null,
      receivedAt: p.receivedAt,
      invoiceId: p.invoiceId ?? null,
    }))
    const names = new Map<Id<'users'>, string>()
    const nameOf = async (id: Id<'users'> | undefined) => {
      if (!id) return null
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? 'Unknown')
      return names.get(id)!
    }
    const notes = []
    for (const n of await ctx.db
      .query('tenantNotes')
      .withIndex('by_companyId_and_createdAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(50)) {
      notes.push({ id: n._id, body: n.body, author: (await nameOf(n.authorId)) ?? 'Unknown', createdAt: n.createdAt })
    }
    const events = []
    for (const e of await ctx.db
      .query('platformEvents')
      .withIndex('by_companyId_and_at', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(50)) {
      events.push({ id: e._id, action: e.action, actor: await nameOf(e.actorId), at: e.at, details: e.details ?? null })
    }
    const exports = (
      await ctx.db
        .query('dataExports')
        .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
        .order('desc')
        .take(5)
    ).map((x) => ({ id: x._id, status: x.status, createdAt: x.createdAt, sizeBytes: x.sizeBytes ?? null }))
    const plan = ent.plan
    return {
      company: {
        companyId,
        name: c.name,
        abbreviation: c.abbreviation ?? null,
        contactEmail: c.contactEmail ?? null,
        contactPhone: c.contactPhone ?? null,
        address: c.address ?? null,
        status: c.status,
        state: stateOf(c),
        createdAt: c._creationTime,
        approvedAt: c.approvedAt ?? null,
        suspendedAt: c.suspendedAt ?? null,
        suspensionReason: c.suspensionReason ?? null,
        suspensionSource: c.suspensionSource ?? null,
        currency: c.settings?.locale?.currency ?? null,
      },
      subscription:
        sub && plan
          ? {
              subscriptionId: sub._id,
              planId: plan._id,
              planCode: plan.code,
              planName: plan.name,
              status: sub.status,
              currency: sub.currency,
              currentPeriodStart: sub.currentPeriodStart,
              currentPeriodEnd: sub.currentPeriodEnd,
              trialEndsAt: sub.trialEndsAt ?? null,
              graceEndsAt: sub.graceEndsAt ?? null,
              seats: sub.seats ?? null,
              provider: sub.provider,
              limitOverrides: sub.limitOverrides ?? null,
              featureOverrides: sub.featureOverrides ?? null,
              aiCreditsGranted: sub.aiCreditsGranted ?? 0,
              smsCreditsGranted: sub.smsCreditsGranted ?? 0,
            }
          : null,
      limits,
      features: ent.features,
      sites,
      members,
      usage,
      invoices,
      payments,
      notes,
      events,
      exports,
      lastActivityAt: await lastActivityAt(ctx, companyId),
    }
  },
})

// ---------------------------------------------------------------- actions

async function loadCompany(ctx: QueryCtx, companyId: Id<'companies'>) {
  const c = await ctx.db.get(companyId)
  if (!c) throw userError('NOT_FOUND', 'Organization not found')
  return c
}

/** Suspend: members are refused (TENANT_SUSPENDED) and signed out; data is kept. */
export const suspend = mutation({
  args: { companyId: v.id('companies'), reason: v.string() },
  returns: v.object({ sessionsRevoked: v.number() }),
  handler: async (ctx, { companyId, reason }) => {
    const admin = await requireConsoleAdmin(ctx)
    const c = await loadCompany(ctx, companyId)
    if (c.status !== 'approved') throw userError('CONFLICT', 'Only an approved organization can be suspended')
    if (c.suspendedAt !== undefined) throw userError('CONFLICT', 'This organization is already suspended')
    const why = reason.trim()
    if (why.length < 3) throw userError('VALIDATION', 'Give a reason', { field: 'reason' })
    await suspendCompany(ctx, companyId, { source: 'platform', reason: why, actorId: admin._id })
    const sessionsRevoked = await revokeMemberSessions(ctx, companyId, admin._id)
    await recordPlatformEvent(ctx, { actorId: admin._id, action: 'tenant.suspended', companyId, details: { reason: why, sessionsRevoked } })
    return { sessionsRevoked }
  },
})

/** Lift a suspension (platform or billing). A billing-suspended subscription becomes past_due again with a fresh grace period. */
export const reactivate = mutation({
  args: { companyId: v.id('companies'), graceDays: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { companyId, graceDays }) => {
    const admin = await requireConsoleAdmin(ctx)
    const c = await loadCompany(ctx, companyId)
    if (c.suspendedAt === undefined) throw userError('CONFLICT', 'This organization is not suspended')
    await unsuspendCompany(ctx, companyId)
    const ent = await entitlements(ctx, companyId)
    if (ent.subscription?.status === 'suspended') {
      const now = Date.now()
      const days = Math.min(Math.max(Math.floor(graceDays ?? 7), 1), 90)
      await ctx.db.patch(ent.subscription._id, {
        status: 'past_due',
        pastDueAt: now,
        graceEndsAt: now + days * DAY_MS,
        suspendedAt: undefined,
        updatedAt: now,
      })
    }
    await recordPlatformEvent(ctx, { actorId: admin._id, action: 'tenant.reactivated', companyId, details: { previousReason: c.suspensionReason } })
    return null
  },
})

/** Move the organization to another plan (new subscription row when it has none). */
export const changePlan = mutation({
  args: {
    companyId: v.id('companies'),
    planId: v.id('plans'),
    status: v.optional(v.union(v.literal('active'), v.literal('trialing'))),
  },
  returns: v.id('subscriptions'),
  handler: async (ctx, { companyId, planId, status }) => {
    const admin = await requireConsoleAdmin(ctx)
    await loadCompany(ctx, companyId)
    const plan = await ctx.db.get(planId)
    if (!plan || !plan.active) throw userError('NOT_FOUND', 'Plan not found or retired')
    const ent = await entitlements(ctx, companyId)
    const now = Date.now()
    let subscriptionId: Id<'subscriptions'>
    if (!ent.subscription || ent.subscription.status === 'cancelled') {
      subscriptionId = await startSubscription(ctx, companyId, plan, { status: status ?? 'active', now })
    } else {
      subscriptionId = ent.subscription._id
      await ctx.db.patch(subscriptionId, {
        planId,
        ...(status ? { status } : {}),
        ...(status === 'trialing' ? { trialEndsAt: now + plan.trialDays * DAY_MS, currentPeriodEnd: now + plan.trialDays * DAY_MS } : {}),
        updatedAt: now,
      })
    }
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'subscription.plan_changed',
      companyId,
      targetTable: 'subscriptions',
      targetId: subscriptionId,
      details: { from: ent.plan?.code ?? null, to: plan.code, status: status ?? null },
    })
    return subscriptionId
  },
})

/** Push the trial end out by `days` (also restores a trial that lapsed into past_due). */
export const extendTrial = mutation({
  args: { companyId: v.id('companies'), days: v.number() },
  returns: v.number(),
  handler: async (ctx, { companyId, days }) => {
    const admin = await requireConsoleAdmin(ctx)
    if (!Number.isInteger(days) || days < 1 || days > 365) throw userError('VALIDATION', 'Days must be 1–365', { field: 'days' })
    const ent = await entitlements(ctx, companyId)
    const sub = ent.subscription
    if (!sub) throw userError('NOT_FOUND', 'This organization has no subscription yet. Change its plan first.')
    if (sub.status !== 'trialing' && sub.status !== 'past_due') {
      throw userError('CONFLICT', 'Only a trial (or a lapsed trial) can be extended')
    }
    const now = Date.now()
    const trialEndsAt = Math.max(sub.trialEndsAt ?? now, now) + days * DAY_MS
    await ctx.db.patch(sub._id, {
      status: 'trialing',
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
      pastDueAt: undefined,
      graceEndsAt: undefined,
      updatedAt: now,
    })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'subscription.trial_extended',
      companyId,
      targetTable: 'subscriptions',
      targetId: sub._id,
      details: { days, trialEndsAt },
    })
    return trialEndsAt
  },
})

/** Grant AI or SMS credits on top of the plan (ledger in billingCreditGrants). */
export const grantCredits = mutation({
  args: { companyId: v.id('companies'), kind: v.union(v.literal('ai'), v.literal('sms')), amount: v.number(), reason: v.string() },
  returns: v.id('billingCreditGrants'),
  handler: async (ctx, { companyId, kind, amount, reason }) => {
    const admin = await requireConsoleAdmin(ctx)
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      throw userError('VALIDATION', 'Amount must be a whole number from 1 to 1,000,000', { field: 'amount' })
    }
    if (reason.trim().length < 3) throw userError('VALIDATION', 'Give a reason', { field: 'reason' })
    const ent = await entitlements(ctx, companyId)
    if (!ent.subscription) throw userError('NOT_FOUND', 'This organization has no subscription yet. Change its plan first.')
    const field = kind === 'ai' ? 'aiCreditsGranted' : 'smsCreditsGranted'
    await ctx.db.patch(ent.subscription._id, { [field]: (ent.subscription[field] ?? 0) + amount, updatedAt: Date.now() })
    const id = await ctx.db.insert('billingCreditGrants', {
      companyId,
      kind,
      amount,
      reason: reason.trim(),
      grantedBy: admin._id,
      createdAt: Date.now(),
    })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'credits.granted',
      companyId,
      targetTable: 'billingCreditGrants',
      targetId: id,
      details: { kind, amount, reason: reason.trim() },
    })
    return id
  },
})

/** Per-tenant limit and feature overrides on top of the plan (null clears). */
export const setOverrides = mutation({
  args: {
    companyId: v.id('companies'),
    limitOverrides: v.union(planLimits, v.null()),
    featureOverrides: v.union(v.record(v.string(), v.boolean()), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { companyId, limitOverrides, featureOverrides }) => {
    const admin = await requireConsoleAdmin(ctx)
    const ent = await entitlements(ctx, companyId)
    if (!ent.subscription) throw userError('NOT_FOUND', 'This organization has no subscription yet. Change its plan first.')
    for (const value of Object.values(limitOverrides ?? {})) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
        throw userError('VALIDATION', 'Limits must be whole numbers of 0 or more', { field: 'limitOverrides' })
      }
    }
    await ctx.db.patch(ent.subscription._id, {
      limitOverrides: limitOverrides ?? undefined,
      featureOverrides: featureOverrides ?? undefined,
      updatedAt: Date.now(),
    })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'subscription.overrides_set',
      companyId,
      targetTable: 'subscriptions',
      targetId: ent.subscription._id,
      details: { limitOverrides, featureOverrides },
    })
    return null
  },
})

export const addNote = mutation({
  args: { companyId: v.id('companies'), body: v.string() },
  returns: v.id('tenantNotes'),
  handler: async (ctx, { companyId, body }) => {
    const admin = await requireConsoleAdmin(ctx)
    await loadCompany(ctx, companyId)
    const text = body.trim()
    if (!text || text.length > 4000) throw userError('VALIDATION', 'Notes are 1–4000 characters', { field: 'body' })
    const id = await ctx.db.insert('tenantNotes', { companyId, body: text, authorId: admin._id, createdAt: Date.now() })
    // Notes are internal: platform log only, not the tenant's audit trail.
    await recordPlatformEvent(
      ctx,
      { actorId: admin._id, action: 'tenant.note_added', companyId, targetTable: 'tenantNotes', targetId: id },
      { orgAudit: false },
    )
    return id
  },
})

/** Full organization export (same job as the tenant's own export, governance.runExport). */
export const requestExport = mutation({
  args: { companyId: v.id('companies') },
  returns: v.id('dataExports'),
  handler: async (ctx, { companyId }) => {
    const admin = await requireConsoleAdmin(ctx)
    await loadCompany(ctx, companyId)
    const latest = await ctx.db
      .query('dataExports')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .order('desc')
      .first()
    if (latest && (latest.status === 'queued' || latest.status === 'running') && Date.now() - latest.createdAt < 3_600_000) {
      throw userError('CONFLICT', 'An export is already being prepared')
    }
    const exportId = await ctx.db.insert('dataExports', { companyId, requestedBy: admin._id, status: 'queued', createdAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.governance.runExport, { exportId })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'tenant.export_requested',
      companyId,
      targetTable: 'dataExports',
      targetId: exportId,
    })
    return exportId
  },
})

/** Download link for a ready export (logged: who pulled a tenant's data). */
export const exportUrl = mutation({
  args: { exportId: v.id('dataExports') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { exportId }) => {
    const admin = await requireConsoleAdmin(ctx)
    const x = await ctx.db.get(exportId)
    if (!x || x.status !== 'ready' || !x.storageId) return null
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'tenant.export_downloaded',
      companyId: x.companyId,
      targetTable: 'dataExports',
      targetId: exportId,
    })
    return await ctx.storage.getUrl(x.storageId)
  },
})
