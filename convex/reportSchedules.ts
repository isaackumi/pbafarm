import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { internalAction, internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { userError } from './lib/errors'
import { can, memberContextIn, requireMember, requirePermission, type MemberContext } from './lib/permissions'
import { logAudit } from './lib/tenancy'
import { runEffect } from './lib/effect'
import { deliverMessage } from './messaging/deliver'
import { sendAll } from './automation/deliver'
import { MAX_ATTEMPTS, RETRY_BACKOFF_MIN, companyZone, prefsFor } from './automation/engine'
import { inQuietHours, isValidTimeZone, localParts } from './automation/schedule'
import { checkTiming, nextReportRun } from './lib/reportSchedule'
import { base64Utf8, reportEmail } from './lib/reportEmail'
import { emailLocale } from './lib/emailTemplates'
import { reportDeliveryStatus, scheduleFrequency } from './lib/reportValidators'
import { canReadDataset, canSeeReport } from './reportBuilder'

/**
 * Scheduled report emails (ANLY-007). A schedule emails a saved report as CSV
 * daily, weekly or monthly in its own time zone.
 *
 *   tick (cron, 15 min): due schedules → one reportDeliveries row per
 *     (schedule, local date) slot, bounded per run and per company.
 *   send (action): start → run the report as the schedule owner → sendAll
 *     (Effect) through the company's email route (messaging/deliver) → finish.
 *   finish: retry only failures the provider marked retryable (429/5xx and
 *     network errors, PLAT-007), never timeouts, with back-off; else settle.
 *
 * The CSV is rebuilt on each attempt and never stored. Recipients are company
 * members who may read the dataset and whose sites cover the owner's; each
 * one's email preference and quiet hours apply (as AUTO-003 notifications).
 */

type Ctx = QueryCtx | MutationCtx

export const MAX_RECIPIENTS = 20
export const MAX_SCHEDULES_PER_COMPANY = 50
export const DELIVERY_RETENTION_DAYS = 90
const TICK_BATCH = 50
const MAX_PER_COMPANY_PER_TICK = 10
const SEND_NOW_COOLDOWN_MS = 5 * 60_000

function invalid(message: string): never {
  throw userError('VALIDATION', message)
}

function companyOf(m: MemberContext): Id<'companies'> {
  if (!m.companyId) throw userError('FORBIDDEN', 'Choose an organization first')
  return m.companyId
}

/** Whether `recipient` may see everything the owner's run contains. */
export function coversScope(owner: MemberContext['siteScope'], recipient: MemberContext['siteScope']) {
  if (recipient === 'all') return true
  if (owner === 'all') return false
  for (const s of owner) if (!recipient.has(s)) return false
  return true
}

/** Why a member cannot receive the report, or null when they can. */
function ineligible(owner: MemberContext, mc: MemberContext | null, report: Doc<'savedReports'>): string | null {
  if (!mc) return 'Not an active member'
  if (!canReadDataset(mc, report.definition)) return 'Cannot read this data'
  if (!coversScope(owner.siteScope, mc.siteScope)) return 'Does not have access to all sites in the report'
  return null
}

async function loadSchedule(ctx: Ctx, m: MemberContext, scheduleId: Id<'reportSchedules'>) {
  const s = await ctx.db.get(scheduleId)
  if (!s || s.companyId !== m.companyId) throw userError('NOT_FOUND', 'Schedule not found')
  const report = await ctx.db.get(s.reportId)
  if (!report || !canSeeReport(m, report)) throw userError('NOT_FOUND', 'Schedule not found')
  return { s, report }
}

function canEditSchedule(m: MemberContext, s: Doc<'reportSchedules'>) {
  return s.createdBy === m.user._id || can(m, 'org.settings.manage')
}

async function checkRecipients(
  ctx: Ctx,
  owner: MemberContext,
  companyId: Id<'companies'>,
  report: Doc<'savedReports'>,
  ids: Id<'users'>[],
): Promise<Id<'users'>[]> {
  const unique = [...new Set(ids)]
  if (!unique.length) invalid('Add at least one recipient')
  if (unique.length > MAX_RECIPIENTS) invalid(`At most ${MAX_RECIPIENTS} recipients`)
  for (const id of unique) {
    const u = await ctx.db.get(id)
    const why = ineligible(owner, u ? await memberContextIn(ctx, u, companyId) : null, report)
    if (why) invalid(`${u?.name || u?.email || 'A recipient'}: ${why.toLowerCase()}`)
  }
  return unique
}

// ─── Queries ────────────────────────────────────────────────────────────────

const scheduleView = v.object({
  _id: v.id('reportSchedules'),
  reportId: v.id('savedReports'),
  reportName: v.string(),
  frequency: scheduleFrequency,
  localTime: v.string(),
  weekday: v.optional(v.number()),
  dayOfMonth: v.optional(v.number()),
  timezone: v.string(),
  recipients: v.array(v.object({ userId: v.id('users'), name: v.string() })),
  enabled: v.boolean(),
  nextRunAt: v.optional(v.number()),
  lastRunAt: v.optional(v.number()),
  lastStatus: v.optional(reportDeliveryStatus),
  createdByName: v.string(),
  canEdit: v.boolean(),
})

function displayName(u: Doc<'users'> | null) {
  return (u?.name || '').trim() || u?.email || 'Former member'
}

/** Schedules of reports the caller can see. */
export const list = query({
  args: {},
  returns: v.array(scheduleView),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    const companyId = companyOf(m)
    const rows = await ctx.db
      .query('reportSchedules')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(MAX_SCHEDULES_PER_COMPANY + 1)
    const users = new Map<string, Doc<'users'> | null>()
    const user = async (id: Id<'users'>) => {
      if (!users.has(id)) users.set(id, await ctx.db.get(id))
      return users.get(id)!
    }
    const out = []
    for (const s of rows) {
      const report = await ctx.db.get(s.reportId)
      if (!report || !canSeeReport(m, report)) continue
      const recipients = []
      for (const id of s.recipientIds) recipients.push({ userId: id, name: displayName(await user(id)) })
      out.push({
        _id: s._id,
        reportId: s.reportId,
        reportName: report.name,
        frequency: s.frequency,
        localTime: s.localTime,
        weekday: s.weekday,
        dayOfMonth: s.dayOfMonth,
        timezone: s.timezone,
        recipients,
        enabled: s.enabled,
        nextRunAt: s.nextRunAt,
        lastRunAt: s.lastRunAt,
        lastStatus: s.lastStatus,
        createdByName: displayName(await user(s.createdBy)),
        canEdit: canEditSchedule(m, s),
      })
    }
    return out
  },
})

