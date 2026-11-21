import { v } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { internalMutation, mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { AUTH_ERROR_MESSAGES } from '../lib/authErrors'
import { requireMember } from '../lib/permissions'
import { userError } from '../lib/errors'
import { maskPhone } from '../lib/phone'
import { logAudit } from '../lib/tenancy'
import type { RunDelivery } from '../automation/validators'
import {
  outboxChannel,
  outboxSource,
  outboxStatus,
  type OutboxChannel,
  type OutboxSource,
  type OutboxStatus,
} from './outboxTables'

/**
 * Outbound message log and usage meters (Paper 57b, doc 18).
 *
 * Writes: automation runs and notification dispatches sync their deliveries
 * here from their own mutations (queued → sent / failed, retries back to
 * queued); direct sends (sign-in codes, test sends, reports, Farm bot
 * reminders and approval prompts) record one row through `record`.
 * Reads: admins with integrations.manage, their own organization only. Only
 * masked addresses are stored or returned.
 */

export const OUTBOX_RETENTION_DAYS = 90
const BODY_MAX = 300
const ERROR_MAX = 200
const WHATSAPP_CONVERSATION_MS = 24 * 60 * 60 * 1000
/** Default monthly budgets for the meters; a company can change them. */
export const DEFAULT_MONTHLY_BUDGET = { sms: 5000, whatsapp: 1000, email: 10000 } as const
/** Bounds for the Telegram "people linked" count (design scale: 1,000 users). */
const MAX_MEMBERS_COUNTED = 5000
const MAX_BINDINGS_COUNTED = 10000

type Ctx = QueryCtx | MutationCtx

/** A retry is offered only once the owner has stopped sending (no double sends). */
const SETTLED = new Set(['succeeded', 'partial', 'failed', 'skipped'])

async function requireMessagingAdmin(ctx: Ctx) {
  const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  return { user, companyId: user.companyId }
}

/** UTC month of a timestamp, "YYYY-MM". */
export function periodOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7)
}

/** Mask an address for display: phones keep the country code and last 3 digits. */
export function maskAddress(channel: OutboxChannel, to: string): string {
  const raw = to.trim()
  if (!raw) return ''
  if (channel === 'email') {
    const at = raw.lastIndexOf('@')
    return at > 0 ? `${raw[0]}…${raw.slice(at)}` : '•••'
  }
  if (channel === 'telegram') return `••• ${raw.slice(-3)}`
  return maskPhone(raw.startsWith('+') ? raw : `+${raw}`)
}

/** FNV-1a: a stable, non-reversible-enough key for an address without a user. */
function addressKey(to: string): string {
  let h = 0x811c9dc5
  for (const c of to.trim().toLowerCase()) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `a:${h.toString(36)}`
}

export type OutboundEntry = {
  companyId: Id<'companies'>
  channel: OutboxChannel
  status: OutboxStatus
  source: OutboxSource
  /** Raw address; only its mask is stored. */
  to: string
  /** `to` is already masked (test sends keep only the mask). */
  masked?: boolean
  key?: string
  recipientUserId?: Id<'users'>
  /** For non-user recipients (customers); users are named from their account. */
  recipientName?: string
  recipientRole?: 'customer' | 'supplier'
  body?: string
  error?: string
  nextAttemptAt?: number
  dispatchId?: Id<'notificationDispatches'>
  runId?: Id<'automationRuns'>
  deliveryIndex?: number
}

async function bumpUsage(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  channel: OutboxChannel,
  newConversation: boolean,
  now: number,
) {
  const period = periodOf(now)
  const row = await ctx.db
    .query('messageUsage')
    .withIndex('by_companyId_and_period_and_channel', (q) =>
      q.eq('companyId', companyId).eq('period', period).eq('channel', channel),
    )
    .unique()
  const add = newConversation ? 1 : 0
  if (row) {
    await ctx.db.patch(row._id, { count: row.count + 1, conversations: row.conversations + add, updatedAt: now })
  } else {
    await ctx.db.insert('messageUsage', { companyId, period, channel, count: 1, conversations: add, updatedAt: now })
  }
}

/** Whether a WhatsApp send opens a new 24-hour conversation with this recipient. */
async function opensConversation(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  recipientKey: string,
  now: number,
): Promise<boolean> {
  const recent = await ctx.db
    .query('outboundMessages')
    .withIndex('by_companyId_and_channel_and_recipientKey_and_sentAt', (q) =>
      q
        .eq('companyId', companyId)
        .eq('channel', 'whatsapp')
        .eq('recipientKey', recipientKey)
        .gt('sentAt', now - WHATSAPP_CONVERSATION_MS),
    )
    .first()
  return recent === null
}

/**
 * Insert or update one log row (by `key` when given) and count it in the
 * month's usage the first time it is sent. Mutation context only.
 */
