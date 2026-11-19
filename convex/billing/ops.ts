/**
 * Billing and platform operations shared by the console (convex/platform/*),
 * the billing cron and the backfill. Plain helpers, not Convex functions:
 * callers authorize first.
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { insertAuditLog } from '../lib/auditChain'
import { notifyUsers } from '../lib/notify'
import { currentSubscription } from '../lib/planLimits'
import { userError } from '../lib/errors'
import { DAY_MS, DEFAULT_PLANS, addInterval, billingCurrency, invoiceTotal, renewedPeriod } from './model'

/** Platform audit: a platformEvents row, and the organization's own audit chain when it concerns one. */
export async function recordPlatformEvent(
  ctx: MutationCtx,
  row: {
    actorId?: Id<'users'>
    action: string
    companyId?: Id<'companies'>
    targetTable?: string
    targetId?: string
    details?: unknown
  },
  opts: { orgAudit?: boolean } = {},
) {
  const at = Date.now()
  await ctx.db.insert('platformEvents', { ...row, at })
  if (row.companyId && opts.orgAudit !== false) {
    await insertAuditLog(ctx, {
      userId: row.actorId,
      companyId: row.companyId,
      actionType: `platform.${row.action}`,
      tableName: row.targetTable ?? 'companies',
      recordId: row.targetId ?? row.companyId,
      newValues: row.details,
    })
  }
}

/** The default plan, creating the default plan set when there are no plans at all. */
export async function ensureDefaultPlans(ctx: MutationCtx): Promise<Doc<'plans'>> {
  const existingDefault = await ctx.db
    .query('plans')
    .withIndex('by_isDefault', (q) => q.eq('isDefault', true))
    .first()
  if (existingDefault) return existingDefault
  const any = await ctx.db.query('plans').first()
  if (any) return any
  const now = Date.now()
  let defaultId: Id<'plans'> | null = null
  for (const seed of DEFAULT_PLANS) {
    const id = await ctx.db.insert('plans', { ...seed, active: true, createdAt: now, updatedAt: now })
    if (seed.isDefault) defaultId = id
  }
  return (await ctx.db.get(defaultId!))!
}

export async function startSubscription(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  plan: Doc<'plans'>,
  opts: { status: 'trialing' | 'active'; now?: number; trialDays?: number },
): Promise<Id<'subscriptions'>> {
  const now = opts.now ?? Date.now()
  const company = await ctx.db.get(companyId)
  const currency = billingCurrency(plan, company?.settings?.locale?.currency)
  const trialEndsAt = opts.status === 'trialing' ? now + (opts.trialDays ?? plan.trialDays) * DAY_MS : undefined
  return await ctx.db.insert('subscriptions', {
    companyId,
    planId: plan._id,
    status: opts.status,
    currency,
    currentPeriodStart: now,
    currentPeriodEnd: trialEndsAt ?? addInterval(now, plan.interval),
    trialEndsAt,
    provider: 'manual',
    createdAt: now,
    updatedAt: now,
  })
}

/** A newly approved organization starts a trial on the default plan (no-op if it has a subscription). */
export async function ensureTrialSubscription(ctx: MutationCtx, companyId: Id<'companies'>) {
  if (await currentSubscription(ctx, companyId)) return null
  const plan = await ensureDefaultPlans(ctx)
  return await startSubscription(ctx, companyId, plan, { status: 'trialing' })
}

export async function suspendCompany(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  opts: { source: 'platform' | 'billing'; reason: string; actorId?: Id<'users'> },
) {
  const company = await ctx.db.get(companyId)
  if (!company) throw userError('NOT_FOUND', 'Organization not found')
  if (company.suspendedAt !== undefined) return false
  await ctx.db.patch(companyId, {
    suspendedAt: Date.now(),
    suspendedBy: opts.actorId,
    suspensionReason: opts.reason.slice(0, 500),
    suspensionSource: opts.source,
  })
  return true
}

export async function unsuspendCompany(ctx: MutationCtx, companyId: Id<'companies'>) {
  const company = await ctx.db.get(companyId)
  if (!company || company.suspendedAt === undefined) return false
  await ctx.db.patch(companyId, {
    suspendedAt: undefined,
    suspendedBy: undefined,
    suspensionReason: undefined,
    suspensionSource: undefined,
  })
  return true
}

/** Owners and admins of an organization (active members), for billing notices. */
export async function billingContacts(ctx: MutationCtx, companyId: Id<'companies'>): Promise<Doc<'users'>[]> {
  const out: Doc<'users'>[] = []
  for await (const m of ctx.db.query('memberships').withIndex('by_companyId', (q) => q.eq('companyId', companyId))) {
    if (m.status !== 'active' || (m.roleKey !== 'owner' && m.roleKey !== 'admin')) continue
    const u = await ctx.db.get(m.userId)
    if (u && u.active !== false) out.push(u)
    if (out.length >= 10) break
  }
  return out
}

export async function notifyBilling(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  notice: { title: string; message: string; level?: 'info' | 'warning' | 'error'; dedupeKey?: string },
) {
  const users = await billingContacts(ctx, companyId)
  if (!users.length) return
  await notifyUsers(ctx, {
    companyId,
    users,
    channels: ['in_app', 'email'],
    title: notice.title,
    message: notice.message,
    link: '/billing',
    level: notice.level ?? 'warning',
    dedupeKey: notice.dedupeKey,
    source: 'billing',
  })
}

