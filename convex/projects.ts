import { v, type Infer } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertSiteInScope, can, requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import { mergeSettings } from './lib/farmRules'
import { isActiveMember } from './teams'
import { projectCategory, projectStatus } from './lib/projectTables'
import {
  OPEN_STATUSES,
  PROJECT_LIMITS as L,
  budgetPct,
  clampProgress,
  isDate,
  projectHealth,
  purchaseOrderValue,
  rollupMilestones,
} from './lib/projects'

/**
 * Projects: capex and farm improvements (Paper 20, doc PROJ-001).
 *
 * - Read: `projects.view` (every role template); write: `projects.manage`
 *   (owner, admin, manager). A project with a site follows site scope: a
 *   member limited to some sites sees company-wide projects and those of
 *   their sites, and creates projects only on their sites.
 * - Lists are paginated and indexed (at most 100 a page); the exceptions
 *   summary reads bounded index ranges (over budget, open milestones by due
 *   date), never every project.
 * - Totals live on the project row (spent, milestone progress, next due) and
 *   are recomputed from the project's bounded children on every write.
 * - A cost may link an existing expense or purchase order: its amount is
 *   that row's (kept in step by syncExpenseLink), and each expense or order
 *   counts towards one project, once.
 * - Every write is audit-logged. The `…As` helpers are shared with Ask Anowa
 *   (convex/anowa/drafts.ts), which calls them only after the member confirms.
 */

type Ctx = QueryCtx | MutationCtx
type Actor = Pick<MemberContext, 'companyId' | 'siteScope'> & { user: Doc<'users'> }

const fail = (message: string) => {
  throw userError('VALIDATION', message)
}
const notFound = (label = 'Project'): never => {
  throw userError('NOT_FOUND', `${label} not found`)
}

function companyOf(m: Actor): Id<'companies'> {
  if (!m.companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
  return m.companyId
}

function siteVisible(m: Pick<MemberContext, 'siteScope'>, locationId: Id<'farmLocations'> | undefined | null) {
  return !locationId || m.siteScope === 'all' || m.siteScope.has(locationId)
}

/** A project of the caller's company and sites, else NOT_FOUND (never "forbidden": no existence leak). */
export async function loadProject(ctx: Ctx, m: Actor, id: Id<'projects'>): Promise<Doc<'projects'>> {
  const p = await ctx.db.get(id)
  if (!p || p.companyId !== m.companyId || !siteVisible(m, p.locationId)) return notFound()
  return p
}

function cleanText(s: string | undefined, max: number): string | undefined {
  const t = s?.trim().replace(/\s+/g, ' ')
  if (!t) return undefined
  if (t.length > max) fail(`Keep it under ${max} characters`)
  return t
}

function validName(name: string) {
  const n = cleanText(name, L.name)
  if (!n) fail('Project name is required')
  return n!
}

function validAmount(n: number, label: string, allowZero = false) {
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > L.maxAmount) {
    fail(`${label} must be ${allowZero ? 'zero or more' : 'greater than zero'}`)
  }
  return Math.round(n * 100) / 100
}

function validDate(d: string, label: string) {
  if (!isDate(d)) fail(`${label} must be a date (YYYY-MM-DD)`)
  return d
}

async function validSite(ctx: Ctx, m: Actor, locationId: Id<'farmLocations'> | undefined) {
  if (!locationId) {
    if (m.siteScope !== 'all') fail('Pick one of your sites for this project')
    return undefined
  }
  const site = await ctx.db.get(locationId)
  if (!site || site.companyId !== m.companyId || site.active === false) return notFound('Site')
  assertSiteInScope(m as MemberContext, locationId)
  return locationId
}

async function validOwner(ctx: Ctx, m: Actor, ownerUserId: Id<'users'> | undefined) {
  const id = ownerUserId ?? m.user._id
  if (!(await isActiveMember(ctx as QueryCtx, companyOf(m), id))) fail('The owner must be an active member of the organization')
  return id
}

async function validUnits(ctx: Ctx, m: Actor, unitIds: Id<'cages'>[] | undefined, locationId: Id<'farmLocations'> | undefined) {
  if (!unitIds?.length) return undefined
  const unique = [...new Set(unitIds)]
  if (unique.length > L.units) fail(`At most ${L.units} units per project`)
  for (const id of unique) {
    const cage = await ctx.db.get(id)
    if (!cage || cage.companyId !== m.companyId || !siteVisible(m, cage.locationId)) return notFound('Unit')
    if (locationId && cage.locationId && cage.locationId !== locationId) fail(`${cage.name} is at another site`)
  }
  return unique
}