/** Members who can receive a report, with the reason when they cannot. */
export const recipientOptions = query({
  args: { reportId: v.id('savedReports') },
  returns: v.array(
    v.object({ userId: v.id('users'), name: v.string(), email: v.optional(v.string()), reason: v.optional(v.string()) }),
  ),
  handler: async (ctx, { reportId }) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    const companyId = companyOf(m)
    const report = await ctx.db.get(reportId)
    if (!report || !canSeeReport(m, report)) throw userError('NOT_FOUND', 'Report not found')
    const ids = new Set<Id<'users'>>()
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(300)
    for (const ms of memberships) if (ms.status === 'active') ids.add(ms.userId)
    const legacy = await ctx.db
      .query('users')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(300)
    for (const u of legacy) ids.add(u._id)
    const out = []
    for (const id of [...ids].slice(0, 300)) {
      const u = await ctx.db.get(id)
      if (!u) continue
      const mc = await memberContextIn(ctx, u, companyId)
      if (!mc) continue
      const reason = ineligible(m, mc, report) ?? (u.email ? undefined : 'No email address')
      out.push({ userId: u._id, name: displayName(u), email: u.email, reason })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

const deliveryView = v.object({
  _id: v.id('reportDeliveries'),
  reportId: v.id('savedReports'),
  reportName: v.string(),
  trigger: v.union(v.literal('schedule'), v.literal('manual')),
  status: reportDeliveryStatus,
  attempts: v.number(),
  recipients: v.array(
    v.object({
      to: v.string(),
      status: v.union(v.literal('pending'), v.literal('sent'), v.literal('failed'), v.literal('skipped')),
      error: v.optional(v.string()),
    }),
  ),
  rowCount: v.optional(v.number()),
  truncated: v.optional(v.boolean()),
  rangeFrom: v.optional(v.string()),
  rangeTo: v.optional(v.string()),
  error: v.optional(v.string()),
  nextAttemptAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
  createdAt: v.number(),
})

/** Delivery log, newest first (reports the caller can see). */
export const deliveries = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(deliveryView),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal('SplitRecommended'), v.literal('SplitRequired'), v.null())),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    const companyId = companyOf(m)
    const res = await ctx.db
      .query('reportDeliveries')
      .withIndex('by_companyId_and_createdAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 50) })
    const visible = new Map<string, boolean>()
    const page = []
    for (const d of res.page) {
      if (!visible.has(d.reportId)) {
        const r = await ctx.db.get(d.reportId)
        // A deleted report's log stays visible to report managers until pruned.
        visible.set(d.reportId, r ? canSeeReport(m, r) : true)
      }
      if (!visible.get(d.reportId)) continue
      page.push({
        _id: d._id,
        reportId: d.reportId,
        reportName: d.reportName,
        trigger: d.trigger,
        status: d.status,
        attempts: d.attempts,
        recipients: d.recipients.map((x) => ({ to: x.to, status: x.status, error: x.error })),
        rowCount: d.rowCount,
        truncated: d.truncated,
        rangeFrom: d.rangeFrom,
        rangeTo: d.rangeTo,
        error: d.error,
        nextAttemptAt: d.nextAttemptAt,
        finishedAt: d.finishedAt,
        createdAt: d.createdAt,
      })
    }
    return { ...res, page }
  },
})

