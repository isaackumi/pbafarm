/**
 * Ask Anowa and Projects (PROJ-001): read tools ("how is Row D build
 * going?") and propose tools (create a project, add a milestone, log a cost).
 *
 * Proposals only build a typed draft item (convex/anowa/drafts.ts stores it
 * in pendingBotActions, channel 'web'); nothing touches the project tables
 * until the member confirms the card, and then only through the forms' own
 * helpers in convex/projects.ts. Names the model typed (project, site,
 * owner) are matched against what the member can see; ids never come from
 * the model.
 */
import { v, type Infer } from 'convex/values'
import { internalQuery } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { can, requireMember } from '../lib/permissions'
import { mergeSettings } from '../lib/farmRules'
import { addDays, todayIn, zoneFor } from '../lib/dates'
import { PROJECT_CATEGORIES, PROJECT_LIMITS, budgetPct, isDate, overBudgetPct, projectHealth } from '../lib/projects'
import { isActiveMember } from '../teams'
import { projectSummary } from '../projects'
import { farmDate } from '../bot/scope'
import { webMember, type WebMember } from './scope'

type Ctx = QueryCtx | MutationCtx
type Payload = Doc<'pendingBotActions'>['payload']
export type ProjectBuilt = {
  ok: true
  payload: Payload
  siteId: Id<'farmLocations'> | undefined
  date: string
  summary: string
  fingerprint: string
}
type Failed = { ok: false; error: string }

export const projectCreateInput = v.object({
  kind: v.literal('project_create'),
  name: v.string(),
  budget: v.number(),
  category: v.optional(v.string()),
  startDate: v.optional(v.string()),
  targetEndDate: v.optional(v.string()),
  durationDays: v.optional(v.number()),
  site: v.optional(v.string()),
  owner: v.optional(v.string()),
})

export const projectMilestoneInput = v.object({
  kind: v.literal('project_milestone'),
  project: v.string(),
  title: v.string(),
  dueDate: v.optional(v.string()),
  dueInDays: v.optional(v.number()),
  progressPct: v.optional(v.number()),
})

export const projectCostInput = v.object({
  kind: v.literal('project_cost'),
  project: v.string(),
  amount: v.number(),
  note: v.optional(v.string()),
  daysAgo: v.optional(v.number()),
})

export const PROJECT_KINDS = ['project_create', 'project_milestone', 'project_cost'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]
export const isProjectKind = (k: string): k is ProjectKind => (PROJECT_KINDS as readonly string[]).includes(k)

const key = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

const visible = (w: WebMember, locationId: Id<'farmLocations'> | undefined) =>
  !locationId || w.member.siteScope === 'all' || w.member.siteScope.has(locationId)

/** The project the user named, among those they can see (not cancelled). */
export async function matchProject(ctx: Ctx, w: WebMember, typed: string): Promise<{ project: Doc<'projects'> | null; candidates: string[] }> {
  const text = typed.trim().slice(0, 80)
  if (!text) return { project: null, candidates: [] }
  const hits = (
    await ctx.db
      .query('projects')
      .withSearchIndex('search_name', (s) => s.search('name', text).eq('companyId', w.binding.companyId))
      .take(10)
  ).filter((p) => visible(w, p.locationId) && p.status !== 'cancelled')
  const k = key(text)
  const exact = hits.filter((p) => key(p.name) === k)
  if (exact.length === 1) return { project: exact[0], candidates: [] }
  const contains = hits.filter((p) => key(p.name).includes(k))
  if (contains.length === 1) return { project: contains[0], candidates: [] }
  if (hits.length === 1) return { project: hits[0], candidates: [] }
  return { project: null, candidates: hits.slice(0, 8).map((p) => p.name) }
}

function projectError(typed: string, candidates: string[]): Failed {
  return {
    ok: false,
    error: candidates.length ? `Which project? Matches: ${candidates.join(', ')}` : `No project called "${typed.slice(0, 60)}" that you can see.`,
  }
}

const money = (n: number, currency: string) => `${currency} ${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n)}`