/** Recompute spent / overBudget from the project's costs (bounded). */
async function refreshSpent(ctx: MutationCtx, projectId: Id<'projects'>) {
  const p = await ctx.db.get(projectId)
  if (!p) return
  const costs = await ctx.db
    .query('projectCosts')
    .withIndex('by_projectId_and_date', (q) => q.eq('projectId', projectId))
    .take(L.costsPerProject + 1)
  const spent = Math.round(costs.reduce((s, c) => s + c.amount, 0) * 100) / 100
  await ctx.db.patch(projectId, { spent, overBudget: p.budget > 0 && spent > p.budget, updatedAt: Date.now() })
}

/** Recompute milestone totals on the project (bounded). */
async function refreshMilestones(ctx: MutationCtx, projectId: Id<'projects'>) {
  const ms = await ctx.db
    .query('projectMilestones')
    .withIndex('by_projectId_and_dueDate', (q) => q.eq('projectId', projectId))
    .take(L.milestonesPerProject + 1)
  const r = rollupMilestones(ms)
  await ctx.db.patch(projectId, { ...r, nextDueDate: r.nextDueDate, updatedAt: Date.now() })
}

// ---------------------------------------------------------------------------
// Shared write helpers (forms and Ask Anowa). Callers check `projects.manage`.
// ---------------------------------------------------------------------------

export const createFields = {
  name: v.string(),
  category: v.optional(projectCategory),
  ownerUserId: v.optional(v.id('users')),
  locationId: v.optional(v.id('farmLocations')),
  startDate: v.string(),
  targetEndDate: v.string(),
  budget: v.number(),
  unitIds: v.optional(v.array(v.id('cages'))),
  notes: v.optional(v.string()),
  status: v.optional(projectStatus),
}
const createArgs = v.object(createFields)
export type CreateProjectInput = Infer<typeof createArgs>

export async function createProjectAs(ctx: MutationCtx, m: Actor, input: CreateProjectInput): Promise<Id<'projects'>> {
  const companyId = companyOf(m)
  const name = validName(input.name)
  const startDate = validDate(input.startDate, 'Start date')
  const targetEndDate = validDate(input.targetEndDate, 'Target end')
  if (targetEndDate < startDate) fail('The target end is before the start')
  const budget = validAmount(input.budget, 'Budget', true)
  const locationId = await validSite(ctx, m, input.locationId)
  const ownerUserId = await validOwner(ctx, m, input.ownerUserId)
  const unitIds = await validUnits(ctx, m, input.unitIds, locationId)
  const company = await ctx.db.get(companyId)
  const row = {
    companyId,
    locationId,
    name,
    category: input.category ?? ('other' as const),
    ownerUserId,
    startDate,
    targetEndDate,
    budget,
    currency: mergeSettings(company?.settings).locale.currency,
    status: input.status ?? ('planned' as const),
    unitIds,
    notes: cleanText(input.notes, L.note),
    spent: 0,
    overBudget: false,
    milestonesTotal: 0,
    milestonesDone: 0,
    progressPct: 0,
    createdBy: m.user._id,
    updatedAt: Date.now(),
  }
  const id = await ctx.db.insert('projects', row)
  await logAudit(ctx, { actionType: 'create', tableName: 'projects', recordId: id, newValues: row, locationId })
  return id
}

export type MilestoneInput = { title: string; dueDate: string; progressPct?: number }

export async function addMilestoneAs(ctx: MutationCtx, m: Actor, projectId: Id<'projects'>, input: MilestoneInput) {
  const p = await loadProject(ctx, m, projectId)
  const title = cleanText(input.title, L.milestoneTitle)
  if (!title) fail('Milestone title is required')
  const dueDate = validDate(input.dueDate, 'Due date')
  const existing = await ctx.db
    .query('projectMilestones')
    .withIndex('by_projectId_and_dueDate', (q) => q.eq('projectId', projectId))
    .take(L.milestonesPerProject)
  if (existing.length >= L.milestonesPerProject) fail(`At most ${L.milestonesPerProject} milestones per project`)
  const progressPct = clampProgress(input.progressPct ?? 0)
  const now = Date.now()
  const done = progressPct >= 100
  const row = {
    companyId: p.companyId,
    projectId,
    locationId: p.locationId,
    title: title!,
    dueDate,
    progressPct,
    open: !done,
    ...(done ? { doneAt: now, doneDate: dueDate } : {}),
    updatedAt: now,
  }
  const id = await ctx.db.insert('projectMilestones', row)
  await refreshMilestones(ctx, projectId)
  await logAudit(ctx, { actionType: 'create', tableName: 'projectMilestones', recordId: id, newValues: row, locationId: p.locationId })
  return id
}

export type CostInput = {
  amount?: number
  date?: string
  note?: string
  expenseId?: Id<'expenses'>
  purchaseOrderId?: Id<'purchaseOrders'>
}