// ─── Mutations ──────────────────────────────────────────────────────────────

const timingArgs = {
  frequency: scheduleFrequency,
  localTime: v.string(),
  weekday: v.optional(v.number()),
  dayOfMonth: v.optional(v.number()),
  timezone: v.string(),
  recipientIds: v.array(v.id('users')),
  enabled: v.boolean(),
}

type TimingArgs = {
  frequency: Doc<'reportSchedules'>['frequency']
  localTime: string
  weekday?: number
  dayOfMonth?: number
  timezone: string
}

function checkSchedule(a: TimingArgs) {
  const problem = checkTiming(a)
  if (problem) invalid(problem)
  if (!isValidTimeZone(a.timezone)) invalid('Choose a valid time zone')
  return {
    frequency: a.frequency,
    localTime: a.localTime,
    weekday: a.frequency === 'weekly' ? a.weekday : undefined,
    dayOfMonth: a.frequency === 'monthly' ? a.dayOfMonth : undefined,
    timezone: a.timezone,
  }
}

export const create = mutation({
  args: { reportId: v.id('savedReports'), ...timingArgs },
  returns: v.id('reportSchedules'),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    return await createScheduleAs(ctx, m, args)
  },
})

/**
 * A report schedule (ANLY-007), shared by the schedules page and Ask Anowa's
 * schedule draft. `m` must hold 'reports.manage'; 'reports.export' is checked here.
 */
export async function createScheduleAs(
  ctx: MutationCtx,
  m: MemberContext,
  args: TimingArgs & { reportId: Id<'savedReports'>; recipientIds: Id<'users'>[]; enabled: boolean },
): Promise<Id<'reportSchedules'>> {
    requirePermission(m, 'reports.export')
    const companyId = companyOf(m)
    const report = await ctx.db.get(args.reportId)
    if (!report || !canSeeReport(m, report)) throw userError('NOT_FOUND', 'Report not found')
    if (!canReadDataset(m, report.definition)) throw userError('FORBIDDEN', 'You cannot read this report')
    const timing = checkSchedule(args)
    const recipientIds = await checkRecipients(ctx, m, companyId, report, args.recipientIds)
    const existing = await ctx.db
      .query('reportSchedules')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(MAX_SCHEDULES_PER_COMPANY)
    if (existing.length >= MAX_SCHEDULES_PER_COMPANY) {
      invalid(`This organization has ${MAX_SCHEDULES_PER_COMPANY} report schedules; remove one first`)
    }
    const now = Date.now()
    const id = await ctx.db.insert('reportSchedules', {
      companyId,
      reportId: report._id,
      ...timing,
      recipientIds,
      enabled: args.enabled,
      nextRunAt: args.enabled ? (nextReportRun(timing, timing.timezone, now) ?? undefined) : undefined,
      createdBy: m.user._id,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'reportSchedules',
      recordId: id,
      newValues: { reportId: report._id, frequency: timing.frequency, recipients: recipientIds.length },
    })
    return id
}