async function buildCreate(ctx: MutationCtx, w: WebMember, input: Infer<typeof projectCreateInput>): Promise<ProjectBuilt | Failed> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name || name.length > PROJECT_LIMITS.name) return { ok: false, error: 'A project needs a short name (up to 120 characters).' }
  if (!Number.isFinite(input.budget) || input.budget < 0 || input.budget > PROJECT_LIMITS.maxAmount) {
    return { ok: false, error: 'The budget must be zero or more.' }
  }
  const category = (PROJECT_CATEGORIES as readonly string[]).includes(input.category ?? '') ? input.category! : 'other'
  const companyId = w.binding.companyId

  // Site: named, else the chat's site; a member limited to some sites must have one.
  let site: Doc<'farmLocations'> | null = w.site
  if (input.site?.trim()) {
    const sites = (
      await ctx.db
        .query('farmLocations')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(500)
    ).filter((s) => s.active !== false && visible(w, s._id))
    const k = key(input.site)
    const hits = sites.filter((s) => key(s.name).includes(k) || (s.code && key(s.code) === k))
    if (hits.length !== 1) {
      return {
        ok: false,
        error: hits.length ? `Which site? Matches: ${hits.slice(0, 8).map((s) => s.name).join(', ')}` : `No site called "${input.site.slice(0, 40)}" in your access.`,
      }
    }
    site = hits[0]
  }
  if (!site && w.member.siteScope !== 'all') return { ok: false, error: 'Which site is this project for? Ask the user.' }

  const today = await farmDate(ctx, w, site?._id, Date.now())
  const startDate = input.startDate && isDate(input.startDate) ? input.startDate : today
  let targetEndDate: string | undefined
  if (input.targetEndDate) {
    if (!isDate(input.targetEndDate)) return { ok: false, error: 'targetEndDate must be YYYY-MM-DD.' }
    targetEndDate = input.targetEndDate
  } else if (input.durationDays != null && Number.isInteger(input.durationDays) && input.durationDays >= 1 && input.durationDays <= 3650) {
    targetEndDate = addDays(startDate, input.durationDays)
  }
  if (!targetEndDate) return { ok: false, error: 'When should the project finish? Ask the user for a target end date.' }
  if (targetEndDate < startDate) return { ok: false, error: 'The target end is before the start.' }

  let owner: Doc<'users'> = w.account
  if (input.owner?.trim()) {
    const k = input.owner.trim().toLowerCase()
    const rows = await ctx.db
      .query('memberships')
      .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', companyId))
      .take(500)
    const people: Doc<'users'>[] = []
    for (const r of rows) {
      if (r.status !== 'active') continue
      const u = await ctx.db.get(r.userId)
      if (u && u.active !== false && !u.deletedAt && (u.name ?? '').toLowerCase().includes(k)) people.push(u)
    }
    if (people.length !== 1) {
      return {
        ok: false,
        error: people.length
          ? `Which person? Matches: ${people.slice(0, 8).map((p) => p.name).join(', ')}`
          : `No active member called "${input.owner.slice(0, 40)}".`,
      }
    }
    owner = people[0]
  }
  if (!(await isActiveMember(ctx, companyId, owner._id))) return { ok: false, error: 'The owner is not an active member.' }

  const currency = mergeSettings(w.company.settings).locale.currency
  const payload: Payload = {
    kind: 'project_create',
    name,
    category,
    budget: Math.round(input.budget * 100) / 100,
    currency,
    startDate,
    targetEndDate,
    ownerUserId: owner._id,
    ownerName: owner.name || 'Member',
    locationId: site?._id,
    siteName: site?.name,
  }
  return {
    ok: true,
    payload,
    siteId: site?._id,
    date: today,
    summary: `New project "${name}": budget ${money(payload.budget, currency)}, ${startDate} to ${targetEndDate}, owner ${payload.ownerName}${site ? `, ${site.name}` : ''}.`,
    fingerprint: `proj|${key(name)}`,
  }
}