/** The amount and date a linked expense or order contributes; null when it no longer counts. */
async function linkedValue(ctx: Ctx, cost: Pick<Doc<'projectCosts'>, 'expenseId' | 'purchaseOrderId' | 'companyId'>) {
  if (cost.expenseId) {
    const e = await ctx.db.get(cost.expenseId)
    if (!e || e.companyId !== cost.companyId || e.deletedAt) return null
    return { amount: e.amount, date: e.date }
  }
  if (cost.purchaseOrderId) {
    const po = await ctx.db.get(cost.purchaseOrderId)
    if (!po || po.companyId !== cost.companyId || (po.status !== 'ordered' && po.status !== 'received')) return null
    return {
      amount: purchaseOrderValue(po.lines, po.status === 'received'),
      date: po.receivedDate ?? (po.orderedAt ? new Date(po.orderedAt).toISOString().slice(0, 10) : po.expectedDate ?? ''),
    }
  }
  return null
}

export async function addCostAs(ctx: MutationCtx, m: Actor, projectId: Id<'projects'>, input: CostInput) {
  const p = await loadProject(ctx, m, projectId)
  const sources = [input.amount !== undefined, !!input.expenseId, !!input.purchaseOrderId].filter(Boolean).length
  if (sources !== 1) fail('Enter an amount, or link one expense or purchase order')
  const count = await ctx.db
    .query('projectCosts')
    .withIndex('by_projectId_and_date', (q) => q.eq('projectId', projectId))
    .take(L.costsPerProject)
  if (count.length >= L.costsPerProject) fail(`At most ${L.costsPerProject} costs per project`)

  let amount: number
  let date: string
  if (input.expenseId || input.purchaseOrderId) {
    if (input.expenseId) {
      const e = await ctx.db.get(input.expenseId)
      if (!e || e.companyId !== p.companyId || e.deletedAt || !siteVisible(m, e.locationId)) return notFound('Expense')
      const dup = await ctx.db
        .query('projectCosts')
        .withIndex('by_company_and_expenseId', (q) => q.eq('companyId', p.companyId).eq('expenseId', input.expenseId))
        .first()
      if (dup) throw userError('DUPLICATE', 'That expense already counts towards a project')
    } else {
      const po = await ctx.db.get(input.purchaseOrderId!)
      if (!po || po.companyId !== p.companyId || !siteVisible(m, po.locationId)) return notFound('Purchase order')
      if (po.status !== 'ordered' && po.status !== 'received') fail('Only placed or received orders can be linked')
      const dup = await ctx.db
        .query('projectCosts')
        .withIndex('by_company_and_purchaseOrderId', (q) => q.eq('companyId', p.companyId).eq('purchaseOrderId', input.purchaseOrderId))
        .first()
      if (dup) throw userError('DUPLICATE', 'That purchase order already counts towards a project')
    }
    const linked = await linkedValue(ctx, { companyId: p.companyId, expenseId: input.expenseId, purchaseOrderId: input.purchaseOrderId })
    if (!linked) return notFound('Expense')
    amount = linked.amount
    date = isDate(linked.date) ? linked.date : validDate(input.date ?? '', 'Date')
  } else {
    amount = validAmount(input.amount!, 'Amount')
    date = validDate(input.date ?? '', 'Date')
  }
  const row = {
    companyId: p.companyId,
    projectId,
    amount,
    date,
    note: cleanText(input.note, L.note),
    expenseId: input.expenseId,
    purchaseOrderId: input.purchaseOrderId,
    createdBy: m.user._id,
    updatedAt: Date.now(),
  }
  const id = await ctx.db.insert('projectCosts', row)
  await refreshSpent(ctx, projectId)
  await logAudit(ctx, { actionType: 'create', tableName: 'projectCosts', recordId: id, newValues: row, locationId: p.locationId })
  return id
}

/** Delete a project cost (also Ask Anowa's Undo). */
export async function removeCostAs(ctx: MutationCtx, m: Actor, costId: Id<'projectCosts'>) {
  const c = await ctx.db.get(costId)
  if (!c || c.companyId !== m.companyId) return notFound('Cost')
  const p = await loadProject(ctx, m, c.projectId)
  await ctx.db.delete(costId)
  await refreshSpent(ctx, c.projectId)
  await logAudit(ctx, { actionType: 'delete', tableName: 'projectCosts', recordId: costId, previousValues: c, locationId: p.locationId })
}

/** Delete a milestone (also Ask Anowa's Undo). */
export async function removeMilestoneAs(ctx: MutationCtx, m: Actor, milestoneId: Id<'projectMilestones'>) {
  const ms = await ctx.db.get(milestoneId)
  if (!ms || ms.companyId !== m.companyId) return notFound('Milestone')
  const p = await loadProject(ctx, m, ms.projectId)
  await ctx.db.delete(milestoneId)
  await refreshMilestones(ctx, ms.projectId)
  await logAudit(ctx, { actionType: 'delete', tableName: 'projectMilestones', recordId: milestoneId, previousValues: ms, locationId: p.locationId })
}