export const update = mutation({
  args: { scheduleId: v.id('reportSchedules'), ...timingArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    requirePermission(m, 'reports.export')
    const companyId = companyOf(m)
    const { s, report } = await loadSchedule(ctx, m, args.scheduleId)
    if (!canEditSchedule(m, s)) throw userError('FORBIDDEN', 'Only the owner or an admin can change this schedule')
    // Runs as its owner: whoever edits it takes it over.
    if (!canReadDataset(m, report.definition)) throw userError('FORBIDDEN', 'You cannot read this report')
    const timing = checkSchedule(args)
    const recipientIds = await checkRecipients(ctx, m, companyId, report, args.recipientIds)
    const now = Date.now()
    await ctx.db.patch(s._id, {
      ...timing,
      recipientIds,
      enabled: args.enabled,
      nextRunAt: args.enabled ? (nextReportRun(timing, timing.timezone, now) ?? undefined) : undefined,
      createdBy: m.user._id,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'reportSchedules',
      recordId: s._id,
      previousValues: { frequency: s.frequency, enabled: s.enabled, recipients: s.recipientIds.length },
      newValues: { frequency: timing.frequency, enabled: args.enabled, recipients: recipientIds.length },
    })
    return null
  },
})

export const setEnabled = mutation({
  args: { scheduleId: v.id('reportSchedules'), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { scheduleId, enabled }) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    const { s } = await loadSchedule(ctx, m, scheduleId)
    if (!canEditSchedule(m, s)) throw userError('FORBIDDEN', 'Only the owner or an admin can change this schedule')
    if (s.enabled === enabled) return null
    const now = Date.now()
    await ctx.db.patch(s._id, {
      enabled,
      nextRunAt: enabled ? (nextReportRun(s, s.timezone, now) ?? undefined) : undefined,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'reportSchedules',
      recordId: s._id,
      previousValues: { enabled: s.enabled },
      newValues: { enabled },
    })
    return null
  },
})

export const remove = mutation({
  args: { scheduleId: v.id('reportSchedules') },
  returns: v.null(),
  handler: async (ctx, { scheduleId }) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    const { s, report } = await loadSchedule(ctx, m, scheduleId)
    if (!canEditSchedule(m, s)) throw userError('FORBIDDEN', 'Only the owner or an admin can remove this schedule')
    await ctx.db.delete(s._id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'reportSchedules',
      recordId: s._id,
      previousValues: { reportName: report.name, frequency: s.frequency },
    })
    return null
  },
})

async function queueDelivery(
  ctx: MutationCtx,
  s: Doc<'reportSchedules'>,
  report: Doc<'savedReports'>,
  trigger: 'schedule' | 'manual',
  slot: string | undefined,
  requestedBy: Id<'users'>,
) {
  const id = await ctx.db.insert('reportDeliveries', {
    companyId: s.companyId,
    reportId: s.reportId,
    scheduleId: s._id,
    reportName: report.name,
    trigger,
    slot,
    requestedBy,
    status: 'queued',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    recipients: [],
    createdAt: Date.now(),
  })
  await ctx.scheduler.runAfter(0, internal.reportSchedules.send, { deliveryId: id })
  return id
}

/** Email the report to the schedule's recipients now (as the caller). */
export const sendNow = mutation({
  args: { scheduleId: v.id('reportSchedules') },
  returns: v.id('reportDeliveries'),
  handler: async (ctx, { scheduleId }) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    requirePermission(m, 'reports.export')
    const { s, report } = await loadSchedule(ctx, m, scheduleId)
    if (!canEditSchedule(m, s)) throw userError('FORBIDDEN', 'Only the owner or an admin can send this schedule')
    const last = await ctx.db
      .query('reportDeliveries')
      .withIndex('by_scheduleId_and_slot', (q) => q.eq('scheduleId', s._id).eq('slot', undefined))
      .order('desc')
      .first()
    if (last && last.createdAt > Date.now() - SEND_NOW_COOLDOWN_MS) {
      throw userError('RATE_LIMITED', 'This report was just sent; wait a few minutes before sending it again')
    }
    return await queueDelivery(ctx, s, report, 'manual', undefined, m.user._id)
  },
})

