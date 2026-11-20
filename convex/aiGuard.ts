/**
 * AI protections (D-023, docs/architecture/09 §14): the database side of convex/lib/aiGuard.
 *
 * - Concurrency leases: `admitCall` (inside each path's gate mutation, before
 *   any quota is spent) counts live leases per user, company and the shared
 *   server key and takes one; the action gives it back with `release` in a
 *   finally. A crashed call's lease expires with its deadline.
 * - Monthly budgets: spend counters (aiSpend) move with every llmUsage row
 *   (`afterUsage`, called by llmGateway.insertUsage). At 100% new calls are
 *   refused (unless a platform admin allowed the tenant over); admins are
 *   warned once at 80% and once at 100% per month.
 * - Circuit breakers per key scope + provider + model, from the same usage
 *   rows. `admitCall` returns the open ones so Auto never picks them.
 * - A 5-minute health check over llmUsage raises platform alerts; the
 *   platform console reads `platformHealth` and `tenantBudgets`.
 *
 * Refusals by the guard (busy, budget) never reach a provider and write no
 * usage row: nothing is charged.
 */
import { v } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireAccount, requireMember } from './lib/permissions'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import { notifyUsers } from './lib/notify'
import { membersWithPermission } from './approvalAlerts'
import { requireConsoleAdmin } from './platform/access'
import { recordPlatformEvent } from './billing/ops'
import { LLM_FAILURE_TEXT, classifyLlmFailure } from './lib/llmErrors'
import {
  BREAKER_KINDS,
  CLOSED,
  LEASE_MARGIN_MS,
  alertSettings,
  breakerKey,
  budgetUsed,
  concurrencyRefusal,
  groupBy,
  guardSettings,
  healthAlerts,
  healthOf,
  isZeroQuota,
  monthOf,
  nextBreaker,
  nextMonthStart,
  serverProviderBudgetUsd,
  tighter,
  type BreakerState,
  type GuardSettings,
} from './lib/aiGuard'

type Ctx = QueryCtx | MutationCtx

const MAX_BLOCKED = 100
const MAX_SERVER_PROVIDERS = 20
const HEALTH_WINDOW_MS = 15 * 60_000
const HEALTH_SCAN = 4000
const ALERT_RESEND_MS = 60 * 60_000
const SUPER_ADMIN_SCAN = 8000
const MAX_BUDGET_USD = 1_000_000
const MAX_TOKEN_BUDGET = 10_000_000_000

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

async function spendRow(ctx: Ctx, kind: Doc<'aiSpend'>['kind'], scope: string, month: string) {
  return await ctx.db
    .query('aiSpend')
    .withIndex('by_kind_and_scope_and_month', (q) => q.eq('kind', kind).eq('scope', scope).eq('month', month))
    .unique()
}

async function budgetRow(ctx: Ctx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('aiBudgets')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .unique()
}

/** The tenant's budget: the org's own (it can only lower), and the platform's (override or env default). */
export function effectiveBudget(row: Doc<'aiBudgets'> | null, s: Pick<GuardSettings, 'companyBudgetUsd' | 'companyBudgetTokens'>) {
  return {
    usd: tighter(row?.monthlyBudgetUsd, row?.platformBudgetUsd ?? s.companyBudgetUsd),
    tokens: tighter(row?.monthlyTokenBudget, s.companyBudgetTokens),
  }
}

async function serverSpendUsd(ctx: Ctx, month: string): Promise<number> {
  const rows = await ctx.db
    .query('aiSpend')
    .withIndex('by_kind_and_month_and_costUsd', (q) => q.eq('kind', 'server').eq('month', month))
    .take(MAX_SERVER_PROVIDERS)
  return rows.reduce((a, r) => a + r.costUsd, 0)
}

type BudgetRefusal = { scope: 'company' | 'key' | 'server' | 'share' } | null

