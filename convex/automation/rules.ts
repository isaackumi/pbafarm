import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { requireRole, requireUser } from '../lib/authz'
import { logAudit } from '../lib/tenancy'
import { CHECKS, checkExists } from './checks'
import { validateConditions } from './conditions'
import { MAX_ATTEMPTS, companyZone, createRun } from './engine'
import { localParts, nextRunAt, parseHhmm, zoneOrDefault } from './schedule'
import { orgProfile } from '../lib/orgProfile'
import { BUILT_IN_KEYS, EVENT_TYPES, TEMPLATES, templateByKey, type RuleTemplate } from './templates'
import {
  automationAction,
  automationCondition,
  automationTrigger,
  type AutomationAction,
  type AutomationCondition,
  type AutomationTrigger,
} from './validators'

/**
 * Admin API for automation rules (AUTO-002, AUTO-006, AUTO-007). Everything
 * is scoped to the caller's company; rules can only target its members.
 */

const MAX_RULES = 50
const MAX_ACTIONS = 5

async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx)
  requireRole(user, 'admin')
  if (!user.companyId) throw new Error('Your account is not linked to a company')
  return { user, companyId: user.companyId }
}

async function ownRule(ctx: QueryCtx | MutationCtx, companyId: Id<'companies'>, ruleId: Id<'automationRules'>) {
  const rule = await ctx.db.get(ruleId)
  if (!rule || rule.companyId !== companyId) throw new Error('Rule not found')
  return rule
}

type RuleDraft = {
  name: string
  description?: string
  trigger: AutomationTrigger
  match?: 'all' | 'any'
  conditions: AutomationCondition[]
  actions: AutomationAction[]
}

/** Throws a message an admin can act on; returns the normalized draft. */
async function validateDraft(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<'companies'>,
  d: RuleDraft,
): Promise<RuleDraft> {
  const name = d.name.trim()
  if (!name || name.length > 100) throw new Error('Name is required (up to 100 characters)')
  if (d.trigger.kind === 'event') {
    if (!/^[a-z0-9_.]{1,100}$/.test(d.trigger.eventType)) throw new Error('Choose an event')
  } else {
    if (!parseHhmm(d.trigger.localTime)) throw new Error('Time must be HH:MM')
    if (!checkExists(d.trigger.check)) throw new Error('Choose what to check')
    if (d.trigger.daysOfWeek?.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) {
      throw new Error('Days of the week must be 0 (Sunday) to 6 (Saturday)')
    }
  }
  const condError = validateConditions(d.conditions)
  if (condError) throw new Error(condError)
  if (!d.actions.length) throw new Error('Add at least one action')
  if (d.actions.length > MAX_ACTIONS) throw new Error(`At most ${MAX_ACTIONS} actions per rule`)
  const members = new Set<string>()
  for (const a of d.actions) {
    if (a.kind === 'webhook') {
      const endpoint = await ctx.db.get(a.endpointId)
      if (!endpoint || endpoint.companyId !== companyId) throw new Error('Webhook endpoint not found')
      continue
    }
    const r = a.recipients
    if (!r.everyone && !r.roles?.length && !r.userIds?.length) throw new Error('Each action needs recipients')
    if ((r.userIds?.length ?? 0) > 50) throw new Error('At most 50 people per action')
    for (const id of r.userIds ?? []) {
      if (!members.has(String(id))) {
        const u = await ctx.db.get(id)
        if (!u || u.companyId !== companyId) throw new Error('Recipients must be members of your company')
        members.add(String(id))
      }
    }
    if (!a.title.trim() || a.title.length > 200) throw new Error('Each action needs a title (up to 200 characters)')
    if (a.kind === 'notify') {
      if (!a.channels.length) throw new Error('Choose at least one channel')
      if (a.message.length > 1000) throw new Error('Message is too long (up to 1,000 characters)')
      if (a.link && !a.link.startsWith('/')) throw new Error('Links must be app paths starting with /')
    } else {
      if (a.description && a.description.length > 2000) throw new Error('Task description is too long')
      if (a.dueInHours != null && (!(a.dueInHours >= 0) || a.dueInHours > 24 * 90)) {
        throw new Error('Due time must be between 0 hours and 90 days')
      }
    }
  }
  return {
    name,
    description: d.description?.trim() || undefined,
    trigger: d.trigger,
    match: d.match,
    conditions: d.conditions,
    actions: d.actions,
  }
}

function indexFields(trigger: AutomationTrigger, enabled: boolean, tz: string, now: number) {
  return {
    eventType: trigger.kind === 'event' ? trigger.eventType : undefined,
    nextRunAt: trigger.kind === 'schedule' && enabled ? (nextRunAt(trigger, tz, now) ?? undefined) : undefined,
  }
}