// ─── Scheduling and sending (internal) ──────────────────────────────────────

/** Queue due schedules (cron). One delivery per schedule and local date. */
export const tick = internalMutation({
  args: {},
  returns: v.object({ queued: v.number(), more: v.boolean() }),
  handler: async (ctx): Promise<{ queued: number; more: boolean }> => {
    const now = Date.now()
    const due = await ctx.db
      .query('reportSchedules')
      .withIndex('by_enabled_and_nextRunAt', (q) => q.eq('enabled', true).gte('nextRunAt', 0).lte('nextRunAt', now))
      .take(TICK_BATCH)
    const perCompany = new Map<string, number>()
    const zones = new Map<string, Awaited<ReturnType<typeof companyZone>>>()
    let queued = 0
    let deferred = 0
    for (const s of due) {
      const n = perCompany.get(s.companyId) ?? 0
      if (n >= MAX_PER_COMPANY_PER_TICK) {
        deferred += 1 // stays due; the next tick takes it
        continue
      }
      perCompany.set(s.companyId, n + 1)
      if (!zones.has(s.companyId)) zones.set(s.companyId, await companyZone(ctx, s.companyId))
      const { company } = zones.get(s.companyId)!
      const slot = localParts(s.nextRunAt!, s.timezone).date
      const report = await ctx.db.get(s.reportId)
      if (!report) {
        await ctx.db.patch(s._id, { enabled: false, nextRunAt: undefined, lastStatus: 'failed' })
        continue
      }
      if (company?.status === 'approved') {
        const dupe = await ctx.db
          .query('reportDeliveries')
          .withIndex('by_scheduleId_and_slot', (q) => q.eq('scheduleId', s._id).eq('slot', slot))
          .first()
        if (!dupe) {
          await queueDelivery(ctx, s, report, 'schedule', slot, s.createdBy)
          queued += 1
        }
      }
      await ctx.db.patch(s._id, { nextRunAt: nextReportRun(s, s.timezone, now) ?? undefined, lastRunAt: now })
    }
    const more = due.length === TICK_BATCH && deferred === 0
    if (more) await ctx.scheduler.runAfter(0, internal.reportSchedules.tick, {})
    return { queued, more }
  },
})

type Plan = {
  companyId: Id<'companies'>
  reportId: Id<'savedReports'>
  ownerId: Id<'users'>
  /** For the email footer ("Sent by a report schedule <owner> set up at <org>"). */
  ownerName: string
  orgName: string
  /** `locale`: the recipient's app language, for the email copy. */
  pending: { index: number; to: string; locale?: string }[]
}

/**
 * Attempt start. On the first attempt, plan the recipients: still eligible,
 * with an email address, email on and outside quiet hours. Returns the
 * recipients still to send to, or null when there is nothing left.
 */