export async function logOutbound(ctx: MutationCtx, e: OutboundEntry): Promise<Id<'outboundMessages'>> {
  const now = Date.now()
  const recipientKey = e.recipientUserId ? `u:${e.recipientUserId}` : addressKey(e.to)
  const existing = e.key
    ? await ctx.db
        .query('outboundMessages')
        .withIndex('by_companyId_and_key', (q) => q.eq('companyId', e.companyId).eq('key', e.key))
        .unique()
    : null
  const becameSent = e.status === 'sent' && existing?.status !== 'sent'
  const newConversation =
    becameSent && e.channel === 'whatsapp' ? await opensConversation(ctx, e.companyId, recipientKey, now) : false
  const attempted = e.status !== 'queued'
  const error = e.status === 'failed' ? e.error?.slice(0, ERROR_MAX) : undefined

  let id: Id<'outboundMessages'>
  if (existing) {
    // A settled row only moves again through a retry (failed → queued → …).
    if (existing.status === e.status && existing.nextAttemptAt === e.nextAttemptAt) return existing._id
    await ctx.db.patch(existing._id, {
      status: e.status,
      error,
      nextAttemptAt: e.status === 'queued' ? e.nextAttemptAt : undefined,
      attempts: existing.attempts + (attempted ? 1 : 0),
      ...(becameSent ? { sentAt: now } : {}),
      updatedAt: now,
    })
    id = existing._id
  } else {
    let recipientName = e.recipientName?.slice(0, 120)
    let recipientUserId = e.recipientUserId
    if (recipientUserId) {
      // Name only people of this organization (never another tenant's user).
      const user = await ctx.db.get(recipientUserId)
      const member =
        user &&
        (user.companyId === e.companyId ||
          (await ctx.db
            .query('memberships')
            .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', e.companyId).eq('userId', recipientUserId!))
            .unique()) !== null)
      if (member) recipientName = user.name || user.email?.split('@')[0] || recipientName
      else recipientUserId = undefined
    }
    const body = e.source === 'code' ? undefined : e.body?.replace(/\s+/g, ' ').trim().slice(0, BODY_MAX)
    id = await ctx.db.insert('outboundMessages', {
      companyId: e.companyId,
      channel: e.channel,
      status: e.status,
      source: e.source,
      key: e.key,
      recipientUserId,
      recipientName,
      recipientRole: recipientUserId ? undefined : e.recipientRole,
      toMasked: e.masked ? e.to.slice(0, 80) : maskAddress(e.channel, e.to),
      recipientKey,
      body,
      searchText: `${recipientName ?? ''} ${body ?? ''}`.trim(),
      error,
      attempts: attempted ? 1 : 0,
      nextAttemptAt: e.status === 'queued' ? e.nextAttemptAt : undefined,
      dispatchId: e.dispatchId,
      runId: e.runId,
      deliveryIndex: e.deliveryIndex,
      sentAt: becameSent ? now : undefined,
      createdAt: now,
      updatedAt: now,
    })
  }
  if (becameSent) await bumpUsage(ctx, e.companyId, e.channel, newConversation, now)
  return id
}

/**
 * Mirror a dispatch's or run's deliveries into the log. `pending` becomes
 * queued (with the retry time when one is scheduled); skipped deliveries
 * (quiet hours, no address) never left and are not logged.
 */
export async function syncDeliveries(
  ctx: MutationCtx,
  args: {
    companyId: Id<'companies'>
    source: 'automation' | 'notification'
    parent: { dispatchId: Id<'notificationDispatches'> } | { runId: Id<'automationRuns'> }
    deliveries: RunDelivery[]
    nextAttemptAt?: number
  },
) {
  const prefix = 'dispatchId' in args.parent ? `nd:${args.parent.dispatchId}` : `ar:${args.parent.runId}`
  for (const [index, d] of args.deliveries.entries()) {
    if (d.status === 'skipped') continue
    await logOutbound(ctx, {
      companyId: args.companyId,
      channel: d.channel,
      status: d.status === 'pending' ? 'queued' : d.status,
      source: args.source,
      to: d.to,
      key: `${prefix}:${index}`,
      recipientUserId: d.userId,
      body: d.channel === 'email' ? d.subject : d.body,
      error: d.error,
      nextAttemptAt: d.status === 'pending' ? args.nextAttemptAt : undefined,
      ...args.parent,
      deliveryIndex: index,
    })
  }
}