/** Delete a project with no costs, and its milestones (also Ask Anowa's Undo). */
export async function removeProjectAs(ctx: MutationCtx, m: Actor, projectId: Id<'projects'>) {
  const p = await loadProject(ctx, m, projectId)
  const cost = await ctx.db
    .query('projectCosts')
    .withIndex('by_projectId_and_date', (q) => q.eq('projectId', projectId))
    .first()
  if (cost) throw userError('CONFLICT', 'This project has costs; cancel it instead of deleting it')
  const ms = await ctx.db
    .query('projectMilestones')
    .withIndex('by_projectId_and_dueDate', (q) => q.eq('projectId', projectId))
    .take(L.milestonesPerProject + 1)
  for (const row of ms) await ctx.db.delete(row._id)
  await ctx.db.delete(projectId)
  await logAudit(ctx, { actionType: 'delete', tableName: 'projects', recordId: projectId, previousValues: p, locationId: p.locationId })
}

/**
 * Keep project costs that link this expense in step with it: the edited
 * amount and date, or removed when the expense is deleted. Called by
 * expenses.update / expenses.remove.
 */
export async function syncExpenseLink(ctx: MutationCtx, expense: Doc<'expenses'>) {
  const links = await ctx.db
    .query('projectCosts')
    .withIndex('by_company_and_expenseId', (q) => q.eq('companyId', expense.companyId).eq('expenseId', expense._id))
    .take(5)
  for (const c of links) {
    const value = await linkedValue(ctx, c)
    if (!value) {
      await ctx.db.delete(c._id)
      await logAudit(ctx, { actionType: 'delete', tableName: 'projectCosts', recordId: c._id, previousValues: c, newValues: { reason: 'expense deleted' } })
    } else if (value.amount !== c.amount || value.date !== c.date) {
      await ctx.db.patch(c._id, { amount: value.amount, date: isDate(value.date) ? value.date : c.date, updatedAt: Date.now() })
      await logAudit(ctx, { actionType: 'update', tableName: 'projectCosts', recordId: c._id, previousValues: c, newValues: value })
    } else {
      continue
    }
    await refreshSpent(ctx, c.projectId)
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const projectView = v.object({
  id: v.id('projects'),
  name: v.string(),
  category: projectCategory,
  status: projectStatus,
  locationId: v.union(v.id('farmLocations'), v.null()),
  locationName: v.union(v.string(), v.null()),
  ownerUserId: v.id('users'),
  ownerName: v.string(),
  startDate: v.string(),
  targetEndDate: v.string(),
  budget: v.number(),
  spent: v.number(),
  currency: v.string(),
  budgetPct: v.union(v.number(), v.null()),
  progressPct: v.number(),
  milestonesTotal: v.number(),
  milestonesDone: v.number(),
  nextDueDate: v.union(v.string(), v.null()),
  unitCount: v.number(),
  overBudget: v.boolean(),
  lateMilestone: v.boolean(),
  pastEnd: v.boolean(),
  atRisk: v.boolean(),
})
export type ProjectView = Infer<typeof projectView>

function nameCache(ctx: Ctx) {
  const users = new Map<string, string>()
  const sites = new Map<string, string | null>()
  return {
    async user(id: Id<'users'>) {
      if (!users.has(id)) {
        const u = await ctx.db.get(id)
        users.set(id, u?.name || 'Member')
      }
      return users.get(id)!
    },
    async site(id: Id<'farmLocations'> | undefined) {
      if (!id) return null
      if (!sites.has(id)) sites.set(id, (await ctx.db.get(id))?.name ?? null)
      return sites.get(id)!
    },
  }
}

async function toView(p: Doc<'projects'>, today: string, names: ReturnType<typeof nameCache>): Promise<ProjectView> {
  const h = projectHealth(p, today)
  return {
    id: p._id,
    name: p.name,
    category: p.category,
    status: p.status,
    locationId: p.locationId ?? null,
    locationName: await names.site(p.locationId),
    ownerUserId: p.ownerUserId,
    ownerName: await names.user(p.ownerUserId),
    startDate: p.startDate,
    targetEndDate: p.targetEndDate,
    budget: p.budget,
    spent: p.spent,
    currency: p.currency,
    budgetPct: budgetPct(p.spent, p.budget),
    progressPct: p.progressPct,
    milestonesTotal: p.milestonesTotal,
    milestonesDone: p.milestonesDone,
    nextDueDate: p.nextDueDate ?? null,
    unitCount: p.unitIds?.length ?? 0,
    ...h,
  }
}

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' }

/**
 * One page of projects, by target end date. Filters: status, site, owner,
 * name search, at risk (over budget, a late milestone or past its end).
 * `today` is the farm date from the client (queries never read the clock).
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    today: v.string(),
    status: v.optional(projectStatus),
    locationId: v.optional(v.id('farmLocations')),
    ownerUserId: v.optional(v.id('users')),
    search: v.optional(v.string()),
    atRisk: v.optional(v.boolean()),
  },
  returns: paginationResultValidator(projectView),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'projects.view', locationId: args.locationId })
    if (args.paginationOpts.numItems > L.pageSize) fail(`At most ${L.pageSize} projects a page`)
    if (!isDate(args.today)) fail('today must be YYYY-MM-DD')
    const companyId = m.companyId
    if (!companyId) return EMPTY_PAGE
    const today = args.today
    const search = args.search?.trim().slice(0, 80)

    const base = ctx.db.query('projects')
    let q
    if (search) {
      q = base.withSearchIndex('search_name', (s) => s.search('name', search).eq('companyId', companyId))
    } else if (args.locationId) {
      q = base.withIndex('by_company_and_locationId_and_targetEndDate', (i) => i.eq('companyId', companyId).eq('locationId', args.locationId))
    } else if (args.ownerUserId) {
      q = base.withIndex('by_company_and_ownerUserId_and_targetEndDate', (i) => i.eq('companyId', companyId).eq('ownerUserId', args.ownerUserId!))
    } else if (args.status) {
      q = base.withIndex('by_company_and_status_and_targetEndDate', (i) => i.eq('companyId', companyId).eq('status', args.status!))
    } else {
      q = base.withIndex('by_company_and_targetEndDate', (i) => i.eq('companyId', companyId))
    }
    const scope = m.siteScope
    const filtered = q.filter((f) => {
      const conds = []
      if (args.status) conds.push(f.eq(f.field('status'), args.status))
      if (args.locationId) conds.push(f.eq(f.field('locationId'), args.locationId))
      if (args.ownerUserId) conds.push(f.eq(f.field('ownerUserId'), args.ownerUserId))
      if (scope !== 'all') {
        conds.push(f.or(f.eq(f.field('locationId'), undefined), ...[...scope].map((id) => f.eq(f.field('locationId'), id))))
      }
      if (args.atRisk) {
        conds.push(f.or(...OPEN_STATUSES.map((s) => f.eq(f.field('status'), s))))
        conds.push(
          f.or(
            f.eq(f.field('overBudget'), true),
            f.and(f.neq(f.field('nextDueDate'), undefined), f.lt(f.field('nextDueDate'), today)),
            f.lt(f.field('targetEndDate'), today),
          ),
        )
      }
      return conds.length ? f.and(...conds) : true
    })
    const page = await filtered.paginate(args.paginationOpts)
    const names = nameCache(ctx)
    const rows: ProjectView[] = []
    for (const p of page.page) rows.push(await toView(p, today, names))
    return { ...page, page: rows }
  },
})

const milestoneRef = v.object({
  id: v.id('projectMilestones'),
  projectId: v.id('projects'),
  projectName: v.string(),
  title: v.string(),
  dueDate: v.string(),
  progressPct: v.number(),
})

/**
 * Exceptions first (Paper 20 brief): projects over budget, late milestones
 * and milestones due in the next 14 days, plus open-project totals. Every
 * read is a bounded index range; `truncated` says the totals stopped early.
 */
export const summary = query({
  args: { today: v.string(), locationId: v.optional(v.id('farmLocations')) },
  returns: v.object({
    counts: v.object({ planned: v.number(), active: v.number(), on_hold: v.number() }),
    budget: v.number(),
    spent: v.number(),
    currency: v.union(v.string(), v.null()),
    truncated: v.boolean(),
    overBudget: v.array(v.object({ id: v.id('projects'), name: v.string(), spent: v.number(), budget: v.number(), currency: v.string() })),
    lateMilestones: v.array(milestoneRef),
    dueSoon: v.array(milestoneRef),
  }),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'projects.view', locationId: args.locationId })
    if (!isDate(args.today)) fail('today must be YYYY-MM-DD')
    return await projectSummary(ctx, m, args.today, args.locationId)
  },
})