export const start = internalMutation({
  args: { deliveryId: v.id('reportDeliveries') },
  returns: v.union(
    v.object({
      companyId: v.id('companies'),
      reportId: v.id('savedReports'),
      ownerId: v.id('users'),
      ownerName: v.string(),
      orgName: v.string(),
      pending: v.array(v.object({ index: v.number(), to: v.string(), locale: v.optional(v.string()) })),
    }),
    v.null(),
  ),
  handler: async (ctx, { deliveryId }): Promise<Plan | null> => {
    const d = await ctx.db.get(deliveryId)
    if (!d || !['queued', 'retrying'].includes(d.status)) return null
    let recipients = d.recipients
    if (d.attempts === 0) {
      const report = await ctx.db.get(d.reportId)
      const schedule = d.scheduleId ? await ctx.db.get(d.scheduleId) : null
      const ownerDoc = d.requestedBy ? await ctx.db.get(d.requestedBy) : null
      const owner = ownerDoc ? await memberContextIn(ctx, ownerDoc, d.companyId) : null
      if (!report || !schedule || !owner) {
        await finalize(ctx, d, {
          status: 'failed',
          error: !report ? 'The report was deleted' : !schedule ? 'The schedule was removed' : 'The schedule owner is no longer a member',
        })
        return null
      }
      const { tz } = await companyZone(ctx, d.companyId)
      const now = Date.now()
      recipients = []
      for (const userId of schedule.recipientIds.slice(0, MAX_RECIPIENTS)) {
        const u = await ctx.db.get(userId)
        const base = { userId, to: u?.email ?? '', attempts: 0 }
        const why = ineligible(owner, u ? await memberContextIn(ctx, u, d.companyId) : null, report)
        if (why) {
          recipients.push({ ...base, status: 'skipped' as const, error: why })
          continue
        }
        const p = await prefsFor(ctx, userId)
        const error = !u?.email
          ? 'No email address'
          : !p.email
            ? 'Email turned off in notification preferences'
            : inQuietHours(p.quietHours, now, tz)
              ? 'Quiet hours'
              : undefined
        recipients.push({ ...base, status: error ? ('skipped' as const) : ('pending' as const), error })
      }
    }
    const pending: Plan['pending'] = []
    for (const [index, x] of recipients.entries()) {
      if (x.status !== 'pending') continue
      pending.push({ index, to: x.to, locale: (await ctx.db.get(x.userId))?.locale })
    }
    if (!pending.length) {
      await finalize(ctx, { ...d, recipients }, {})
      return null
    }
    await ctx.db.patch(deliveryId, { recipients, status: 'running', attempts: d.attempts + 1, nextAttemptAt: undefined })
    const owner = d.requestedBy ? await ctx.db.get(d.requestedBy) : null
    const company = await ctx.db.get(d.companyId)
    return {
      companyId: d.companyId,
      reportId: d.reportId,
      ownerId: d.requestedBy!,
      ownerName: owner?.name ?? '',
      orgName: company?.name ?? '',
      pending,
    }
  },
})

function summarize(failed: Doc<'reportDeliveries'>['recipients']) {
  const first = failed[0]
  const more = failed.length > 1 ? ` (+${failed.length - 1} more)` : ''
  return `${first.to || 'recipient'}: ${first.error ?? 'failed'}${more}`.slice(0, 500)
}

/** Settle a delivery and mirror its status on the schedule. */
async function finalize(
  ctx: MutationCtx,
  d: Doc<'reportDeliveries'>,
  patch: Partial<Pick<Doc<'reportDeliveries'>, 'status' | 'error' | 'rowCount' | 'truncated' | 'rangeFrom' | 'rangeTo'>>,
) {
  const failed = d.recipients.filter((x) => x.status === 'failed')
  const sent = d.recipients.filter((x) => x.status === 'sent').length
  const status = patch.status ?? (!failed.length ? (sent ? 'succeeded' : 'skipped') : sent ? 'partial' : 'failed')
  await ctx.db.patch(d._id, {
    ...patch,
    recipients: d.recipients,
    status,
    error: patch.error ?? (failed.length ? summarize(failed) : undefined),
    finishedAt: Date.now(),
    nextAttemptAt: undefined,
  })
  if (d.scheduleId) {
    const s = await ctx.db.get(d.scheduleId)
    if (s) await ctx.db.patch(s._id, { lastStatus: status })
  }
}