async function nextInvoiceNumber(ctx: MutationCtx, now: number): Promise<string> {
  const d = new Date(now)
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const latest = await ctx.db.query('billingInvoices').withIndex('by_issuedAt').order('desc').first()
  let seq = 1
  const m = latest?.number.match(/^INV-(\d{6})-(\d+)$/)
  if (m && m[1] === stamp) seq = Number(m[2]) + 1
  for (;;) {
    const number = `INV-${stamp}-${String(seq).padStart(4, '0')}`
    const taken = await ctx.db
      .query('billingInvoices')
      .withIndex('by_number', (q) => q.eq('number', number))
      .first()
    if (!taken) return number
    seq += 1
  }
}

export async function createInvoice(
  ctx: MutationCtx,
  args: {
    companyId: Id<'companies'>
    subscriptionId?: Id<'subscriptions'>
    currency: string
    lines: { description: string; quantity: number; unitAmountMinor: number }[]
    dueInDays: number
    periodStart?: number
    periodEnd?: number
    createdBy?: Id<'users'>
  },
): Promise<Doc<'billingInvoices'>> {
  const now = Date.now()
  const id = await ctx.db.insert('billingInvoices', {
    companyId: args.companyId,
    subscriptionId: args.subscriptionId,
    number: await nextInvoiceNumber(ctx, now),
    currency: args.currency,
    lines: args.lines,
    totalMinor: invoiceTotal(args.lines),
    paidMinor: 0,
    status: 'open',
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    issuedAt: now,
    dueAt: now + args.dueInDays * DAY_MS,
    provider: 'manual',
    createdBy: args.createdBy,
  })
  return (await ctx.db.get(id))!
}

export type PaymentInput = {
  companyId: Id<'companies'>
  invoiceId?: Id<'billingInvoices'>
  currency: string
  amountMinor: number
  method: Doc<'billingPayments'>['method']
  provider: Doc<'billingPayments'>['provider']
  providerRef?: string
  idempotencyKey: string
  receivedAt?: number
  note?: string
  recordedBy?: Id<'users'>
}

/**
 * Record a successful payment once per idempotency key. A repeat with the
 * same key returns the first payment and changes nothing. Paying an invoice
 * in full renews its subscription to active and lifts a billing suspension.
 */
export async function applyPayment(
  ctx: MutationCtx,
  input: PaymentInput,
): Promise<{ paymentId: Id<'billingPayments'>; duplicate: boolean; invoicePaid: boolean; reactivated: boolean }> {
  const key = input.idempotencyKey.trim()
  if (!key) throw userError('VALIDATION', 'An idempotency key is required', { field: 'idempotencyKey' })
  const prior = await ctx.db
    .query('billingPayments')
    .withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', key))
    .first()
  if (prior) {
    if (prior.companyId !== input.companyId || prior.amountMinor !== input.amountMinor) {
      throw userError('CONFLICT', 'This idempotency key was already used for a different payment', { reason: 'IDEMPOTENCY_MISMATCH' })
    }
    return { paymentId: prior._id, duplicate: true, invoicePaid: false, reactivated: false }
  }
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0 || !Number.isInteger(input.amountMinor)) {
    throw userError('VALIDATION', 'Amount must be a positive whole number of minor units', { field: 'amountMinor' })
  }
  const invoice = input.invoiceId ? await ctx.db.get(input.invoiceId) : null
  if (input.invoiceId) {
    if (!invoice || invoice.companyId !== input.companyId) throw userError('NOT_FOUND', 'Invoice not found')
    if (invoice.status === 'void') throw userError('CONFLICT', 'This invoice was voided')
    if (invoice.currency !== input.currency) {
      throw userError('VALIDATION', `This invoice is in ${invoice.currency}`, { field: 'currency' })
    }
  }
  const now = Date.now()
  const paymentId = await ctx.db.insert('billingPayments', {
    companyId: input.companyId,
    invoiceId: input.invoiceId,
    currency: input.currency,
    amountMinor: input.amountMinor,
    method: input.method,
    provider: input.provider,
    providerRef: input.providerRef,
    idempotencyKey: key,
    status: 'succeeded',
    receivedAt: input.receivedAt ?? now,
    note: input.note,
    recordedBy: input.recordedBy,
    createdAt: now,
  })
  let invoicePaid = false
  let reactivated = false
  if (invoice && invoice.status === 'open') {
    const paidMinor = invoice.paidMinor + input.amountMinor
    invoicePaid = paidMinor >= invoice.totalMinor
    await ctx.db.patch(invoice._id, {
      paidMinor,
      ...(invoicePaid ? { status: 'paid' as const, paidAt: now } : {}),
    })
    if (invoicePaid && invoice.subscriptionId) {
      const sub = await ctx.db.get(invoice.subscriptionId)
      const plan = sub ? await ctx.db.get(sub.planId) : null
      if (sub && plan && sub.status !== 'cancelled') {
        await ctx.db.patch(sub._id, {
          status: 'active',
          ...renewedPeriod(sub, plan.interval, now, invoice),
          trialEndsAt: undefined,
          pastDueAt: undefined,
          graceEndsAt: undefined,
          suspendedAt: undefined,
          updatedAt: now,
        })
        const company = await ctx.db.get(input.companyId)
        if (company?.suspensionSource === 'billing') reactivated = await unsuspendCompany(ctx, input.companyId)
      }
    }
  }
  return { paymentId, duplicate: false, invoicePaid, reactivated }
}