async function countRules(ctx: QueryCtx | MutationCtx, companyId: Id<'companies'>) {
  return (
    await ctx.db
      .query('automationRules')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(MAX_RULES + 1)
  ).length
}

/** Insert a rule from a template (no auth: callers check). */
export async function insertFromTemplate(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  t: RuleTemplate,
  opts: { enabled: boolean; userId?: Id<'users'>; tz: string },
) {
  const now = Date.now()
  return await ctx.db.insert('automationRules', {
    companyId,
    name: t.name,
    description: t.description,
    enabled: opts.enabled,
    templateKey: t.key,
    builtIn: t.builtIn,
    trigger: t.trigger,
    match: t.match,
    conditions: t.conditions,
    actions: t.actions,
    ...indexFields(t.trigger, opts.enabled, opts.tz, now),
    createdBy: opts.userId,
    updatedBy: opts.userId,
    updatedAt: now,
  })
}

/** Whether the company's daily reminders run on the engine (built-in rules exist). */
export async function onEngine(ctx: QueryCtx | MutationCtx, companyId: Id<'companies'>) {
  for (const key of BUILT_IN_KEYS) {
    const row = await ctx.db
      .query('automationRules')
      .withIndex('by_company_and_templateKey', (q) => q.eq('companyId', companyId).eq('templateKey', key))
      .first()
    if (row?.builtIn) return true
  }
  return false
}

/**
 * Move a company's daily reminders onto the engine: create the built-in
 * rules (enabled, 16:00 company time). Idempotent: existing ones are kept.
 */
export async function seedBuiltIns(ctx: MutationCtx, companyId: Id<'companies'>, userId?: Id<'users'>) {
  const { tz } = await companyZone(ctx, companyId)
  const created: string[] = []
  for (const key of BUILT_IN_KEYS) {
    const existing = await ctx.db
      .query('automationRules')
      .withIndex('by_company_and_templateKey', (q) => q.eq('companyId', companyId).eq('templateKey', key))
      .first()
    if (existing) continue
    await insertFromTemplate(ctx, companyId, templateByKey(key)!, { enabled: true, userId, tz })
    created.push(key)
  }
  return created
}

function memberLabel(u: Doc<'users'>) {
  return u.name || u.email || u.phone || 'Member'
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireAdmin(ctx)
    const company = await ctx.db.get(companyId)
    const rules = await ctx.db
      .query('automationRules')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(MAX_RULES)
    const members = (
      await ctx.db
        .query('users')
        .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
        .take(500)
    )
      .filter((u) => u.active !== false)
      .map((u) => ({ _id: u._id, name: memberLabel(u), role: u.role ?? 'user', hasPhone: !!u.phone, hasEmail: !!u.email }))
    return {
      timezone: zoneOrDefault(orgProfile(company).timezone),
      onEngine: rules.some((r) => r.builtIn),
      rules: rules.sort((a, b) => a.name.localeCompare(b.name)),
      templates: TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        builtIn: !!t.builtIn,
        triggerKind: t.trigger.kind,
        inUse: rules.some((r) => r.templateKey === t.key),
      })),
      eventTypes: EVENT_TYPES,
      checks: Object.entries(CHECKS).map(([key, c]) => ({
        key,
        label: c.label,
        description: c.description,
        fields: c.fields,
        params: c.params ?? [],
      })),
      members,
    }
  },
})