const TOTALS_CAP = 500
const EXCEPTIONS_CAP = 20

export async function projectSummary(ctx: Ctx, m: Actor, today: string, locationId?: Id<'farmLocations'>) {
  const companyId = m.companyId
  const empty = {
    counts: { planned: 0, active: 0, on_hold: 0 },
    budget: 0,
    spent: 0,
    currency: null,
    truncated: false,
    overBudget: [],
    lateMilestones: [],
    dueSoon: [],
  }
  if (!companyId) return empty
  const inView = (loc: Id<'farmLocations'> | undefined) => siteVisible(m, loc) && (!locationId || loc === locationId)
  const open = new Set<string>(OPEN_STATUSES)

  const counts = { planned: 0, active: 0, on_hold: 0 }
  let budget = 0
  let spent = 0
  let truncated = false
  let currency: string | null = null
  for (const status of OPEN_STATUSES as Array<'planned' | 'active' | 'on_hold'>) {
    const rows = await ctx.db
      .query('projects')
      .withIndex('by_company_and_status_and_targetEndDate', (q) => q.eq('companyId', companyId).eq('status', status))
      .take(TOTALS_CAP + 1)
    if (rows.length > TOTALS_CAP) truncated = true
    for (const p of rows.slice(0, TOTALS_CAP)) {
      if (!inView(p.locationId)) continue
      counts[status] += 1
      budget += p.budget
      spent += p.spent
      currency ??= p.currency
    }
  }

  const over = await ctx.db
    .query('projects')
    .withIndex('by_company_and_overBudget', (q) => q.eq('companyId', companyId).eq('overBudget', true))
    .take(200)
  const overBudget = over
    .filter((p) => open.has(p.status) && inView(p.locationId))
    .slice(0, EXCEPTIONS_CAP)
    .map((p) => ({ id: p._id, name: p.name, spent: p.spent, budget: p.budget, currency: p.currency }))

  const projectNames = new Map<string, Doc<'projects'> | null>()
  const withProject = async (rows: Doc<'projectMilestones'>[]) => {
    const out = []
    for (const ms of rows) {
      if (!inView(ms.locationId)) continue
      if (!projectNames.has(ms.projectId)) projectNames.set(ms.projectId, await ctx.db.get(ms.projectId))
      const p = projectNames.get(ms.projectId)
      if (!p || !open.has(p.status)) continue
      out.push({ id: ms._id, projectId: p._id, projectName: p.name, title: ms.title, dueDate: ms.dueDate, progressPct: ms.progressPct })
      if (out.length >= EXCEPTIONS_CAP) break
    }
    return out
  }
  const late = await ctx.db
    .query('projectMilestones')
    .withIndex('by_company_and_open_and_dueDate', (q) => q.eq('companyId', companyId).eq('open', true).lt('dueDate', today))
    .take(200)
  const soonEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10)
  const soon = await ctx.db
    .query('projectMilestones')
    .withIndex('by_company_and_open_and_dueDate', (q) =>
      q.eq('companyId', companyId).eq('open', true).gte('dueDate', today).lte('dueDate', soonEnd),
    )
    .take(200)
  return {
    counts,
    budget: Math.round(budget * 100) / 100,
    spent: Math.round(spent * 100) / 100,
    currency,
    truncated,
    overBudget,
    lateMilestones: await withProject(late),
    dueSoon: await withProject(soon),
  }
}