async function buildMilestone(ctx: MutationCtx, w: WebMember, input: Infer<typeof projectMilestoneInput>): Promise<ProjectBuilt | Failed> {
  if (!can(w.member, 'projects.view')) return { ok: false, error: 'Your role cannot see projects.' }
  const m = await matchProject(ctx, w, input.project)
  if (!m.project) return projectError(input.project, m.candidates)
  const p = m.project
  const title = input.title.trim().replace(/\s+/g, ' ')
  if (!title || title.length > PROJECT_LIMITS.milestoneTitle) return { ok: false, error: 'A milestone needs a short title (up to 160 characters).' }
  const today = await farmDate(ctx, w, p.locationId, Date.now())
  let dueDate: string | undefined
  if (input.dueDate) {
    if (!isDate(input.dueDate)) return { ok: false, error: 'dueDate must be YYYY-MM-DD.' }
    dueDate = input.dueDate
  } else if (input.dueInDays != null && Number.isInteger(input.dueInDays) && input.dueInDays >= 0 && input.dueInDays <= 3650) {
    dueDate = addDays(today, input.dueInDays)
  }
  if (!dueDate) return { ok: false, error: 'When is the milestone due? Ask the user.' }
  if (p.milestonesTotal >= PROJECT_LIMITS.milestonesPerProject) return { ok: false, error: 'This project already has 100 milestones.' }
  const progressPct = Math.min(100, Math.max(0, Math.round(input.progressPct ?? 0)))
  return {
    ok: true,
    payload: { kind: 'project_milestone', projectId: p._id, projectName: p.name, title, dueDate, progressPct },
    siteId: p.locationId,
    date: today,
    summary: `Milestone "${title}" on ${p.name}, due ${dueDate}${progressPct ? `, ${progressPct}% done` : ''}.`,
    fingerprint: `pms|${p._id}|${key(title)}|${dueDate}`,
  }
}

async function buildCost(ctx: MutationCtx, w: WebMember, input: Infer<typeof projectCostInput>): Promise<ProjectBuilt | Failed> {
  if (!can(w.member, 'projects.view')) return { ok: false, error: 'Your role cannot see projects.' }
  const m = await matchProject(ctx, w, input.project)
  if (!m.project) return projectError(input.project, m.candidates)
  const p = m.project
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > PROJECT_LIMITS.maxAmount) {
    return { ok: false, error: 'The amount must be greater than zero.' }
  }
  const days = input.daysAgo ?? 0
  if (!Number.isInteger(days) || days < 0 || days > 60) return { ok: false, error: 'daysAgo must be a whole number from 0 to 60.' }
  const date = addDays(await farmDate(ctx, w, p.locationId, Date.now()), -days)
  const amount = Math.round(input.amount * 100) / 100
  const note = input.note?.trim().slice(0, PROJECT_LIMITS.note) || undefined
  const after = p.spent + amount
  return {
    ok: true,
    payload: { kind: 'project_cost', projectId: p._id, projectName: p.name, amount, currency: p.currency, note, spentBefore: p.spent, budget: p.budget },
    siteId: p.locationId,
    date,
    summary: `Cost of ${money(amount, p.currency)} on ${p.name} (${date}); spent goes to ${money(after, p.currency)}${
      p.budget > 0 ? ` of ${money(p.budget, p.currency)} (${budgetPct(after, p.budget)}%)` : ''
    }.`,
    fingerprint: `pcost|${p._id}|${amount}|${date}`,
  }
}

export type ProjectProposalInput =
  | Infer<typeof projectCreateInput>
  | Infer<typeof projectMilestoneInput>
  | Infer<typeof projectCostInput>

export async function buildProjectProposal(ctx: MutationCtx, w: WebMember, input: ProjectProposalInput): Promise<ProjectBuilt | Failed> {
  if (input.kind === 'project_create') return buildCreate(ctx, w, input)
  if (input.kind === 'project_milestone') return buildMilestone(ctx, w, input)
  return buildCost(ctx, w, input)
}