/** Whether a new call would go over a monthly budget (company, the org key, or the server key). */
export async function budgetRefusal(
  ctx: Ctx,
  o: { companyId: Id<'companies'>; server: boolean; providerId?: string | null; credentialId?: Id<'llmCredentials'> | null },
  now: number,
  s: GuardSettings,
): Promise<BudgetRefusal> {
  const month = monthOf(now)
  const row = await budgetRow(ctx, o.companyId)
  const budget = effectiveBudget(row, s)
  if (budget.usd !== null || budget.tokens !== null) {
    const spend = await spendRow(ctx, 'company', o.companyId, month)
    const used = budgetUsed({ costUsd: spend?.costUsd ?? 0, unpricedTokens: spend?.unpricedTokens ?? 0 }, budget)
    if (used !== null && used >= 1 && row?.allowOverBudgetMonth !== month) return { scope: 'company' }
  }
  if (!o.server && o.credentialId) {
    const cred = await ctx.db.get(o.credentialId)
    if (cred && cred.companyId === o.companyId && cred.monthlyBudgetUsd) {
      const spend = await spendRow(ctx, 'key', `${o.companyId}:${cred.providerId}`, month)
      if ((spend?.costUsd ?? 0) >= cred.monthlyBudgetUsd) return { scope: 'key' }
    }
  }
  if (o.server) {
    if (s.serverBudgetUsd !== null && (await serverSpendUsd(ctx, month)) >= s.serverBudgetUsd) return { scope: 'server' }
    // One tenant's share of the shared pool (its server-key spend, member-reported rows included),
    // so no tenant can use up the server key for everyone. A platform override lifts it for the month.
    if (s.serverBudgetUsd !== null && row?.allowOverBudgetMonth !== month) {
      const share = await spendRow(ctx, 'share', o.companyId, month)
      if ((share?.costUsd ?? 0) >= s.serverBudgetUsd * s.serverTenantShare) return { scope: 'share' }
    }
    const perProvider = o.providerId ? serverProviderBudgetUsd(o.providerId) : null
    if (o.providerId && perProvider !== null) {
      const spend = await spendRow(ctx, 'server', o.providerId, month)
      if ((spend?.costUsd ?? 0) >= perProvider) return { scope: 'server' }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Admission (leases + budget + open breakers)
// ---------------------------------------------------------------------------

export type Admission =
  | { ok: true; leaseId: Id<'aiLeases'>; deadlineAt: number; attemptMs: number; blocked: string[] }
  | { ok: false; kind: 'busy' | 'budget'; scope: string; retryAfterSec: number; message: string }

export const admissionValidator = v.union(
  v.object({
    ok: v.literal(true),
    leaseId: v.id('aiLeases'),
    deadlineAt: v.number(),
    attemptMs: v.number(),
    blocked: v.array(v.string()),
  }),
  v.object({
    ok: v.literal(false),
    kind: v.union(v.literal('busy'), v.literal('budget')),
    scope: v.string(),
    retryAfterSec: v.number(),
    message: v.string(),
  }),
)

/** Open breakers for the company's keys and the server key ("scope|provider|model"). */
export async function blockedModels(ctx: Ctx, companyId: Id<'companies'>, now: number): Promise<string[]> {
  const out: string[] = []
  for (const scope of [String(companyId), 'server']) {
    const rows = await ctx.db
      .query('aiBreakers')
      .withIndex('by_scope_and_openUntil', (q) => q.eq('scope', scope).gt('openUntil', now))
      .take(MAX_BLOCKED)
    for (const r of rows) out.push(breakerKey(r.scope, r.providerId, r.model))
  }
  return out
}

/**
 * Call this in a path's gate mutation after its own checks and before it
 * spends quota: refuse when a monthly budget is used up or a concurrency cap
 * is full, else take a lease. The caller returns or throws the refusal
 * (busy / budget) so nothing is spent or charged.
 */
export async function admitCall(
  ctx: MutationCtx,
  o: {
    companyId: Id<'companies'>
    userId?: Id<'users'> | null
    server: boolean
    feature: string
    providerId?: string | null
    credentialId?: Id<'llmCredentials'> | null
  },
): Promise<Admission> {
  const s = guardSettings()
  const now = Date.now()
  const over = await budgetRefusal(ctx, o, now, s)
  if (over) {
    return {
      ok: false,
      kind: 'budget',
      scope: over.scope,
      retryAfterSec: Math.ceil((nextMonthStart(now) - now) / 1000),
      message: LLM_FAILURE_TEXT.budget,
    }
  }
  const userCount = o.userId
    ? (
        await ctx.db
          .query('aiLeases')
          .withIndex('by_userId_and_expiresAt', (q) => q.eq('userId', o.userId!).gt('expiresAt', now))
          .take(s.perUser)
      ).length
    : null
  const companyCount = (
    await ctx.db
      .query('aiLeases')
      .withIndex('by_companyId_and_expiresAt', (q) => q.eq('companyId', o.companyId).gt('expiresAt', now))
      .take(s.perCompany)
  ).length
  const serverCount = o.server
    ? (
        await ctx.db
          .query('aiLeases')
          .withIndex('by_server_and_expiresAt', (q) => q.eq('server', true).gt('expiresAt', now))
          .take(s.server)
      ).length
    : null
  const full = concurrencyRefusal({ user: userCount, company: companyCount, server: serverCount }, s)
  if (full) return { ok: false, kind: 'busy', scope: full, retryAfterSec: 5, message: LLM_FAILURE_TEXT.busy }
  const leaseId = await ctx.db.insert('aiLeases', {
    companyId: o.companyId,
    ...(o.userId ? { userId: o.userId } : {}),
    server: o.server,
    feature: o.feature.slice(0, 40),
    expiresAt: now + s.deadlineMs + LEASE_MARGIN_MS,
    createdAt: now,
  })
  return { ok: true, leaseId, deadlineAt: now + s.deadlineMs, attemptMs: s.attemptMs, blocked: await blockedModels(ctx, o.companyId, now) }
}

/** A refusal as the ConvexError the Next proxy and clients understand (kind + retry hint). */
export function admissionError(a: Extract<Admission, { ok: false }>) {
  return userError('UPSTREAM', a.message, { kind: a.kind, status: null, retryAfterSec: a.retryAfterSec, scope: a.scope })
}

/** Internal: admission for a path without its own gate mutation (voice transcription). */
export const admit = internalMutation({
  args: {
    companyId: v.id('companies'),
    userId: v.optional(v.id('users')),
    server: v.boolean(),
    feature: v.string(),
    providerId: v.optional(v.string()),
  },
  returns: admissionValidator,
  handler: async (ctx, args) => await admitCall(ctx, args),
})

/** Internal: give a lease back (idempotent). */
export const release = internalMutation({
  args: { leaseId: v.id('aiLeases') },
  returns: v.null(),
  handler: async (ctx, { leaseId }) => {
    if (await ctx.db.get(leaseId)) await ctx.db.delete(leaseId)
    return null
  },
})

/** The Next proxy gives back the lease of a server-key call it made (only the caller's own). */
export const releaseLease = mutation({
  args: { leaseId: v.id('aiLeases') },
  returns: v.null(),
  handler: async (ctx, { leaseId }) => {
    const user = await requireAccount(ctx)
    const lease = await ctx.db.get(leaseId)
    if (lease && lease.userId === user._id) await ctx.db.delete(leaseId)
    return null
  },
})

// ---------------------------------------------------------------------------
// After each call: spend and breaker (called by llmGateway.insertUsage)
// ---------------------------------------------------------------------------

async function bumpSpend(
  ctx: MutationCtx,
  key: { kind: Doc<'aiSpend'>['kind']; scope: string; companyId?: Id<'companies'> },
  month: string,
  delta: { ok: boolean; costUsd?: number; tokens: number },
  now: number,
): Promise<Doc<'aiSpend'>> {
  const row = await spendRow(ctx, key.kind, key.scope, month)
  const fields = {
    calls: (row?.calls ?? 0) + 1,
    errors: (row?.errors ?? 0) + (delta.ok ? 0 : 1),
    costUsd: Math.round(((row?.costUsd ?? 0) + (delta.costUsd ?? 0)) * 1_000_000) / 1_000_000,
    tokens: (row?.tokens ?? 0) + delta.tokens,
    unpricedTokens: (row?.unpricedTokens ?? 0) + (delta.costUsd === undefined ? delta.tokens : 0),
    updatedAt: now,
  }
  if (row) {
    await ctx.db.patch(row._id, fields)
    return { ...row, ...fields }
  }
  const id = await ctx.db.insert('aiSpend', { kind: key.kind, scope: key.scope, ...(key.companyId ? { companyId: key.companyId } : {}), month, ...fields })
  return (await ctx.db.get(id))!
}

/** Once per threshold per month: mark the row and return the levels to announce. */
async function newWarnings(ctx: MutationCtx, row: Doc<'aiSpend'>, used: number | null): Promise<Array<80 | 100>> {
  if (used === null) return []
  const out: Array<80 | 100> = []
  const patch: Partial<Doc<'aiSpend'>> = {}
  if (used >= 0.8 && !row.warned80) {
    patch.warned80 = true
    if (used < 1) out.push(80)
  }
  if (used >= 1 && !row.warned100) {
    patch.warned100 = true
    out.push(100)
  }
  if (Object.keys(patch).length) await ctx.db.patch(row._id, patch)
  return out
}

export async function afterUsage(
  ctx: MutationCtx,
  row: {
    companyId: Id<'companies'>
    source: 'org_key' | 'server_key'
    providerId: string
    model: string
    ok: boolean
    error?: string
    status?: number
    costUsd?: number
    tokens: number
    /** Set when a member's session reported the row (Next proxy): see updateBreaker. */
    reporter?: string
  },
) {
  const s = guardSettings()
  const now = Date.now()
  const month = monthOf(now)
  const delta = { ok: row.ok, costUsd: row.costUsd, tokens: row.tokens }

  // Company budget.
  const company = await bumpSpend(ctx, { kind: 'company', scope: row.companyId, companyId: row.companyId }, month, delta, now)
  const budget = effectiveBudget(await budgetRow(ctx, row.companyId), s)
  for (const level of await newWarnings(ctx, company, budgetUsed(company, budget))) {
    await ctx.scheduler.runAfter(0, internal.aiGuard.budgetWarning, { companyId: row.companyId, level, which: 'company', month })
  }
  // The key that paid.
  if (row.source === 'org_key') {
    const keyRow = await bumpSpend(ctx, { kind: 'key', scope: `${row.companyId}:${row.providerId}`, companyId: row.companyId }, month, delta, now)
    const cred = await ctx.db
      .query('llmCredentials')
      .withIndex('by_companyId_and_providerId', (q) => q.eq('companyId', row.companyId).eq('providerId', row.providerId))
      .first()
    const used = cred?.monthlyBudgetUsd ? keyRow.costUsd / cred.monthlyBudgetUsd : null
    for (const level of await newWarnings(ctx, keyRow, used)) {
      await ctx.scheduler.runAfter(0, internal.aiGuard.budgetWarning, { companyId: row.companyId, level, which: 'key', providerId: row.providerId, month })
    }
  } else {
    // The tenant's share of the server key counts every row, member-reported included (it only limits that tenant).
    await bumpSpend(ctx, { kind: 'share', scope: row.companyId, companyId: row.companyId }, month, delta, now)
  }
  if (row.source === 'server_key' && !row.reporter) {
    // The shared pool moves only with Convex-side calls: a member's session cannot use it up (Q-048).
    const serverRow = await bumpSpend(ctx, { kind: 'server', scope: row.providerId }, month, delta, now)
    const perProvider = serverProviderBudgetUsd(row.providerId)
    const total = s.serverBudgetUsd !== null ? await serverSpendUsd(ctx, month) : null
    const used = Math.max(
      perProvider ? serverRow.costUsd / perProvider : -1,
      total !== null && s.serverBudgetUsd ? total / s.serverBudgetUsd : -1,
    )
    for (const level of await newWarnings(ctx, serverRow, used < 0 ? null : used)) {
      await raiseAlert(ctx, {
        key: `server_budget:${row.providerId}:${month}:${level}`,
        kind: 'server_budget',
        providerId: row.providerId,
        message: `The shared ${row.providerId} key has used ${level}% of its monthly AI budget${level === 100 ? '; new server-key calls are refused' : ''}.`,
      }, now)
    }
  }

  // Breakers move only with calls Convex made itself. A member-reported row
  // (Next proxy) never opens, extends or closes one: its status, retry-after
  // and "limit: 0" text are the member's word (D-023, Q-048).
  if (row.reporter) return
  await updateBreaker(ctx, { scope: row.source === 'server_key' ? 'server' : String(row.companyId), ...row }, now, s)
}

/** Move the model's breaker with one usage row from a call Convex made. */
async function updateBreaker(
  ctx: MutationCtx,
  row: { scope: string; companyId: Id<'companies'>; providerId: string; model: string; ok: boolean; error?: string; status?: number },
  now: number,
  s: GuardSettings,
) {
  const existing = await ctx.db
    .query('aiBreakers')
    .withIndex('by_scope_and_providerId_and_model', (q) => q.eq('scope', row.scope).eq('providerId', row.providerId).eq('model', row.model))
    .unique()
  if (row.ok) {
    if (existing && (existing.openUntil || existing.failures)) {
      await ctx.db.patch(existing._id, { ...CLOSED, lastKind: undefined, refused: undefined, updatedAt: now })
    }
    return
  }
  const f = classifyLlmFailure({ status: row.status ?? null, message: row.error ?? '' })
  if (!BREAKER_KINDS.has(f.kind)) return
  const before: BreakerState = existing
    ? { failures: existing.failures, windowStart: existing.windowStart, openUntil: existing.openUntil, opens: existing.opens }
    : CLOSED
  const next = nextBreaker(before, { ok: false, kind: f.kind, retryAfterSec: f.retryAfterSec, zeroQuota: isZeroQuota(row.error ?? '') }, now, s)
  const fields = {
    failures: next.failures,
    windowStart: next.windowStart,
    openUntil: next.openUntil,
    opens: next.opens,
    lastKind: next.lastKind,
    refused: next.refused || undefined,
    updatedAt: now,
  }
  if (existing) await ctx.db.patch(existing._id, fields)
  else {
    await ctx.db.insert('aiBreakers', {
      scope: row.scope,
      ...(row.scope === 'server' ? {} : { companyId: row.companyId }),
      providerId: row.providerId,
      model: row.model.slice(0, 100),
      ...fields,
    })
  }
}

// ---------------------------------------------------------------------------
// Warnings and platform alerts
// ---------------------------------------------------------------------------

/** Tell the organization's admins (in-app + email) that a monthly AI budget reached 80% or 100%. */
export const budgetWarning = internalMutation({
  args: {
    companyId: v.id('companies'),
    level: v.union(v.literal(80), v.literal(100)),
    which: v.union(v.literal('company'), v.literal('key')),
    providerId: v.optional(v.string()),
    month: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { companyId, level, which, providerId, month }) => {
    const admins = await membersWithPermission(ctx, companyId, 'org.settings.manage')
    if (!admins.length) return null
    const subject = which === 'key' ? `The ${providerId ?? 'AI'} key` : 'Your organization'
    const title = level === 100 ? 'AI budget used up' : 'AI budget at 80%'
    const message =
      level === 100
        ? `${subject} has used this month's AI budget. Anowa will not answer new questions on it until next month unless an admin raises the budget in AI settings.`
        : `${subject} has used 80% of this month's AI budget. Raise it in AI settings to avoid interruptions.`
    await notifyUsers(ctx, {
      companyId,
      users: admins,
      channels: ['in_app', 'email'],
      title,
      message,
      link: '/ai-settings',
      level: level === 100 ? 'error' : 'warning',
      dedupeKey: `ai-budget:${which}:${providerId ?? ''}:${month}:${level}`,
      source: 'ai.budget',
    })
    return null
  },
})

/** Record an alert; send it to platform admins when new or not sent for an hour. */
async function raiseAlert(
  ctx: MutationCtx,
  a: { key: string; kind: string; message: string; companyId?: Id<'companies'>; providerId?: string },
  now: number,
): Promise<boolean> {
  const existing = await ctx.db
    .query('aiAlerts')
    .withIndex('by_key', (q) => q.eq('key', a.key))
    .unique()
  const send = !existing || !existing.active || now - existing.lastSentAt >= ALERT_RESEND_MS
  if (existing) {
    await ctx.db.patch(existing._id, { message: a.message, active: true, lastSeenAt: now, ...(send ? { lastSentAt: now } : {}) })
  } else {
    await ctx.db.insert('aiAlerts', { ...a, active: true, firstAt: now, lastSeenAt: now, lastSentAt: now })
  }
  if (send) await ctx.scheduler.runAfter(0, internal.aiGuard.deliverAlert, { title: `Anowa AI alert: ${a.kind.replace(/_/g, ' ')}`, message: a.message })
  return send
}

/** Platform admins (super_admins, bounded scan) get the alert in-app and by email, plus PLATFORM_ALERT_EMAILS. */
export const deliverAlert = internalMutation({
  args: { title: v.string(), message: v.string() },
  returns: v.number(),
  handler: async (ctx, { title, message }) => {
    const emails = new Set(
      String(process.env.PLATFORM_ALERT_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    )
    let scanned = 0
    let notified = 0
    for await (const u of ctx.db.query('users')) {
      if (++scanned > SUPER_ADMIN_SCAN) break
      if (u.role !== 'super_admin' || u.active === false) continue
      await ctx.db.insert('notifications', { userId: u._id, title, message, type: 'error', read: false, link: '/platform' })
      notified += 1
      if (u.email) emails.add(u.email.toLowerCase())
    }
    for (const to of [...emails].slice(0, 20)) {
      await ctx.scheduler.runAfter(0, internal.emails.send, { to, subject: title, text: `${message}\n\nOpen the platform console: /platform` })
    }
    return notified
  },
})

/**
 * Every 5 minutes: error rate, p95 latency and spend spikes per provider and
 * per tenant over the last 15 minutes, open server-key breakers; platform
 * admins are alerted (deduped). Also drops expired leases.
 */
export const checkHealth = internalMutation({
  args: {},
  returns: v.object({ alerts: v.number(), sent: v.number() }),
  handler: async (ctx) => {
    const now = Date.now()
    const s = alertSettings()
    const recent = await ctx.db
      .query('llmUsage')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', now - HEALTH_WINDOW_MS))
      .take(HEALTH_SCAN)
    const previous = await ctx.db
      .query('llmUsage')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', now - 2 * HEALTH_WINDOW_MS).lt('createdAt', now - HEALTH_WINDOW_MS))
      .take(HEALTH_SCAN)
    const prevCost = (rows: Doc<'llmUsage'>[]) => rows.reduce((a, r) => a + (r.costUsd ?? 0), 0)
    const prevByProvider = groupBy(previous, (r) => r.providerId)
    const prevByCompany = groupBy(previous, (r) => r.companyId)
    let alerts = 0
    let sent = 0
    const raise = async (a: { key: string; kind: string; message: string; companyId?: Id<'companies'>; providerId?: string }) => {
      alerts += 1
      if (await raiseAlert(ctx, a, now)) sent += 1
    }
    for (const [providerId, rows] of groupBy(recent, (r) => r.providerId)) {
      for (const a of healthAlerts(`Provider ${providerId}`, healthOf(rows), prevCost(prevByProvider.get(providerId) ?? []), s)) {
        await raise({ key: `provider:${providerId}:${a.kind}`, kind: a.kind, message: a.message, providerId })
      }
    }
    for (const [companyId, rows] of groupBy(recent, (r) => r.companyId)) {
      const found = healthAlerts('Tenant', healthOf(rows), prevCost(prevByCompany.get(companyId) ?? []), s)
      if (!found.length) continue
      const company = await ctx.db.get(companyId as Id<'companies'>)
      for (const a of found) {
        await raise({
          key: `tenant:${companyId}:${a.kind}`,
          kind: a.kind,
          message: a.message.replace(/^Tenant/, `Tenant ${company?.name ?? companyId}`),
          companyId: companyId as Id<'companies'>,
        })
      }
    }
    const open = await ctx.db
      .query('aiBreakers')
      .withIndex('by_scope_and_openUntil', (q) => q.eq('scope', 'server').gt('openUntil', now))
      .take(MAX_BLOCKED)
    for (const b of open) {
      await raise({
        key: `breaker:${b.providerId}:${b.model}`,
        kind: 'breaker_open',
        providerId: b.providerId,
        message: `Server key: ${b.providerId}/${b.model} is paused until ${new Date(b.openUntil).toISOString()} (${b.refused ? 'no quota for this model' : b.lastKind ?? 'failures'}).`,
      })
    }
    // Alerts not seen for 10 minutes are resolved.
    const stale = await ctx.db
      .query('aiAlerts')
      .withIndex('by_active_and_lastSeenAt', (q) => q.eq('active', true).lt('lastSeenAt', now - 10 * 60_000))
      .take(100)
    for (const a of stale) await ctx.db.patch(a._id, { active: false })
    const expired = await ctx.db
      .query('aiLeases')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(500)
    for (const l of expired) await ctx.db.delete(l._id)
    return { alerts, sent }
  },
})

// ---------------------------------------------------------------------------
// Organization admins: budget (AI settings)
// ---------------------------------------------------------------------------

const budgetStatusValidator = v.object({
  month: v.string(),
  spentUsd: v.number(),
  unpricedTokens: v.number(),
  calls: v.number(),
  /** The org's own settings (null = not set). */
  monthlyBudgetUsd: v.union(v.number(), v.null()),
  monthlyTokenBudget: v.union(v.number(), v.null()),
  /** What applies: the tighter of the org's and the platform's. */
  effectiveUsd: v.union(v.number(), v.null()),
  effectiveTokens: v.union(v.number(), v.null()),
  usedPct: v.union(v.number(), v.null()),
  refusing: v.boolean(),
  allowedOver: v.boolean(),
  keys: v.array(
    v.object({
      credentialId: v.id('llmCredentials'),
      providerId: v.string(),
      monthlyBudgetUsd: v.union(v.number(), v.null()),
      spentUsd: v.number(),
    }),
  ),
})

/** This month's AI spend against the budget (`now` from the client: queries do not read the clock). */
export const budgetStatus = query({
  args: { now: v.number() },
  returns: budgetStatusValidator,
  handler: async (ctx, { now }) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    if (!user.companyId) throw userError('FORBIDDEN', 'No organization')
    return await statusFor(ctx, user.companyId, now)
  },
})

async function statusFor(ctx: QueryCtx, companyId: Id<'companies'>, now: number) {
  const s = guardSettings()
  const month = monthOf(now)
  const row = await budgetRow(ctx, companyId)
  const spend = await spendRow(ctx, 'company', companyId, month)
  const budget = effectiveBudget(row, s)
  const used = budgetUsed({ costUsd: spend?.costUsd ?? 0, unpricedTokens: spend?.unpricedTokens ?? 0 }, budget)
  const allowedOver = row?.allowOverBudgetMonth === month
  const creds = await ctx.db
    .query('llmCredentials')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(MAX_SERVER_PROVIDERS)
  const keys = []
  for (const c of creds) {
    const k = await spendRow(ctx, 'key', `${companyId}:${c.providerId}`, month)
    keys.push({ credentialId: c._id, providerId: c.providerId, monthlyBudgetUsd: c.monthlyBudgetUsd ?? null, spentUsd: k?.costUsd ?? 0 })
  }
  return {
    month,
    spentUsd: spend?.costUsd ?? 0,
    unpricedTokens: spend?.unpricedTokens ?? 0,
    calls: spend?.calls ?? 0,
    monthlyBudgetUsd: row?.monthlyBudgetUsd ?? null,
    monthlyTokenBudget: row?.monthlyTokenBudget ?? null,
    effectiveUsd: budget.usd,
    effectiveTokens: budget.tokens,
    usedPct: used === null ? null : Math.round(used * 1000) / 10,
    refusing: used !== null && used >= 1 && !allowedOver,
    allowedOver,
    keys,
  }
}

function cleanAmount(value: number | null | undefined, max: number, label: string): number | undefined {
  if (value === null || value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0 || value > max) throw userError('VALIDATION', `${label} must be a positive number up to ${max.toLocaleString('en')}`)
  return Math.round(value * 100) / 100
}

/** Set (or clear with null) the organization's monthly AI budget. */
export const setBudget = mutation({
  args: {
    monthlyBudgetUsd: v.union(v.number(), v.null()),
    monthlyTokenBudget: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    if (!user.companyId) throw userError('FORBIDDEN', 'No organization')
    const companyId = user.companyId
    const usd = cleanAmount(args.monthlyBudgetUsd, MAX_BUDGET_USD, 'Monthly budget')
    const row = await budgetRow(ctx, companyId)
    const tokens =
      args.monthlyTokenBudget === undefined
        ? row?.monthlyTokenBudget
        : cleanAmount(args.monthlyTokenBudget, MAX_TOKEN_BUDGET, 'Token budget')
    const fields = { monthlyBudgetUsd: usd, monthlyTokenBudget: tokens === undefined ? undefined : Math.round(tokens), updatedBy: user._id, updatedAt: Date.now() }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('aiBudgets', { companyId, ...fields })
    await logAudit(ctx, {
      actionType: 'ai_budget_update',
      tableName: 'aiBudgets',
      recordId: companyId,
      previousValues: { monthlyBudgetUsd: row?.monthlyBudgetUsd ?? null, monthlyTokenBudget: row?.monthlyTokenBudget ?? null },
      newValues: { monthlyBudgetUsd: usd ?? null, monthlyTokenBudget: fields.monthlyTokenBudget ?? null },
    })
    return null
  },
})

/** Monthly USD budget for one organization key (null clears it). */
export const setKeyBudget = mutation({
  args: { credentialId: v.id('llmCredentials'), monthlyBudgetUsd: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { credentialId, monthlyBudgetUsd }) => {
    const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
    const cred = await ctx.db.get(credentialId)
    if (!cred || !user.companyId || cred.companyId !== user.companyId) throw userError('NOT_FOUND', 'Provider key not found')
    const usd = cleanAmount(monthlyBudgetUsd, MAX_BUDGET_USD, 'Key budget')
    await ctx.db.patch(cred._id, { monthlyBudgetUsd: usd, updatedAt: Date.now(), updatedBy: user._id })
    await logAudit(ctx, {
      actionType: 'llm_key_budget',
      tableName: 'llmCredentials',
      recordId: cred._id,
      previousValues: { monthlyBudgetUsd: cred.monthlyBudgetUsd ?? null },
      newValues: { monthlyBudgetUsd: usd ?? null },
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Platform console
// ---------------------------------------------------------------------------

const statsValidator = v.object({
  calls: v.number(),
  errors: v.number(),
  errorRate: v.number(),
  p95Ms: v.union(v.number(), v.null()),
  costUsd: v.number(),
})

/** AI health for the console card: last hour, spend this month, open breakers, active alerts. */
export const platformHealth = query({
  args: { now: v.number() },
  returns: v.object({
    lastHour: statsValidator,
    truncated: v.boolean(),
    providers: v.array(v.object({ providerId: v.string(), stats: statsValidator })),
    monthSpendUsd: v.object({ server: v.number(), serverBudgetUsd: v.union(v.number(), v.null()) }),
    breakers: v.array(
      v.object({
        id: v.id('aiBreakers'),
        scope: v.string(),
        tenant: v.union(v.string(), v.null()),
        providerId: v.string(),
        model: v.string(),
        openUntil: v.number(),
        lastKind: v.union(v.string(), v.null()),
        refused: v.boolean(),
      }),
    ),
    alerts: v.array(v.object({ kind: v.string(), message: v.string(), lastSeenAt: v.number() })),
  }),
  handler: async (ctx, { now }) => {
    await requireConsoleAdmin(ctx)
    const s = guardSettings()
    const rows = await ctx.db
      .query('llmUsage')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', now - 60 * 60_000))
      .take(HEALTH_SCAN)
    const providers = [...groupBy(rows, (r) => r.providerId)].map(([providerId, list]) => ({ providerId, stats: healthOf(list) }))
    providers.sort((a, b) => b.stats.calls - a.stats.calls)
    const open = await ctx.db
      .query('aiBreakers')
      .withIndex('by_openUntil', (q) => q.gt('openUntil', now))
      .take(50)
    const breakers = []
    for (const b of open) {
      const company = b.companyId ? await ctx.db.get(b.companyId) : null
      breakers.push({
        id: b._id,
        scope: b.scope === 'server' ? 'server' : 'org',
        tenant: company?.name ?? null,
        providerId: b.providerId,
        model: b.model,
        openUntil: b.openUntil,
        lastKind: b.lastKind ?? null,
        refused: !!b.refused,
      })
    }
    const alerts = await ctx.db
      .query('aiAlerts')
      .withIndex('by_active_and_lastSeenAt', (q) => q.eq('active', true))
      .order('desc')
      .take(20)
    return {
      lastHour: healthOf(rows),
      truncated: rows.length >= HEALTH_SCAN,
      providers,
      monthSpendUsd: { server: Math.round((await serverSpendUsd(ctx, monthOf(now))) * 100) / 100, serverBudgetUsd: s.serverBudgetUsd },
      breakers,
      alerts: alerts.map((a) => ({ kind: a.kind, message: a.message, lastSeenAt: a.lastSeenAt })),
    }
  },
})

/** Budget status per tenant this month, highest spend first (paginated). */
export const tenantBudgets = query({
  args: { now: v.number(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      companyId: v.id('companies'),
      name: v.string(),
      spentUsd: v.number(),
      calls: v.number(),
      errors: v.number(),
      effectiveUsd: v.union(v.number(), v.null()),
      usedPct: v.union(v.number(), v.null()),
      platformBudgetUsd: v.union(v.number(), v.null()),
      allowedOver: v.boolean(),
    }),
  ),
  handler: async (ctx, { now, paginationOpts }) => {
    await requireConsoleAdmin(ctx)
    const s = guardSettings()
    const month = monthOf(now)
    const res = await ctx.db
      .query('aiSpend')
      .withIndex('by_kind_and_month_and_costUsd', (q) => q.eq('kind', 'company').eq('month', month))
      .order('desc')
      .paginate(paginationOpts)
    const page = []
    for (const r of res.page) {
      if (!r.companyId) continue
      const company = await ctx.db.get(r.companyId)
      const row = await budgetRow(ctx, r.companyId)
      const budget = effectiveBudget(row, s)
      const used = budgetUsed(r, budget)
      page.push({
        companyId: r.companyId,
        name: company?.name ?? '—',
        spentUsd: r.costUsd,
        calls: r.calls,
        errors: r.errors,
        effectiveUsd: budget.usd,
        usedPct: used === null ? null : Math.round(used * 1000) / 10,
        platformBudgetUsd: row?.platformBudgetUsd ?? null,
        allowedOver: row?.allowOverBudgetMonth === month,
      })
    }
    return { ...res, page }
  },
})

/** Platform admin: a tenant's budget (null = env default) and whether it may go over this month. */
export const setTenantOverride = mutation({
  args: {
    companyId: v.id('companies'),
    platformBudgetUsd: v.union(v.number(), v.null()),
    allowOverBudget: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireConsoleAdmin(ctx)
    const company = await ctx.db.get(args.companyId)
    if (!company) throw userError('NOT_FOUND', 'Tenant not found')
    const now = Date.now()
    const usd = cleanAmount(args.platformBudgetUsd, MAX_BUDGET_USD, 'Tenant budget')
    const month = monthOf(now)
    const row = await budgetRow(ctx, args.companyId)
    const fields = {
      platformBudgetUsd: usd,
      allowOverBudgetMonth: args.allowOverBudget ? month : undefined,
      platformUpdatedBy: admin._id,
      platformUpdatedAt: now,
    }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('aiBudgets', { companyId: args.companyId, updatedAt: now, ...fields })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'ai.budget_override',
      companyId: args.companyId,
      targetTable: 'aiBudgets',
      targetId: args.companyId,
      details: { platformBudgetUsd: usd ?? null, allowOverBudgetMonth: fields.allowOverBudgetMonth ?? null },
    })
    return null
  },
})

/** Platform admin: close a breaker now (a model paused by mistake or a provider back early); audited. */
export const resetBreaker = mutation({
  args: { breakerId: v.id('aiBreakers') },
  returns: v.null(),
  handler: async (ctx, { breakerId }) => {
    const admin = await requireConsoleAdmin(ctx)
    const b = await ctx.db.get(breakerId)
    if (!b) throw userError('NOT_FOUND', 'Breaker not found')
    const now = Date.now()
    await ctx.db.patch(b._id, { ...CLOSED, lastKind: undefined, refused: undefined, updatedAt: now })
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'ai.breaker_reset',
      ...(b.companyId ? { companyId: b.companyId } : {}),
      targetTable: 'aiBreakers',
      targetId: b._id,
      details: { scope: b.scope === 'server' ? 'server' : 'org', providerId: b.providerId, model: b.model, openUntil: b.openUntil, lastKind: b.lastKind ?? null },
    })
    return null
  },
})