const milestoneView = v.object({
  id: v.id('projectMilestones'),
  title: v.string(),
  dueDate: v.string(),
  progressPct: v.number(),
  done: v.boolean(),
  doneDate: v.union(v.string(), v.null()),
  late: v.boolean(),
})

/** One project with its milestones and units (costs page separately: listCosts). */
export const get = query({
  args: { id: v.id('projects'), today: v.string() },
  returns: v.object({
    project: projectView,
    notes: v.union(v.string(), v.null()),
    units: v.array(v.object({ id: v.id('cages'), name: v.string() })),
    milestones: v.array(milestoneView),
    canManage: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'projects.view' })
    if (!isDate(args.today)) fail('today must be YYYY-MM-DD')
    const p = await loadProject(ctx, m, args.id)
    const ms = await ctx.db
      .query('projectMilestones')
      .withIndex('by_projectId_and_dueDate', (q) => q.eq('projectId', p._id))
      .take(L.milestonesPerProject)
    const units = []
    for (const id of p.unitIds ?? []) {
      const c = await ctx.db.get(id)
      if (c && c.companyId === p.companyId && siteVisible(m, c.locationId)) units.push({ id: c._id, name: c.name })
    }
    return {
      project: await toView(p, args.today, nameCache(ctx)),
      notes: p.notes ?? null,
      units,
      milestones: ms.map((x) => ({
        id: x._id,
        title: x.title,
        dueDate: x.dueDate,
        progressPct: x.open ? x.progressPct : 100,
        done: !x.open,
        doneDate: x.doneDate ?? null,
        late: x.open && x.dueDate < args.today,
      })),
      canManage: can(m, 'projects.manage'),
    }
  },
})

const costView = v.object({
  id: v.id('projectCosts'),
  amount: v.number(),
  date: v.string(),
  note: v.union(v.string(), v.null()),
  source: v.union(v.literal('manual'), v.literal('expense'), v.literal('purchase_order')),
  sourceLabel: v.union(v.string(), v.null()),
})

/** A project's costs, newest first, one page at a time. */
export const listCosts = query({
  args: { projectId: v.id('projects'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(costView),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'projects.view' })
    if (args.paginationOpts.numItems > L.pageSize) fail(`At most ${L.pageSize} costs a page`)
    const p = await loadProject(ctx, m, args.projectId)
    const page = await ctx.db
      .query('projectCosts')
      .withIndex('by_projectId_and_date', (q) => q.eq('projectId', p._id))
      .order('desc')
      .paginate(args.paginationOpts)
    const rows = []
    for (const c of page.page) {
      let sourceLabel: string | null = null
      if (c.expenseId) {
        const e = await ctx.db.get(c.expenseId)
        sourceLabel = e ? `${e.category}${e.notes ? ` · ${e.notes.slice(0, 60)}` : ''}` : null
      } else if (c.purchaseOrderId) {
        sourceLabel = (await ctx.db.get(c.purchaseOrderId))?.poNumber ?? null
      }
      rows.push({
        id: c._id,
        amount: c.amount,
        date: c.date,
        note: c.note ?? null,
        source: c.expenseId ? ('expense' as const) : c.purchaseOrderId ? ('purchase_order' as const) : ('manual' as const),
        sourceLabel,
      })
    }
    return { ...page, page: rows }
  },
})