/** Why a project draft item cannot be written now (beyond permission and site), or null. */
export async function projectItemProblem(ctx: QueryCtx, w: WebMember, p: Payload): Promise<string | null> {
  if (p.kind === 'project_create') {
    if (!(await isActiveMember(ctx, w.binding.companyId, p.ownerUserId))) return `${p.ownerName} is no longer an active member.`
    if (!p.locationId && w.member.siteScope !== 'all') return 'Pick one of your sites for this project.'
    return null
  }
  if (p.kind === 'project_milestone' || p.kind === 'project_cost') {
    const project = await ctx.db.get(p.projectId)
    if (!project || project.companyId !== w.binding.companyId || !visible(w, project.locationId)) return 'That project is not in your access.'
    if (project.status === 'cancelled') return `${project.name} is cancelled.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

export const projectReadTool = v.union(v.literal('projects_overview'), v.literal('project_detail'))

function overviewText(s: Awaited<ReturnType<typeof projectSummary>>, today: string) {
  const lines = [
    `Today ${today}. Open projects: ${s.counts.active} active, ${s.counts.planned} planned, ${s.counts.on_hold} on hold${s.truncated ? ' (first 500 per status)' : ''}.`,
  ]
  if (s.currency) lines.push(`Open budget ${money(s.budget, s.currency)}, spent ${money(s.spent, s.currency)}.`)
  if (s.overBudget.length) {
    lines.push(
      'Over budget: ' +
        s.overBudget.map((p) => `${p.name} ${money(p.spent, p.currency)} of ${money(p.budget, p.currency)} (${overBudgetPct(p.spent, p.budget)}% over)`).join('; ') +
        '.',
    )
  }
  if (s.lateMilestones.length) {
    lines.push('Late milestones: ' + s.lateMilestones.map((m) => `${m.projectName}: ${m.title} due ${m.dueDate}, ${m.progressPct}% done`).join('; ') + '.')
  }
  if (s.dueSoon.length) {
    lines.push('Due in the next 14 days: ' + s.dueSoon.map((m) => `${m.projectName}: ${m.title} due ${m.dueDate}, ${m.progressPct}% done`).join('; ') + '.')
  }
  if (!s.overBudget.length && !s.lateMilestones.length) lines.push('No project is over budget or has a late milestone.')
  return lines.join('\n')
}

async function detailText(ctx: QueryCtx, p: Doc<'projects'>, today: string) {
  const h = projectHealth(p, today)
  const owner = (await ctx.db.get(p.ownerUserId))?.name || 'Member'
  const site = p.locationId ? (await ctx.db.get(p.locationId))?.name : null
  const ms = await ctx.db
    .query('projectMilestones')
    .withIndex('by_projectId_and_dueDate', (q) => q.eq('projectId', p._id))
    .take(PROJECT_LIMITS.milestonesPerProject)
  const pct = budgetPct(p.spent, p.budget)
  const lines = [
    `${p.name} (${p.category}, ${p.status.replace('_', ' ')}${site ? `, ${site}` : ''}). Owner ${owner}. ${p.startDate} to ${p.targetEndDate}.`,
    `Budget ${money(p.budget, p.currency)}, spent ${money(p.spent, p.currency)}${pct != null ? ` (${pct}%)` : ''}${h.overBudget ? `, ${overBudgetPct(p.spent, p.budget)}% over budget` : ''}.`,
    `Progress ${p.progressPct}% (${p.milestonesDone} of ${p.milestonesTotal} milestones done).${h.pastEnd ? ' Past its target end.' : ''}`,
  ]
  if (ms.length) {
    lines.push(
      'Milestones: ' +
        ms
          .slice(0, 12)
          .map((m) => `${m.title}: ${m.open ? `due ${m.dueDate}, ${m.progressPct}%${m.dueDate < today ? ' (late)' : ''}` : `done ${m.doneDate ?? ''}`}`)
          .join('; ') +
        (ms.length > 12 ? `; and ${ms.length - 12} more` : '') +
        '.',
    )
  }
  return lines.join('\n')
}

/** A project read for the signed-in member (ai.use and projects.view, re-checked per call). */
export const read = internalQuery({
  args: { siteId: v.optional(v.id('farmLocations')), tool: projectReadTool, project: v.optional(v.string()), now: v.number() },
  returns: v.union(v.object({ ok: v.literal(true), data: v.string() }), v.object({ ok: v.literal(false), error: v.string() })),
  handler: async (ctx, { siteId, tool, project, now }) => {
    const w = await webMember(ctx, await requireMember(ctx, { permission: 'ai.use' }), siteId)
    if (!can(w.member, 'projects.view')) return { ok: false as const, error: 'Your role cannot see projects.' }
    const today = todayIn(zoneFor(w.site, w.company), now)
    if (tool === 'projects_overview') {
      return { ok: true as const, data: overviewText(await projectSummary(ctx, w.member, today, w.site?._id), today) }
    }
    const m = await matchProject(ctx, w, project ?? '')
    if (!m.project) return { ok: false as const, error: projectError(project ?? '', m.candidates).error }
    return { ok: true as const, data: await detailText(ctx, m.project, today) }
  },
})
