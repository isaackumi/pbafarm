/**
 * Compliance (TRACE-006): the biosecurity log per site, checklist templates
 * with a due frequency, and completion records per site and period.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertLocationAccess, assertOwns, logAudit, writeCompanyId } from './lib/tenancy'
import { userError } from './lib/errors'
import { complianceFrequency } from './schema'
import { MAX_TEMPLATE_ITEMS, periodOf, seedTemplatesFor, templateItems } from './lib/compliance'
import { requireMember } from './lib/permissions'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const LIST_LIMIT = 300

function assertDate(date: string, label = 'Date') {
  if (!DATE_RE.test(date)) throw userError('VALIDATION', `${label} must be YYYY-MM-DD`)
}

/** The site, checked to belong to the caller's company and be in their site scope. */
async function ownedSite(ctx: QueryCtx | MutationCtx, user: Doc<'users'>, locationId: Id<'farmLocations'>) {
  const site = await ctx.db.get(locationId)
  assertOwns(user, site, 'Site')
  assertLocationAccess(user, locationId)
  return site
}

const trimmed = (s?: string) => s?.trim() || undefined

// ---------------------------------------------------------------------------
// Biosecurity log
// ---------------------------------------------------------------------------

const biosecurityKind = v.union(
  v.literal('visitor'),
  v.literal('vehicle'),
  v.literal('disinfection'),
  v.literal('other'),
)

export const listBiosecurity = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    const from = args.dateFrom ?? '0000-00-00'
    const to = args.dateTo ?? '9999-99-99'
    const rows = args.locationId
      ? await ctx.db
          .query('biosecurityLogs')
          .withIndex('by_companyId_and_locationId_and_date', (q) =>
            q.eq('companyId', companyId).eq('locationId', args.locationId!).gte('date', from).lte('date', to),
          )
          .order('desc')
          .take(LIST_LIMIT)
      : await ctx.db
          .query('biosecurityLogs')
          .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId).gte('date', from).lte('date', to))
          .order('desc')
          .take(LIST_LIMIT)
    const sites = new Map<string, string>()
    const out = []
    for (const r of rows) {
      if (!sites.has(String(r.locationId))) sites.set(String(r.locationId), (await ctx.db.get(r.locationId))?.name ?? '—')
      out.push({
        id: r._id,
        date: r.date,
        kind: r.kind,
        location_id: r.locationId,
        site_name: sites.get(String(r.locationId))!,
        person: r.person ?? null,
        organisation: r.organisation ?? null,
        vehicle: r.vehicle ?? null,
        purpose: r.purpose ?? null,
        area: r.area ?? null,
        disinfectant: r.disinfectant ?? null,
        entry_controls_done: r.entryControlsDone ?? null,
        notes: r.notes ?? null,
      })
    }
    return out
  },
})

export const logBiosecurity = mutation({
  args: {
    locationId: v.id('farmLocations'),
    date: v.string(),
    kind: biosecurityKind,
    person: v.optional(v.string()),
    organisation: v.optional(v.string()),
    vehicle: v.optional(v.string()),
    purpose: v.optional(v.string()),
    area: v.optional(v.string()),
    disinfectant: v.optional(v.string()),
    entryControlsDone: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.health.record' })
    const companyId = await writeCompanyId(user)
    await ownedSite(ctx, user, args.locationId)
    assertDate(args.date)
    const row = {
      person: trimmed(args.person),
      organisation: trimmed(args.organisation),
      vehicle: trimmed(args.vehicle),
      purpose: trimmed(args.purpose),
      area: trimmed(args.area),
      disinfectant: trimmed(args.disinfectant),
      notes: trimmed(args.notes),
    }
    if (args.kind === 'visitor' && !row.person) throw userError('VALIDATION', 'Enter the visitor’s name')
    if (args.kind === 'vehicle' && !row.vehicle) throw userError('VALIDATION', 'Enter the vehicle registration')
    if (args.kind === 'disinfection' && !row.area) throw userError('VALIDATION', 'Enter what was disinfected')
    const id = await ctx.db.insert('biosecurityLogs', {
      companyId,
      locationId: args.locationId,
      date: args.date,
      kind: args.kind,
      ...row,
      entryControlsDone: args.entryControlsDone,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'biosecurityLogs',
      recordId: id,
      newValues: args,
      locationId: args.locationId,
    })
    return id
  },
})