/**
 * Expenses and placed orders that could be linked to a project cost: recent,
 * in the member's sites, not already counted towards any project.
 */
export const linkable = query({
  args: { projectId: v.id('projects') },
  returns: v.object({
    expenses: v.array(v.object({ id: v.id('expenses'), date: v.string(), category: v.string(), amount: v.number(), notes: v.union(v.string(), v.null()) })),
    purchaseOrders: v.array(v.object({ id: v.id('purchaseOrders'), poNumber: v.string(), status: v.string(), amount: v.number() })),
  }),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'projects.manage' })
    const p = await loadProject(ctx, m, args.projectId)
    const companyId = p.companyId
    const expenses = []
    if (can(m, 'finance.view')) {
      const rows = await ctx.db
        .query('expenses')
        .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId))
        .order('desc')
        .take(100)
      for (const e of rows) {
        if (e.deletedAt || !siteVisible(m, e.locationId)) continue
        const used = await ctx.db
          .query('projectCosts')
          .withIndex('by_company_and_expenseId', (q) => q.eq('companyId', companyId).eq('expenseId', e._id))
          .first()
        if (!used) expenses.push({ id: e._id, date: e.date, category: e.category, amount: e.amount, notes: e.notes ?? null })
        if (expenses.length >= 30) break
      }
    }
    const purchaseOrders = []
    if (can(m, 'inventory.view')) {
      for (const status of ['received', 'ordered'] as const) {
        const rows = await ctx.db
          .query('purchaseOrders')
          .withIndex('by_company_and_status', (q) => q.eq('companyId', companyId).eq('status', status))
          .order('desc')
          .take(30)
        for (const po of rows) {
          if (!siteVisible(m, po.locationId)) continue
          const used = await ctx.db
            .query('projectCosts')
            .withIndex('by_company_and_purchaseOrderId', (q) => q.eq('companyId', companyId).eq('purchaseOrderId', po._id))
            .first()
          if (!used) purchaseOrders.push({ id: po._id, poNumber: po.poNumber, status: po.status, amount: purchaseOrderValue(po.lines, status === 'received') })
        }
      }
    }
    return { expenses, purchaseOrders: purchaseOrders.slice(0, 30) }
  },
})