export const runs = query({
  args: { ruleId: v.optional(v.id('automationRules')), limit: v.optional(v.number()) },
  handler: async (ctx, { ruleId, limit }) => {
    const { companyId } = await requireAdmin(ctx)
    const n = Math.max(1, Math.min(100, Math.floor(limit ?? 50)))
    if (ruleId) {
      await ownRule(ctx, companyId, ruleId)
      return await ctx.db
        .query('automationRuns')
        .withIndex('by_rule_and_createdAt', (q) => q.eq('ruleId', ruleId))
        .order('desc')
        .take(n)
    }
    return await ctx.db
      .query('automationRuns')
      .withIndex('by_company_and_createdAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(n)
  },
})

export const createFromTemplate = mutation({
  args: { templateKey: v.string(), enabled: v.optional(v.boolean()) },
  handler: async (ctx, { templateKey, enabled }) => {
    const { user, companyId } = await requireAdmin(ctx)
    const t = templateByKey(templateKey)
    if (!t) throw new Error('Unknown template')
    if ((await countRules(ctx, companyId)) >= MAX_RULES) throw new Error(`At most ${MAX_RULES} rules per company`)
    if (t.builtIn) {
      const existing = await ctx.db
        .query('automationRules')
        .withIndex('by_company_and_templateKey', (q) => q.eq('companyId', companyId).eq('templateKey', t.key))
        .first()
      if (existing) throw new Error(`"${t.name}" already exists`)
    }
    const { tz } = await companyZone(ctx, companyId)
    const id = await insertFromTemplate(ctx, companyId, t, { enabled: enabled ?? true, userId: user._id, tz })
    await logAudit(ctx, { actionType: 'create', tableName: 'automationRules', recordId: id, newValues: { templateKey } })
    return id
  },
})

/** Create (no ruleId) or update a rule. */
export const save = mutation({
  args: {
    ruleId: v.optional(v.id('automationRules')),
    name: v.string(),
    description: v.optional(v.string()),
    enabled: v.boolean(),
    trigger: automationTrigger,
    match: v.optional(v.union(v.literal('all'), v.literal('any'))),
    conditions: v.array(automationCondition),
    actions: v.array(automationAction),
  },
  handler: async (ctx, args) => {
    const { user, companyId } = await requireAdmin(ctx)
    const draft = await validateDraft(ctx, companyId, args)
    const { tz } = await companyZone(ctx, companyId)
    const now = Date.now()
    const fields = {
      ...draft,
      enabled: args.enabled,
      ...indexFields(draft.trigger, args.enabled, tz, now),
      updatedBy: user._id,
      updatedAt: now,
    }
    if (args.ruleId) {
      const before = await ownRule(ctx, companyId, args.ruleId)
      await ctx.db.patch(args.ruleId, fields)
      await logAudit(ctx, {
        actionType: 'update',
        tableName: 'automationRules',
        recordId: args.ruleId,
        previousValues: before,
        newValues: fields,
      })
      return args.ruleId
    }
    if ((await countRules(ctx, companyId)) >= MAX_RULES) throw new Error(`At most ${MAX_RULES} rules per company`)
    const id = await ctx.db.insert('automationRules', { companyId, ...fields, createdBy: user._id })
    await logAudit(ctx, { actionType: 'create', tableName: 'automationRules', recordId: id, newValues: fields })
    return id
  },
})

export const setEnabled = mutation({
  args: { ruleId: v.id('automationRules'), enabled: v.boolean() },
  handler: async (ctx, { ruleId, enabled }) => {
    const { user, companyId } = await requireAdmin(ctx)
    const rule = await ownRule(ctx, companyId, ruleId)
    const { tz } = await companyZone(ctx, companyId)
    await ctx.db.patch(ruleId, {
      enabled,
      ...indexFields(rule.trigger, enabled, tz, Date.now()),
      updatedBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'update', tableName: 'automationRules', recordId: ruleId, newValues: { enabled } })
    return null
  },
})

export const remove = mutation({
  args: { ruleId: v.id('automationRules') },
  handler: async (ctx, { ruleId }) => {
    const { companyId } = await requireAdmin(ctx)
    const rule = await ownRule(ctx, companyId, ruleId)
    await ctx.db.delete(ruleId)
    await logAudit(ctx, { actionType: 'delete', tableName: 'automationRules', recordId: ruleId, previousValues: rule })
    return null
  },
})

/** Run a schedule rule now for today (company time). */
export const runNow = mutation({
  args: { ruleId: v.id('automationRules') },
  handler: async (ctx, { ruleId }) => {
    const { companyId } = await requireAdmin(ctx)
    const rule = await ownRule(ctx, companyId, ruleId)
    if (rule.trigger.kind !== 'schedule') throw new Error('Only scheduled rules can be run now; event rules run when the event happens')
    const { tz } = await companyZone(ctx, companyId)
    const now = Date.now()
    return await createRun(ctx, rule, {
      triggerKind: 'manual',
      localDate: localParts(now, tz).date,
      dedupeKey: `${rule._id}:manual:${now}`,
    })
  },
})

/** Retry a failed or partial run: resend its failed deliveries (or redo it if it never got going). */
export const rerun = mutation({
  args: { runId: v.id('automationRuns') },
  handler: async (ctx, { runId }) => {
    const { companyId } = await requireAdmin(ctx)
    const run = await ctx.db.get(runId)
    if (!run || run.companyId !== companyId) throw new Error('Run not found')
    if (run.status !== 'failed' && run.status !== 'partial') throw new Error('Only failed or partly failed runs can be re-run')
    await ctx.db.patch(runId, {
      status: 'queued',
      maxAttempts: run.attempts + MAX_ATTEMPTS,
      deliveries: run.deliveries?.map((d) => (d.status === 'failed' ? { ...d, status: 'pending' as const } : d)),
      error: undefined,
      finishedAt: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.automation.engine.executeRun, { runId })
    return null
  },
})

/** Move this company's daily reminders onto automation rules. */
export const enableBuiltIns = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, companyId } = await requireAdmin(ctx)
    const created = await seedBuiltIns(ctx, companyId, user._id)
    if (created.length) {
      await logAudit(ctx, { actionType: 'create', tableName: 'automationRules', newValues: { builtIns: created } })
    }
    return created
  },
})