export const removeBiosecurity = mutation({
  args: { id: v.id('biosecurityLogs') },
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.records.delete' })
    const row = await ctx.db.get(id)
    assertOwns(user, row, 'Entry')
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'biosecurityLogs',
      recordId: id,
      previousValues: row,
      locationId: row.locationId,
    })
    return { ok: true }
  },
})

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function templateRow(t: Doc<'complianceTemplates'>) {
  return {
    id: t._id,
    key: t.key ?? null,
    name: t.name,
    description: t.description ?? null,
    frequency: t.frequency,
    items: t.items,
    active: t.active,
  }
}

async function companyTemplates(ctx: QueryCtx | MutationCtx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('complianceTemplates')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(100)
}

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    return (await companyTemplates(ctx, user.companyId)).map(templateRow)
  },
})

/** Add the built-in templates the company does not have yet (idempotent). */
export const seedDefaultTemplates = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    const companyId = await writeCompanyId(user)
    const added = await seedTemplatesFor(ctx, companyId, { userId: user._id })
    if (added.length) {
      await logAudit(ctx, { actionType: 'create', tableName: 'complianceTemplates', newValues: { seeded: added } })
    }
    return { added }
  },
})

export const createTemplate = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    frequency: complianceFrequency,
    items: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    const companyId = await writeCompanyId(user)
    const name = args.name.trim()
    if (!name) throw userError('VALIDATION', 'Enter a name')
    const labels = args.items.map((s) => s.trim()).filter(Boolean)
    if (!labels.length) throw userError('VALIDATION', 'Add at least one checklist item')
    if (labels.length > MAX_TEMPLATE_ITEMS) {
      throw userError('VALIDATION', `A checklist can have at most ${MAX_TEMPLATE_ITEMS} items`)
    }
    const id = await ctx.db.insert('complianceTemplates', {
      companyId,
      name,
      description: trimmed(args.description),
      frequency: args.frequency,
      items: templateItems(labels),
      active: true,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'complianceTemplates', recordId: id, newValues: args })
    return id
  },
})

export const setTemplateActive = mutation({
  args: { id: v.id('complianceTemplates'), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    const t = await ctx.db.get(id)
    assertOwns(user, t, 'Template')
    await ctx.db.patch(id, { active, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'complianceTemplates',
      recordId: id,
      previousValues: { active: t.active },
      newValues: { active },
    })
    return { ok: true }
  },
})

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

async function recordFor(
  ctx: QueryCtx | MutationCtx,
  templateId: Id<'complianceTemplates'>,
  locationId: Id<'farmLocations'>,
  period: string,
) {
  return await ctx.db
    .query('complianceRecords')
    .withIndex('by_templateId_and_locationId_and_period', (q) =>
      q.eq('templateId', templateId).eq('locationId', locationId).eq('period', period),
    )
    .first()
}

/** Each active checklist for a site: its current period and whether it is done. */
export const due = query({
  args: { locationId: v.id('farmLocations'), today: v.string() },
  handler: async (ctx, { locationId, today }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId || !DATE_RE.test(today)) return []
    const site = await ctx.db.get(locationId)
    if (!site || site.companyId !== user.companyId) return []
    const out = []
    for (const t of await companyTemplates(ctx, user.companyId)) {
      if (!t.active) continue
      const period = periodOf(t.frequency, today)
      const done = await recordFor(ctx, t._id, locationId, period)
      const last = await ctx.db
        .query('complianceRecords')
        .withIndex('by_templateId_and_locationId_and_period', (q) =>
          q.eq('templateId', t._id).eq('locationId', locationId),
        )
        .order('desc')
        .first()
      out.push({
        template: templateRow(t),
        period,
        done: done ? { id: done._id, completed_on: done.completedOn, passed: done.passed } : null,
        last_completed_on: last?.completedOn ?? null,
      })
    }
    const order = { daily: 0, weekly: 1, monthly: 2 }
    return out.sort((a, b) => order[a.template.frequency] - order[b.template.frequency])
  },
})