/** Active members who can own a project (owner picker), bounded. */
export const ownerOptions = query({
  args: {},
  returns: v.array(v.object({ userId: v.id('users'), name: v.string() })),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'projects.view' })
    const companyId = m.companyId
    if (!companyId) return []
    const rows = await ctx.db
      .query('memberships')
      .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', companyId))
      .take(1000)
    const out = []
    for (const r of rows) {
      if (r.status !== 'active') continue
      const u = await ctx.db.get(r.userId)
      if (!u || u.active === false || u.deletedAt) continue
      out.push({ userId: u._id, name: u.name || 'Member' })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

// ---------------------------------------------------------------------------
// Mutations (forms)
// ---------------------------------------------------------------------------

async function manager(ctx: MutationCtx) {
  return await requireMember(ctx, { permission: 'projects.manage' })
}

export const create = mutation({
  args: createFields,
  returns: v.id('projects'),
  handler: async (ctx, args) => createProjectAs(ctx, await manager(ctx), args),
})

export const update = mutation({
  args: {
    id: v.id('projects'),
    name: v.optional(v.string()),
    category: v.optional(projectCategory),
    ownerUserId: v.optional(v.id('users')),
    /** null makes the project company-wide. */
    locationId: v.optional(v.union(v.id('farmLocations'), v.null())),
    startDate: v.optional(v.string()),
    targetEndDate: v.optional(v.string()),
    budget: v.optional(v.number()),
    unitIds: v.optional(v.array(v.id('cages'))),
    notes: v.optional(v.string()),
    status: v.optional(projectStatus),
  },
  returns: v.id('projects'),
  handler: async (ctx, args) => {
    const m = await manager(ctx)
    const p = await loadProject(ctx, m, args.id)
    const next: Partial<Doc<'projects'>> = { updatedAt: Date.now() }
    if (args.name !== undefined) next.name = validName(args.name)
    if (args.category !== undefined) next.category = args.category
    if (args.status !== undefined) next.status = args.status
    if (args.ownerUserId !== undefined) next.ownerUserId = await validOwner(ctx, m, args.ownerUserId)
    if (args.locationId !== undefined) next.locationId = await validSite(ctx, m, args.locationId ?? undefined)
    const startDate = args.startDate !== undefined ? validDate(args.startDate, 'Start date') : p.startDate
    const targetEndDate = args.targetEndDate !== undefined ? validDate(args.targetEndDate, 'Target end') : p.targetEndDate
    if (targetEndDate < startDate) fail('The target end is before the start')
    next.startDate = startDate
    next.targetEndDate = targetEndDate
    if (args.budget !== undefined) {
      next.budget = validAmount(args.budget, 'Budget', true)
      next.overBudget = next.budget > 0 && p.spent > next.budget
    }
    const site = 'locationId' in next ? next.locationId : p.locationId
    if (args.unitIds !== undefined) next.unitIds = await validUnits(ctx, m, args.unitIds, site)
    if (args.notes !== undefined) next.notes = cleanText(args.notes, L.note)
    await ctx.db.patch(p._id, next)
    if ('locationId' in next && next.locationId !== p.locationId) {
      const ms = await ctx.db
        .query('projectMilestones')
        .withIndex('by_projectId_and_dueDate', (q) => q.eq('projectId', p._id))
        .take(L.milestonesPerProject + 1)
      for (const row of ms) await ctx.db.patch(row._id, { locationId: next.locationId })
    }
    await logAudit(ctx, { actionType: 'update', tableName: 'projects', recordId: p._id, previousValues: p, newValues: next, locationId: site })
    return p._id
  },
})

export const remove = mutation({
  args: { id: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeProjectAs(ctx, await manager(ctx), args.id)
    return null
  },
})

export const addMilestone = mutation({
  args: { projectId: v.id('projects'), title: v.string(), dueDate: v.string(), progressPct: v.optional(v.number()) },
  returns: v.id('projectMilestones'),
  handler: async (ctx, { projectId, ...input }) => addMilestoneAs(ctx, await manager(ctx), projectId, input),
})

export const updateMilestone = mutation({
  args: {
    id: v.id('projectMilestones'),
    title: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    progressPct: v.optional(v.number()),
    /** Farm date the milestone was done; marks it done (progress 100). */
    doneDate: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.id('projectMilestones'),
  handler: async (ctx, args) => {
    const m = await manager(ctx)
    const ms = await ctx.db.get(args.id)
    if (!ms || ms.companyId !== m.companyId) return notFound('Milestone')
    const p = await loadProject(ctx, m, ms.projectId)
    const next: Partial<Doc<'projectMilestones'>> = { updatedAt: Date.now() }
    if (args.title !== undefined) {
      const title = cleanText(args.title, L.milestoneTitle)
      if (!title) fail('Milestone title is required')
      next.title = title
    }
    if (args.dueDate !== undefined) next.dueDate = validDate(args.dueDate, 'Due date')
    if (args.progressPct !== undefined) next.progressPct = clampProgress(args.progressPct)
    if (args.doneDate) {
      next.doneDate = validDate(args.doneDate, 'Done date')
      next.doneAt = Date.now()
      next.progressPct = 100
      next.open = false
    } else if (args.doneDate === null || (next.progressPct !== undefined && next.progressPct < 100 && !ms.open)) {
      next.doneDate = undefined
      next.doneAt = undefined
      next.open = true
      if (next.progressPct === undefined || next.progressPct >= 100) next.progressPct = Math.min(ms.progressPct, 90)
    } else if (next.progressPct === 100 && ms.open) {
      next.open = false
      next.doneAt = Date.now()
      next.doneDate = next.dueDate ?? ms.dueDate
    }
    await ctx.db.patch(ms._id, next)
    await refreshMilestones(ctx, ms.projectId)
    await logAudit(ctx, { actionType: 'update', tableName: 'projectMilestones', recordId: ms._id, previousValues: ms, newValues: next, locationId: p.locationId })
    return ms._id
  },
})

export const removeMilestone = mutation({
  args: { id: v.id('projectMilestones') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeMilestoneAs(ctx, await manager(ctx), args.id)
    return null
  },
})

export const addCost = mutation({
  args: {
    projectId: v.id('projects'),
    amount: v.optional(v.number()),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
    expenseId: v.optional(v.id('expenses')),
    purchaseOrderId: v.optional(v.id('purchaseOrders')),
  },
  returns: v.id('projectCosts'),
  handler: async (ctx, { projectId, ...input }) => {
    const m = await manager(ctx)
    // Linking reads the expense or order: the member must be able to see them.
    if (input.expenseId && !can(m, 'finance.view')) throw userError('FORBIDDEN', 'Insufficient permissions: finance.view', { permission: 'finance.view' })
    if (input.purchaseOrderId && !can(m, 'inventory.view')) throw userError('FORBIDDEN', 'Insufficient permissions: inventory.view', { permission: 'inventory.view' })
    return await addCostAs(ctx, m, projectId, input)
  },
})

export const removeCost = mutation({
  args: { id: v.id('projectCosts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeCostAs(ctx, await manager(ctx), args.id)
    return null
  },
})