/** Internal: record one direct send (codes, tests, reports, Farm bot). */
export const record = internalMutation({
  args: {
    companyId: v.id('companies'),
    channel: outboxChannel,
    ok: v.boolean(),
    source: outboxSource,
    to: v.string(),
    recipientUserId: v.optional(v.id('users')),
    /** Bot sends: the recipient is the binding's user. */
    bindingId: v.optional(v.id('channelBindings')),
    body: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let recipientUserId = args.recipientUserId
    if (args.bindingId) {
      const b = await ctx.db.get(args.bindingId)
      if (!b || b.companyId !== args.companyId) return null
      recipientUserId = b.userId
    }
    if (recipientUserId) {
      const user = await ctx.db.get(recipientUserId)
      if (!user) recipientUserId = undefined
    }
    await logOutbound(ctx, {
      companyId: args.companyId,
      channel: args.channel,
      status: args.ok ? 'sent' : 'failed',
      source: args.source,
      to: args.to,
      recipientUserId,
      body: args.body,
      error: args.error,
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Reads (Paper 57b): Outbox table, search, usage meters.
// ---------------------------------------------------------------------------

const outboxFilter = v.union(v.literal('all'), v.literal('queued'), v.literal('failed'))

const outboxRow = v.object({
  id: v.id('outboundMessages'),
  channel: outboxChannel,
  status: outboxStatus,
  source: outboxSource,
  recipientName: v.union(v.string(), v.null()),
  /** Role template key (translated by the client) or a custom role's name. */
  roleKey: v.union(v.string(), v.null()),
  roleName: v.union(v.string(), v.null()),
  toMasked: v.string(),
  body: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
  nextAttemptAt: v.union(v.number(), v.null()),
  canRetry: v.boolean(),
  createdAt: v.number(),
  sentAt: v.union(v.number(), v.null()),
})

async function toRow(ctx: QueryCtx, m: Doc<'outboundMessages'>) {
  let roleKey: string | null = null
  let roleName: string | null = null
  if (m.recipientUserId) {
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_companyId_and_userId', (q) =>
        q.eq('companyId', m.companyId).eq('userId', m.recipientUserId!),
      )
      .unique()
    if (membership) {
      roleKey = membership.roleKey
      if (membership.roleId) {
        const role = await ctx.db.get(membership.roleId)
        roleName = role && role.companyId === m.companyId ? role.name : null
      }
    } else {
      // Legacy accounts without a membership row (admin → admin, user → manager).
      const user = await ctx.db.get(m.recipientUserId)
      if (user?.companyId === m.companyId) roleKey = user.role === 'admin' ? 'admin' : 'manager'
    }
  } else if (m.recipientRole) {
    roleKey = m.recipientRole
  }
  return {
    id: m._id,
    channel: m.channel,
    status: m.status,
    source: m.source,
    recipientName: m.recipientName ?? null,
    roleKey,
    roleName,
    toMasked: m.toMasked,
    body: m.body ?? null,
    error: m.error ?? null,
    nextAttemptAt: m.nextAttemptAt ?? null,
    canRetry: m.status === 'failed' && (m.dispatchId !== undefined || m.runId !== undefined),
    createdAt: m.createdAt,
    sentAt: m.sentAt ?? null,
  }
}

/** The Outbox table: newest first, All / Queued / Failed, paginated. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator, filter: outboxFilter },
  returns: paginationResultValidator(outboxRow),
  handler: async (ctx, { paginationOpts, filter }) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const result =
      filter === 'all'
        ? await ctx.db
            .query('outboundMessages')
            .withIndex('by_companyId_and_createdAt', (q) => q.eq('companyId', companyId))
            .order('desc')
            .paginate(paginationOpts)
        : await ctx.db
            .query('outboundMessages')
            .withIndex('by_companyId_and_status_and_createdAt', (q) =>
              q.eq('companyId', companyId).eq('status', filter),
            )
            .order('desc')
            .paginate(paginationOpts)
    const page = []
    for (const m of result.page) page.push(await toRow(ctx, m))
    return { ...result, page }
  },
})

/** Search the Outbox by recipient name or message (best matches, at most 25). */
export const search = query({
  args: { text: v.string(), filter: outboxFilter },
  returns: v.array(outboxRow),
  handler: async (ctx, { text, filter }) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const term = text.trim().slice(0, 100)
    if (!term) return []
    const hits = await ctx.db
      .query('outboundMessages')
      .withSearchIndex('search_text', (q) => {
        const base = q.search('searchText', term).eq('companyId', companyId)
        return filter === 'all' ? base : base.eq('status', filter)
      })
      .take(25)
    const rows = []
    for (const m of hits) rows.push(await toRow(ctx, m))
    return rows
  },
})

const meter = v.object({ used: v.number(), budget: v.number() })

/**
 * Usage meters for the channel tiles. `period` ("YYYY-MM", UTC) comes from
 * the client so the query never reads the clock.
 */
export const usage = query({
  args: { period: v.string() },
  returns: v.object({
    period: v.string(),
    sms: meter,
    whatsapp: meter,
    email: meter,
    telegram: v.object({
      configured: v.boolean(),
      botUsername: v.union(v.string(), v.null()),
      linked: v.number(),
      members: v.number(),
    }),
  }),
  handler: async (ctx, { period }) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw userError('VALIDATION', 'Invalid period')
    const company = await ctx.db.get(companyId)
    const budget = company?.settings?.messaging?.monthlyBudget
    const rows = await ctx.db
      .query('messageUsage')
      .withIndex('by_companyId_and_period_and_channel', (q) => q.eq('companyId', companyId).eq('period', period))
      .take(10)
    const used = (c: OutboxChannel, conv = false) => {
      const r = rows.find((x) => x.channel === c)
      return r ? (conv ? r.conversations : r.count) : 0
    }

    // People linked: distinct active members with a live Telegram chat.
    const members = new Set<Id<'users'>>()
    for await (const m of ctx.db
      .query('memberships')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))) {
      if (m.status === 'active') members.add(m.userId)
      if (members.size >= MAX_MEMBERS_COUNTED) break
    }
    const linked = new Set<Id<'users'>>()
    let scanned = 0
    for await (const b of ctx.db
      .query('channelBindings')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))) {
      if (++scanned > MAX_BINDINGS_COUNTED) break
      if (b.provider === 'telegram' && !b.revokedAt && members.has(b.userId)) linked.add(b.userId)
    }
    const username = process.env.TELEGRAM_BOT_USERNAME || null
    return {
      period,
      sms: { used: used('sms'), budget: budget?.sms ?? DEFAULT_MONTHLY_BUDGET.sms },
      whatsapp: { used: used('whatsapp', true), budget: budget?.whatsapp ?? DEFAULT_MONTHLY_BUDGET.whatsapp },
      email: { used: used('email'), budget: budget?.email ?? DEFAULT_MONTHLY_BUDGET.email },
      telegram: {
        configured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET),
        botUsername: username ? username.replace(/^@/, '') : null,
        linked: linked.size,
        members: members.size,
      },
    }
  },
})