export const complete = mutation({
  args: {
    templateId: v.id('complianceTemplates'),
    locationId: v.id('farmLocations'),
    date: v.string(),
    answers: v.array(v.object({ itemId: v.string(), ok: v.boolean(), note: v.optional(v.string()) })),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.health.record' })
    const companyId = await writeCompanyId(user)
    const template = await ctx.db.get(args.templateId)
    assertOwns(user, template, 'Checklist')
    if (!template.active) throw userError('CONFLICT', 'This checklist is switched off')
    await ownedSite(ctx, user, args.locationId)
    assertDate(args.date)
    const period = periodOf(template.frequency, args.date)
    if (await recordFor(ctx, template._id, args.locationId, period)) {
      throw userError('DUPLICATE', `${template.name} is already done for ${period} at this site`)
    }
    const byId = new Map(args.answers.map((a) => [a.itemId, a]))
    const missing = template.items.filter((i) => !byId.has(i.id))
    if (missing.length) throw userError('VALIDATION', `Answer every item (missing: ${missing[0].label})`)
    const answers = template.items.map((i) => {
      const a = byId.get(i.id)!
      return { itemId: i.id, ok: a.ok, note: trimmed(a.note) }
    })
    const passed = template.items.every((i) => !i.required || byId.get(i.id)!.ok)
    const id = await ctx.db.insert('complianceRecords', {
      companyId,
      locationId: args.locationId,
      templateId: template._id,
      period,
      completedOn: args.date,
      answers,
      passed,
      notes: trimmed(args.notes),
      completedBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'complianceRecords',
      recordId: id,
      newValues: { templateId: template._id, period, passed },
      locationId: args.locationId,
    })
    return { id, period, passed }
  },
})

export const listRecords = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    templateId: v.optional(v.id('complianceTemplates')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    const rows = await ctx.db
      .query('complianceRecords')
      .withIndex('by_companyId_and_completedOn', (q) =>
        q
          .eq('companyId', companyId)
          .gte('completedOn', args.dateFrom ?? '0000-00-00')
          .lte('completedOn', args.dateTo ?? '9999-99-99'),
      )
      .order('desc')
      .take(LIST_LIMIT)
    const templates = new Map((await companyTemplates(ctx, companyId)).map((t) => [String(t._id), t]))
    const sites = new Map<string, string>()
    const users = new Map<string, string>()
    const out = []
    for (const r of rows) {
      if (args.locationId && r.locationId !== args.locationId) continue
      if (args.templateId && r.templateId !== args.templateId) continue
      if (!sites.has(String(r.locationId))) sites.set(String(r.locationId), (await ctx.db.get(r.locationId))?.name ?? '—')
      if (!users.has(String(r.completedBy))) {
        const u = await ctx.db.get(r.completedBy)
        users.set(String(r.completedBy), u?.name || u?.email || '—')
      }
      const t = templates.get(String(r.templateId))
      const labels = new Map((t?.items ?? []).map((i) => [i.id, i.label]))
      out.push({
        id: r._id,
        template_name: t?.name ?? '—',
        frequency: t?.frequency ?? null,
        site_name: sites.get(String(r.locationId))!,
        period: r.period,
        completed_on: r.completedOn,
        passed: r.passed,
        completed_by: users.get(String(r.completedBy))!,
        notes: r.notes ?? null,
        answers: r.answers.map((a) => ({ label: labels.get(a.itemId) ?? a.itemId, ok: a.ok, note: a.note ?? null })),
      })
    }
    return out
  },
})