export const finish = internalMutation({
  args: {
    deliveryId: v.id('reportDeliveries'),
    outcomes: v.array(
      v.object({
        index: v.number(),
        ok: v.boolean(),
        providerMessageId: v.optional(v.string()),
        error: v.optional(v.string()),
        retryable: v.optional(v.boolean()),
      }),
    ),
    rowCount: v.number(),
    truncated: v.boolean(),
    rangeFrom: v.optional(v.string()),
    rangeTo: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { deliveryId, outcomes, ...summary }) => {
    const d = await ctx.db.get(deliveryId)
    if (!d) return null
    const recipients = [...d.recipients]
    for (const o of outcomes) {
      const x = recipients[o.index]
      if (!x || x.status !== 'pending') continue
      recipients[o.index] = o.ok
        ? { ...x, status: 'sent', attempts: x.attempts + 1, providerMessageId: o.providerMessageId, error: undefined, retryable: undefined }
        : { ...x, status: 'failed', attempts: x.attempts + 1, error: o.error?.slice(0, 300), retryable: o.retryable === true }
    }
    const retry = recipients.some((x) => x.status === 'failed' && x.retryable)
    if (retry && d.attempts < d.maxAttempts) {
      const delayMin = RETRY_BACKOFF_MIN[Math.min(d.attempts - 1, RETRY_BACKOFF_MIN.length - 1)] ?? 1
      const at = Date.now() + delayMin * 60_000
      await ctx.db.patch(deliveryId, {
        ...summary,
        recipients: recipients.map((x) => (x.status === 'failed' && x.retryable ? { ...x, status: 'pending' as const } : x)),
        status: 'retrying',
        nextAttemptAt: at,
        error: summarize(recipients.filter((x) => x.status === 'failed')),
      })
      await ctx.scheduler.runAt(at, internal.reportSchedules.send, { deliveryId })
      return null
    }
    await finalize(ctx, { ...d, recipients }, summary)
    return null
  },
})

/** The report could not run, or the attempt crashed: fail what is left (not retried). */
export const fail = internalMutation({
  args: { deliveryId: v.id('reportDeliveries'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { deliveryId, error }) => {
    const d = await ctx.db.get(deliveryId)
    if (!d) return null
    const recipients = d.recipients.map((x) =>
      x.status === 'pending' ? { ...x, status: 'failed' as const, error: 'Not sent', retryable: false } : x,
    )
    await finalize(ctx, { ...d, recipients }, { status: 'failed', error: error.slice(0, 500) })
    return null
  },
})

export const send = internalAction({
  args: { deliveryId: v.id('reportDeliveries') },
  returns: v.null(),
  handler: async (ctx, { deliveryId }) => {
    const fail = (e: unknown) =>
      ctx.runMutation(internal.reportSchedules.fail, { deliveryId, error: e instanceof Error ? e.message : String(e) })
    let plan: Plan | null
    try {
      plan = await ctx.runMutation(internal.reportSchedules.start, { deliveryId })
    } catch (e) {
      await fail(e)
      return null
    }
    if (!plan) return null
    const run = await ctx.runQuery(internal.reportBuilder.runForOwner, {
      reportId: plan.reportId,
      ownerId: plan.ownerId,
      companyId: plan.companyId,
    })
    if (!run.ok) {
      await fail(run.error)
      return null
    }
    // One rendering per language; the CSV is the same for everyone.
    const byLocale = new Map<string, ReturnType<typeof reportEmail>>()
    const emailFor = (locale: string | undefined) => {
      const key = emailLocale(locale)
      let email = byLocale.get(key)
      if (!email) {
        email = reportEmail({
          name: run.name,
          dataset: run.dataset,
          result: run.result,
          path: `/reports?report=${plan.reportId}`,
          locale: key,
          ownerName: plan.ownerName,
          orgName: plan.orgName,
        })
        byLocale.set(key, email)
      }
      return email
    }
    const first = emailFor(plan.pending[0]?.locale)
    const attachments = first.attach ? [{ filename: first.filename, content: base64Utf8(first.csv) }] : undefined
    const companyId = plan.companyId
    const outcomes = await runEffect(
      sendAll(
        (input) => deliverMessage(ctx, companyId, input),
        plan.pending.map(({ index, to, locale }) => {
          const email = emailFor(locale)
          return {
            index,
            input: { channel: 'email' as const, to, subject: email.subject, body: email.body, html: email.html, attachments },
          }
        }),
      ),
    )
    await ctx.runMutation(internal.reportSchedules.finish, {
      deliveryId,
      outcomes,
      rowCount: run.result.rows.length,
      truncated: run.result.sourceTruncated || run.result.rowsTruncated,
      rangeFrom: run.result.from ?? undefined,
      rangeTo: run.result.to ?? undefined,
    })
    return null
  },
})

/** Delivery log retention: 90 days. */
export const prune = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000
    const old = await ctx.db
      .query('reportDeliveries')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    for (const d of old) await ctx.db.delete(d._id)
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.reportSchedules.prune, {})
    return old.length
  },
})