/**
 * Retry a failed message through the dispatch or run that owns it: the
 * delivery goes back to pending and the owner sends it once more.
 */
export const retry = mutation({
  args: { messageId: v.id('outboundMessages') },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const m = await ctx.db.get(messageId)
    if (!m || m.companyId !== companyId) throw userError('NOT_FOUND', 'Message not found')
    if (m.status !== 'failed') throw userError('VALIDATION', 'Only a failed message can be retried')
    const index = m.deliveryIndex
    if (index === undefined) throw userError('VALIDATION', 'This message cannot be retried')
    const now = Date.now()

    if (m.dispatchId) {
      const d = await ctx.db.get(m.dispatchId)
      const x = d?.deliveries[index]
      if (!d || d.companyId !== companyId || !x || x.status !== 'failed' || !SETTLED.has(d.status)) {
        throw userError('VALIDATION', 'This message cannot be retried')
      }
      const deliveries = d.deliveries.map((y, i) => (i === index ? { ...y, status: 'pending' as const } : y))
      await ctx.db.patch(d._id, {
        deliveries,
        status: 'retrying',
        maxAttempts: Math.max(d.maxAttempts, d.attempts + 1),
        nextAttemptAt: now,
        finishedAt: undefined,
      })
      await ctx.scheduler.runAfter(0, internal.notificationDispatch.send, { dispatchId: d._id })
    } else if (m.runId) {
      const run = await ctx.db.get(m.runId)
      const x = run?.deliveries?.[index]
      if (!run || run.companyId !== companyId || !x || x.status !== 'failed' || !run.localDone || !SETTLED.has(run.status)) {
        throw userError('VALIDATION', 'This message cannot be retried')
      }
      const deliveries = (run.deliveries ?? []).map((y, i) => (i === index ? { ...y, status: 'pending' as const } : y))
      await ctx.db.patch(run._id, {
        deliveries,
        status: 'retrying',
        maxAttempts: Math.max(run.maxAttempts, run.attempts + 1),
        nextAttemptAt: now,
        finishedAt: undefined,
      })
      await ctx.scheduler.runAfter(0, internal.automation.engine.executeRun, { runId: run._id })
    } else {
      throw userError('VALIDATION', 'This message cannot be retried')
    }
    await ctx.db.patch(m._id, { status: 'queued', nextAttemptAt: now, error: undefined, updatedAt: now })
    await logAudit(ctx, {
      actionType: 'outbox_retry',
      tableName: 'outboundMessages',
      recordId: m._id,
      newValues: { channel: m.channel },
    })
    return null
  },
})

/** Daily: delete rows older than the retention window (batches of 500). */
export const prune = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - OUTBOX_RETENTION_DAYS * 86_400_000
    const old = await ctx.db
      .query('outboundMessages')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    for (const m of old) await ctx.db.delete(m._id)
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.messaging.outbox.prune, {})
    return old.length
  },
})
