import { v } from 'convex/values'
import { internalAction, internalMutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { runEffect } from '../lib/effect'
import { mergeSettings } from '../lib/farmRules'
import { orgProfile } from '../lib/orgProfile'
import { deliverMessage } from '../messaging/deliver'
import { CHECKS } from './checks'
import { evaluateConditions, renderTemplate, type RunContext } from './conditions'
import { sendAll } from './deliver'
import { queueRuleWebhook } from '../webhooks'
import { notificationEmailReader, readingFromPayload, renderNotificationEmail } from '../lib/notificationEmail'
import { inQuietHours, localParts, nextRunAt, zoneOrDefault } from './schedule'
import type { AutomationRecipients, RunDelivery } from './validators'

/**
 * Automation execution (AUTO-002, D-008, docs/architecture/07 §6).
 *
 *   emitDomainEvent ──► dispatchEvent ─┐
 *   cron (5 min)    ──► tick ──────────┼─► automationRuns (queued) ──► executeRun (action)
 *   admin "run now" / re-run ──────────┘        startRun: in-app + tasks (once), plan sends
 *                                                sendAll (Effect): SMS/WhatsApp/email
 *                                                finishRun: record, back-off retry or settle
 *
 * In-app notifications and tasks are written by `startRun` on the first
 * attempt only (`localDone`), so retries resend just the failed external
 * deliveries. Runs are deduplicated by `dedupeKey` (one per rule per event,
 * one per rule per local schedule slot).
 */

/** Delay before attempt 2, 3, 4 (minutes). */
export const RETRY_BACKOFF_MIN = [1, 5, 30]
export const MAX_ATTEMPTS = RETRY_BACKOFF_MIN.length + 1
const MAX_DELIVERIES = 50
const MAX_TASKS_PER_ACTION = 20
const TICK_BATCH = 50
const MAX_RULES_PER_EVENT = 50

type Ctx = MutationCtx

/** The organization's time zone (companies.timezone, ORG-005; default Africa/Accra). */
export async function companyZone(ctx: Ctx, companyId: Id<'companies'>) {
  const company = await ctx.db.get(companyId)
  return { company, tz: zoneOrDefault(orgProfile(company).timezone) }
}

/** Re-time a company's enabled schedule rules (after its time zone changed). */
export async function retimeScheduleRules(ctx: Ctx, companyId: Id<'companies'>) {
  const { tz } = await companyZone(ctx, companyId)
  const now = Date.now()
  const rules = await ctx.db
    .query('automationRules')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(100)
  for (const rule of rules) {
    if (rule.trigger.kind === 'schedule' && rule.enabled) {
      await ctx.db.patch(rule._id, { nextRunAt: nextRunAt(rule.trigger, tz, now) ?? undefined })
    }
  }
}

/** Queue one run of a rule unless a run with the same dedupe key exists. */
export async function createRun(
  ctx: Ctx,
  rule: Doc<'automationRules'>,
  opts: {
    triggerKind: 'event' | 'schedule' | 'manual'
    dedupeKey: string
    eventId?: Id<'domainEvents'>
    localDate?: string
  },
): Promise<Id<'automationRuns'> | null> {
  const seen = await ctx.db
    .query('automationRuns')
    .withIndex('by_dedupeKey', (q) => q.eq('dedupeKey', opts.dedupeKey))
    .first()
  if (seen) return null
  const now = Date.now()
  const runId = await ctx.db.insert('automationRuns', {
    companyId: rule.companyId,
    ruleId: rule._id,
    ruleName: rule.name,
    triggerKind: opts.triggerKind,
    eventId: opts.eventId,
    localDate: opts.localDate,
    dedupeKey: opts.dedupeKey,
    status: 'queued',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    localDone: false,
    createdAt: now,
  })
  await ctx.db.patch(rule._id, { lastRunAt: now })
  await ctx.scheduler.runAfter(0, internal.automation.engine.executeRun, { runId })
  return runId
}

/** Fan an event out to the company's enabled rules for its type. */
export const dispatchEvent = internalMutation({
  args: { eventId: v.id('domainEvents') },
  returns: v.object({ runs: v.number() }),
  handler: async (ctx, { eventId }) => {
    const ev = await ctx.db.get(eventId)
    if (!ev || ev.processedBy?.includes('automation')) return { runs: 0 }
    const company = await ctx.db.get(ev.companyId)
    let runs = 0
    if (company?.status === 'approved') {
      const tz = zoneOrDefault(orgProfile(company).timezone)
      const settings = mergeSettings(company.settings)
      const context: RunContext = {
        payload: ev.payload,
        settings: { farmRules: settings.farmRules },
        date: typeof ev.payload.date === 'string' ? ev.payload.date : localParts(ev.createdAt, tz).date,
      }
      const rules = await ctx.db
        .query('automationRules')
        .withIndex('by_company_and_eventType_and_enabled', (q) =>
          q.eq('companyId', ev.companyId).eq('eventType', ev.type).eq('enabled', true),
        )
        .take(MAX_RULES_PER_EVENT)
      for (const rule of rules) {
        if (!evaluateConditions(rule.conditions, context, rule.match)) continue
        const id = await createRun(ctx, rule, {
          triggerKind: 'event',
          eventId,
          dedupeKey: `${rule._id}:${eventId}`,
        })
        if (id) runs += 1
      }
    }
    await ctx.db.patch(eventId, { processedBy: [...(ev.processedBy ?? []), 'automation'] })
    return { runs }
  },
})

/** Every few minutes (crons.ts): queue due schedule rules, advance them. */
export const tick = internalMutation({
  args: {},
  returns: v.object({ queued: v.number(), more: v.boolean() }),
  handler: async (ctx): Promise<{ queued: number; more: boolean }> => {
    const now = Date.now()
    const due = await ctx.db
      .query('automationRules')
      .withIndex('by_enabled_and_nextRunAt', (q) =>
        q.eq('enabled', true).gte('nextRunAt', 0).lte('nextRunAt', now),
      )
      .take(TICK_BATCH)
    let queued = 0
    for (const rule of due) {
      if (rule.trigger.kind !== 'schedule') {
        await ctx.db.patch(rule._id, { nextRunAt: undefined })
        continue
      }
      const { company, tz } = await companyZone(ctx, rule.companyId)
      const slot = localParts(rule.nextRunAt!, tz).date
      if (company?.status === 'approved') {
        const id = await createRun(ctx, rule, {
          triggerKind: 'schedule',
          localDate: slot,
          dedupeKey: `${rule._id}:${slot}:${rule.trigger.localTime}`,
        })
        if (id) queued += 1
      }
      await ctx.db.patch(rule._id, { nextRunAt: nextRunAt(rule.trigger, tz, now) ?? undefined })
    }
    const more = due.length === TICK_BATCH
    if (more) await ctx.scheduler.runAfter(0, internal.automation.engine.tick, {})
    return { queued, more }
  },
})

async function companyUsers(ctx: Ctx, companyId: Id<'companies'>) {
  return (
    await ctx.db
      .query('users')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(1000)
  ).filter((u) => u.active !== false)
}

export function pickRecipients(users: Doc<'users'>[], r: AutomationRecipients): Doc<'users'>[] {
  if (r.everyone) return users
  const roles = new Set(r.roles ?? [])
  const ids = new Set((r.userIds ?? []).map(String))
  return users.filter((u) => {
    const role = u.role ?? 'user'
    if (ids.has(String(u._id))) return true
    if (roles.has('admin') && (role === 'admin' || role === 'super_admin')) return true
    if (roles.has('user') && role === 'user') return true
    return false
  })
}

export type Prefs = {
  inApp: boolean
  sms: boolean
  whatsapp: boolean
  email: boolean
  quietHours?: { start: string; end: string }
}

export const DEFAULT_PREFS: Prefs = { inApp: true, sms: true, whatsapp: true, email: true }

export async function prefsFor(ctx: Ctx, userId: Id<'users'>): Promise<Prefs> {
  const row = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  return row
    ? { inApp: row.inApp, sms: row.sms, whatsapp: row.whatsapp, email: row.email, quietHours: row.quietHours }
    : DEFAULT_PREFS
}

/** Deep links are relative paths only (doc 07 §7). */
export function safeLink(link: string | undefined): string | undefined {
  if (!link) return undefined
  const l = link.trim()
  return l.startsWith('/') && !l.startsWith('//') ? l : undefined
}

function errorText(e: unknown) {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

type Plan = {
  companyId: Id<'companies'>
  pending: {
    index: number
    input: { channel: RunDelivery['channel']; to: string; subject: string; body: string; html?: string }
  }[]
}

/**
 * Attempt start: on the first attempt, evaluate the check (schedule rules),
 * write in-app notifications and tasks and plan the external deliveries.
 * Returns the deliveries still to send, or null when there is nothing left.
 */
export const startRun = internalMutation({
  args: { runId: v.id('automationRuns') },
  returns: v.union(
    v.object({
      companyId: v.id('companies'),
      pending: v.array(
        v.object({
          index: v.number(),
          input: v.object({
            channel: v.union(v.literal('email'), v.literal('sms'), v.literal('whatsapp')),
            to: v.string(),
            subject: v.string(),
            body: v.string(),
            html: v.optional(v.string()),
          }),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, { runId }): Promise<Plan | null> => {
    const run = await ctx.db.get(runId)
    if (!run || !['queued', 'retrying', 'running'].includes(run.status)) return null
    const rule = await ctx.db.get(run.ruleId)
    const now = Date.now()
    if (!rule) {
      await ctx.db.patch(runId, { status: 'failed', error: 'Rule was deleted', finishedAt: now })
      return null
    }
    const { company, tz } = await companyZone(ctx, run.companyId)
    await ctx.db.patch(runId, {
      status: 'running',
      attempts: run.attempts + 1,
      startedAt: run.startedAt ?? now,
      nextAttemptAt: undefined,
    })

    let deliveries: RunDelivery[] = run.deliveries ?? []
    if (!run.localDone) {
      const settings = mergeSettings(company?.settings)
      const date = run.localDate ?? localParts(now, tz).date
      const context: RunContext = {
        date,
        settings: { farmRules: settings.farmRules },
        company: { name: company?.name ?? '' },
      }
      if (run.eventId) {
        const ev = await ctx.db.get(run.eventId)
        if (!ev) {
          await ctx.db.patch(runId, { status: 'failed', error: 'Event no longer exists', finishedAt: now })
          return null
        }
        context.payload = ev.payload
        if (typeof ev.payload.date === 'string') context.date = ev.payload.date
      } else if (rule.trigger.kind === 'schedule') {
        const check = CHECKS[rule.trigger.check]
        if (!check) {
          await ctx.db.patch(runId, { status: 'failed', error: `Unknown check "${rule.trigger.check}"`, finishedAt: now })
          return null
        }
        // Per-site checks use each site's local date at the moment the run was queued.
        const at = run.triggerKind === 'manual' ? now : run.createdAt
        const result = await check.run(ctx, run.companyId, date, rule.trigger.params ?? {}, settings, at)
        context.check = result
        if (result.count === 0) {
          await ctx.db.patch(runId, { status: 'skipped', note: 'Nothing to report', localDone: true, finishedAt: now })
          return null
        }
        if (!evaluateConditions(rule.conditions, context, rule.match)) {
          await ctx.db.patch(runId, { status: 'skipped', note: 'Conditions not met', localDone: true, finishedAt: now })
          return null
        }
      } else {
        await ctx.db.patch(runId, { status: 'skipped', note: 'Event rules run only on events', localDone: true, finishedAt: now })
        return null
      }

      const users = await companyUsers(ctx, run.companyId)
      const prefsCache = new Map<string, Prefs>()
      const prefs = async (u: Doc<'users'>) => {
        const key = String(u._id)
        if (!prefsCache.has(key)) prefsCache.set(key, await prefsFor(ctx, u._id))
        return prefsCache.get(key)!
      }
      let notified = 0
      let tasksCreated = 0
      deliveries = []
      let truncated = false

      for (const action of rule.actions) {
        if (action.kind === 'webhook') {
          // INT-005: one signed delivery; retries live in the webhook log.
          await queueRuleWebhook(ctx, {
            companyId: run.companyId,
            endpointId: action.endpointId,
            rule: { id: rule._id, name: rule.name },
            runId,
            eventId: run.eventId,
            check: context.check,
          })
          continue
        }
        const targets = pickRecipients(users, action.recipients)
        const emailExtras = readingFromPayload(context.payload)
        if (action.kind === 'notify') {
          for (const u of targets) {
            const p = await prefs(u)
            const c = { ...context, userId: String(u._id), user: { name: u.name ?? '' } }
            const title = renderTemplate(action.title, c)
            const message = renderTemplate(action.message, c)
            const link = safeLink(action.link ? renderTemplate(action.link, c) : undefined)
            if (action.channels.includes('in_app') && p.inApp) {
              const dedupeKey = action.dedupeKey ? renderTemplate(action.dedupeKey, c) : undefined
              const dup = dedupeKey
                ? await ctx.db
                    .query('notifications')
                    .withIndex('by_dedupe', (q) => q.eq('dedupeKey', dedupeKey))
                    .first()
                : null
              if (!dup) {
                await ctx.db.insert('notifications', {
                  userId: u._id,
                  title,
                  message,
                  type: action.level ?? 'info',
                  read: false,
                  link,
                  companyId: run.companyId,
                  dedupeKey,
                })
                notified += 1
              }
            }
            for (const channel of ['sms', 'whatsapp', 'email'] as const) {
              if (!action.channels.includes(channel) || !p[channel]) continue
              if (deliveries.length >= MAX_DELIVERIES) {
                truncated = true
                continue
              }
              const to = channel === 'email' ? u.email : u.phone
              const base = {
                channel,
                userId: u._id,
                to: to ?? '',
                subject: title,
                attempts: 0,
                ...(channel === 'email' ? { link, level: action.level ?? 'info', ...emailExtras } : {}),
              }
              const body = channel === 'email' ? message : `${title}: ${message}`
              if (!to) {
                deliveries.push({ ...base, body, status: 'skipped', error: channel === 'email' ? 'No email address' : 'No phone number' })
              } else if (inQuietHours(p.quietHours, now, tz)) {
                deliveries.push({ ...base, body, status: 'skipped', error: 'Quiet hours' })
              } else {
                deliveries.push({ ...base, body, status: 'pending' })
              }
            }
          }
        } else {
          const due = action.dueInHours != null ? localParts(now + action.dueInHours * 3_600_000, tz).date : undefined
          const cageId = await companyCage(ctx, run.companyId, context)
          for (const u of targets.slice(0, MAX_TASKS_PER_ACTION)) {
            const c = { ...context, userId: String(u._id), user: { name: u.name ?? '' } }
            const title = renderTemplate(action.title, c).slice(0, 200)
            await ctx.db.insert('tasks', {
              companyId: run.companyId,
              title,
              description: action.description ? renderTemplate(action.description, c).slice(0, 2000) : undefined,
              assigneeUserId: u._id,
              dueDate: due,
              cageId,
              status: 'open',
              ruleId: rule._id,
              runId,
              createdAt: now,
              updatedAt: now,
            })
            tasksCreated += 1
            if ((await prefs(u)).inApp) {
              await ctx.db.insert('notifications', {
                userId: u._id,
                title: 'New task',
                message: title,
                type: 'info',
                read: false,
                link: '/tasks',
                companyId: run.companyId,
              })
            }
          }
        }
      }
      await ctx.db.patch(runId, {
        localDone: true,
        notified,
        tasksCreated,
        deliveries,
        note: truncated ? `Only the first ${MAX_DELIVERIES} messages were sent` : undefined,
      })
    }

    const reader = await notificationEmailReader(ctx, run.companyId)
    const pending: Plan['pending'] = []
    for (const [index, d] of deliveries.entries()) {
      if (d.status !== 'pending') continue
      if (d.channel !== 'email') {
        pending.push({ index, input: { channel: d.channel, to: d.to, subject: d.subject, body: d.body } })
        continue
      }
      // HTML alert email (E5); the text part is the plain alternative.
      const mail = renderNotificationEmail({
        locale: await reader.locale(d.userId),
        orgName: reader.orgName,
        source: 'automation',
        delivery: d,
      })
      pending.push({ index, input: { channel: 'email', to: d.to, subject: mail.subject, body: mail.text, html: mail.html } })
    }
    if (!pending.length) {
      await settle(ctx, runId)
      return null
    }
    return { companyId: run.companyId, pending }
  },
})

/** Cage the run is about, when the event names one of the company's cages. */
async function companyCage(ctx: Ctx, companyId: Id<'companies'>, context: RunContext) {
  const raw = (context.payload as Record<string, unknown> | undefined)?.cageId
  if (typeof raw !== 'string') return undefined
  const id = ctx.db.normalizeId('cages', raw)
  if (!id) return undefined
  const cage = await ctx.db.get(id)
  return cage?.companyId === companyId ? id : undefined
}

/** Final status from deliveries and local work. */
async function settle(ctx: Ctx, runId: Id<'automationRuns'>) {
  const run = await ctx.db.get(runId)
  if (!run) return
  const deliveries = run.deliveries ?? []
  const failed = deliveries.filter((d) => d.status === 'failed')
  const sent = deliveries.filter((d) => d.status === 'sent').length
  const local = (run.notified ?? 0) + (run.tasksCreated ?? 0)
  const status = !failed.length ? 'succeeded' : sent || local ? 'partial' : 'failed'
  await ctx.db.patch(runId, {
    status,
    error: failed.length ? summarize(failed) : undefined,
    finishedAt: Date.now(),
    nextAttemptAt: undefined,
  })
}

function summarize(failed: RunDelivery[]) {
  const first = failed[0]
  const more = failed.length > 1 ? ` (+${failed.length - 1} more)` : ''
  return `${first.channel} to ${first.to}: ${first.error ?? 'failed'}${more}`.slice(0, 500)
}

async function scheduleRetry(ctx: Ctx, run: Doc<'automationRuns'>, error?: string) {
  const delayMin = RETRY_BACKOFF_MIN[Math.min(run.attempts - 1, RETRY_BACKOFF_MIN.length - 1)] ?? 1
  const at = Date.now() + delayMin * 60_000
  await ctx.db.patch(run._id, { status: 'retrying', nextAttemptAt: at, error })
  await ctx.scheduler.runAt(at, internal.automation.engine.executeRun, { runId: run._id })
}

/** Record send outcomes; retry transient failures with back-off, else settle. */
export const finishRun = internalMutation({
  args: {
    runId: v.id('automationRuns'),
    outcomes: v.array(
      v.object({
        index: v.number(),
        ok: v.boolean(),
        providerMessageId: v.optional(v.string()),
        error: v.optional(v.string()),
        retryable: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { runId, outcomes }) => {
    const run = await ctx.db.get(runId)
    if (!run) return null
    const deliveries = [...(run.deliveries ?? [])]
    for (const o of outcomes) {
      const d = deliveries[o.index]
      if (!d || d.status !== 'pending') continue
      deliveries[o.index] = o.ok
        ? { ...d, status: 'sent', attempts: d.attempts + 1, providerMessageId: o.providerMessageId, error: undefined, retryable: undefined }
        : { ...d, status: 'failed', attempts: d.attempts + 1, error: o.error?.slice(0, 300), retryable: o.retryable === true }
    }
    const retry = deliveries.some((d) => d.status === 'failed' && d.retryable)
    if (retry && run.attempts < run.maxAttempts) {
      const next = deliveries.map((d) => (d.status === 'failed' && d.retryable ? { ...d, status: 'pending' as const } : d))
      await ctx.db.patch(runId, { deliveries: next })
      await scheduleRetry(ctx, run, summarize(deliveries.filter((d) => d.status === 'failed')))
      return null
    }
    await ctx.db.patch(runId, { deliveries })
    await settle(ctx, runId)
    return null
  },
})

/** The attempt crashed before sending (bug or transient database error). */
export const failRun = internalMutation({
  args: { runId: v.id('automationRuns'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { runId, error }) => {
    const run = await ctx.db.get(runId)
    if (!run) return null
    const attempted = { ...run, attempts: run.attempts + 1 }
    await ctx.db.patch(runId, { attempts: attempted.attempts })
    if (attempted.attempts < run.maxAttempts) {
      await scheduleRetry(ctx, attempted, error)
    } else {
      await ctx.db.patch(runId, { status: 'failed', error, finishedAt: Date.now(), nextAttemptAt: undefined })
    }
    return null
  },
})

/** Domain events are kept 30 days (they are an outbox, not the audit log). */
export const EVENT_RETENTION_DAYS = 30

export const pruneEvents = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - EVENT_RETENTION_DAYS * 86_400_000
    const old = await ctx.db
      .query('domainEvents')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    for (const e of old) await ctx.db.delete(e._id)
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.automation.engine.pruneEvents, {})
    return old.length
  },
})

/** One attempt of a run. Scheduled by createRun, retries and re-runs. */
export const executeRun = internalAction({
  args: { runId: v.id('automationRuns') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    let plan: Plan | null
    try {
      plan = await ctx.runMutation(internal.automation.engine.startRun, { runId })
    } catch (e) {
      await ctx.runMutation(internal.automation.engine.failRun, { runId, error: errorText(e) })
      return null
    }
    if (!plan) return null
    const companyId = plan.companyId
    const outcomes = await runEffect(
      sendAll((input) => deliverMessage(ctx, companyId, input), plan.pending),
    )
    await ctx.runMutation(internal.automation.engine.finishRun, { runId, outcomes })
    return null
  },
})
