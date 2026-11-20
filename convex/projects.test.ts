/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { mockModel } from '@convex-dev/agent'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { testHooks } from './bot/agent'

const modules = import.meta.glob('./**/*.ts')
const TODAY = '2026-11-20'

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-11-20T08:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  testHooks.languageModel = null
})

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River', code: 'RIVER', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const north = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const south = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'South', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B site', active: true, updatedAt: now })
    const member = async (email: string, name: string, companyId: Id<'companies'>, roleKey: string, sites?: Id<'farmLocations'>[]) => {
      const id = await ctx.db.insert('users', { email, name, role: 'user', companyId })
      await ctx.db.insert('memberships', {
        userId: id, companyId, roleKey, allLocations: !sites, locationIds: sites, status: 'active', updatedAt: now,
      })
      return id
    }
    const owner = await member('owner@a.com', 'Kofi', companyA, 'owner')
    const manager = await member('mgr@a.com', 'Ama', companyA, 'manager')
    const northMgr = await member('north@a.com', 'Yaw', companyA, 'manager', [north])
    const staff = await member('staff@a.com', 'Kwame', companyA, 'field_staff')
    const ownerB = await member('owner@b.com', 'Esi', companyB, 'owner')
    const cageNorth = await ctx.db.insert('cages', {
      name: 'D-01', status: 'empty', currentCount: 0, initialCount: 0, companyId: companyA, locationId: north, updatedAt: now,
    } as never)
    const cageB = await ctx.db.insert('cages', {
      name: 'B-01', status: 'empty', currentCount: 0, initialCount: 0, companyId: companyB, locationId: siteB, updatedAt: now,
    } as never)
    return { companyA, companyB, north, south, siteB, owner, manager, northMgr, staff, ownerB, cageNorth, cageB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  const rows = async <T extends 'projects' | 'projectMilestones' | 'projectCosts' | 'auditLogs' | 'pendingBotActions'>(table: T) =>
    await t.run(async (ctx) => await ctx.db.query(table).collect())
  return { t, as, rows, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

const base = {
  name: 'Row D cage build',
  category: 'infrastructure' as const,
  startDate: '2026-10-05',
  targetEndDate: '2027-01-31',
  budget: 840_000,
}

async function project(s: S, extra: Record<string, unknown> = {}, who: Id<'users'> = s.owner) {
  return await s.as(who).mutation(api.projects.create, { ...base, locationId: s.north, ...extra })
}

const page = { numItems: 50, cursor: null }

describe('projects CRUD', () => {
  test('create, read, update, remove; every write is audited', async () => {
    const s = await setup()
    const id = await project(s, { unitIds: [s.cageNorth], ownerUserId: s.manager })
    const got = await s.as(s.owner).query(api.projects.get, { id, today: TODAY })
    expect(got.project).toMatchObject({
      name: 'Row D cage build', status: 'planned', ownerName: 'Ama', locationName: 'North', budget: 840000, spent: 0,
      budgetPct: 0, unitCount: 1, atRisk: false,
    })
    expect(got.units).toEqual([{ id: s.cageNorth, name: 'D-01' }])
    expect(got.canManage).toBe(true)

    await s.as(s.owner).mutation(api.projects.update, { id, status: 'active', name: '  Row D  build ', budget: 900_000 })
    const after = await s.as(s.owner).query(api.projects.get, { id, today: TODAY })
    expect(after.project).toMatchObject({ status: 'active', name: 'Row D build', budget: 900000 })

    await expect(
      s.as(s.owner).mutation(api.projects.update, { id, targetEndDate: '2026-01-01' }),
    ).rejects.toThrow(/before the start/)
    await expect(project(s, { name: '   ' })).rejects.toThrow(/name is required/)
    await expect(project(s, { budget: -1 })).rejects.toThrow(/Budget/)
    await expect(project(s, { unitIds: [s.cageB] })).rejects.toThrow(/Unit not found/)

    await s.as(s.owner).mutation(api.projects.remove, { id })
    expect(await s.rows('projects')).toHaveLength(0)
    const audits = (await s.rows('auditLogs')).filter((a) => a.tableName === 'projects').map((a) => a.actionType)
    expect(audits).toEqual(['create', 'update', 'delete'])
  })

  test('a project with costs cannot be deleted, only cancelled', async () => {
    const s = await setup()
    const id = await project(s)
    await s.as(s.owner).mutation(api.projects.addCost, { projectId: id, amount: 10, date: TODAY })
    await expect(s.as(s.owner).mutation(api.projects.remove, { id })).rejects.toThrow(/cancel it instead/)
  })
})

describe('milestones and costs', () => {
  test('milestone roll-up: progress, done count, next due and late flags', async () => {
    const s = await setup()
    const id = await project(s, { status: 'active' })
    const add = (title: string, dueDate: string, progressPct?: number) =>
      s.as(s.owner).mutation(api.projects.addMilestone, { projectId: id, title, dueDate, progressPct })
    await add('Site survey & permits', '2026-10-20', 100)
    const nets = await add('Nets & frames ordered', '2026-11-06')
    await add('Mooring install', '2026-11-28', 60)
    await add('First stocking', '2027-01-12')
    await s.as(s.owner).mutation(api.projects.updateMilestone, { id: nets, doneDate: '2026-11-06' })

    const got = await s.as(s.owner).query(api.projects.get, { id, today: TODAY })
    expect(got.project).toMatchObject({ milestonesTotal: 4, milestonesDone: 2, progressPct: Math.round((100 + 100 + 60 + 0) / 4), nextDueDate: '2026-11-28' })
    expect(got.project.lateMilestone).toBe(false)
    expect(got.milestones.map((m) => [m.title, m.done, m.late])).toEqual([
      ['Site survey & permits', true, false],
      ['Nets & frames ordered', true, false],
      ['Mooring install', false, false],
      ['First stocking', false, false],
    ])
    // Reopening a milestone makes it count as open again.
    await s.as(s.owner).mutation(api.projects.updateMilestone, { id: nets, doneDate: null })
    const reopened = await s.as(s.owner).query(api.projects.get, { id, today: TODAY })
    expect(reopened.project).toMatchObject({ milestonesDone: 1, nextDueDate: '2026-11-06', lateMilestone: true, atRisk: true })
  })

  test('cost totals, budget % and over budget', async () => {
    const s = await setup()
    const id = await project(s, { name: 'Solar aeration', budget: 60_000, status: 'active' })
    await s.as(s.owner).mutation(api.projects.addCost, { projectId: id, amount: 50_000, date: '2026-11-01', note: 'Panels' })
    let p = (await s.as(s.owner).query(api.projects.get, { id, today: TODAY })).project
    expect(p).toMatchObject({ spent: 50000, budgetPct: 83, overBudget: false })
    const c2 = await s.as(s.owner).mutation(api.projects.addCost, { projectId: id, amount: 24_000, date: '2026-11-10' })
    p = (await s.as(s.owner).query(api.projects.get, { id, today: TODAY })).project
    expect(p).toMatchObject({ spent: 74000, budgetPct: 123, overBudget: true, atRisk: true })

    const sum = await s.as(s.owner).query(api.projects.summary, { today: TODAY })
    expect(sum.overBudget).toEqual([{ id, name: 'Solar aeration', spent: 74000, budget: 60000, currency: expect.any(String) }])

    await s.as(s.owner).mutation(api.projects.removeCost, { id: c2 })
    p = (await s.as(s.owner).query(api.projects.get, { id, today: TODAY })).project
    expect(p).toMatchObject({ spent: 50000, overBudget: false })

    const costs = await s.as(s.owner).query(api.projects.listCosts, { projectId: id, paginationOpts: page })
    expect(costs.page.map((c) => [c.amount, c.source, c.note])).toEqual([[50000, 'manual', 'Panels']])
    await expect(s.as(s.owner).mutation(api.projects.addCost, { projectId: id, amount: 0, date: TODAY })).rejects.toThrow(/greater than zero/)
    await expect(s.as(s.owner).mutation(api.projects.addCost, { projectId: id, date: TODAY })).rejects.toThrow(/Enter an amount/)
  })

  test('linking an expense counts it once, follows edits and drops on delete', async () => {
    const s = await setup()
    const id = await project(s)
    const other = await project(s, { name: 'Feed store roof' })
    const expenseId = await s.as(s.owner).mutation(api.expenses.create, {
      category: 'equipment', amount: 12_500, date: '2026-11-12', locationId: s.north, notes: 'Mooring blocks',
    })
    const linkable = await s.as(s.owner).query(api.projects.linkable, { projectId: id })
    expect(linkable.expenses.map((e) => e.id)).toContain(expenseId)

    const cost = await s.as(s.owner).mutation(api.projects.addCost, { projectId: id, expenseId })
    expect((await s.as(s.owner).query(api.projects.get, { id, today: TODAY })).project.spent).toBe(12500)
    // Same expense again, on this or another project: refused.
    await expect(s.as(s.owner).mutation(api.projects.addCost, { projectId: id, expenseId })).rejects.toThrow(/already counts/)
    await expect(s.as(s.owner).mutation(api.projects.addCost, { projectId: other, expenseId })).rejects.toThrow(/already counts/)
    // An amount alongside a link is refused (the link sets the amount).
    await expect(s.as(s.owner).mutation(api.projects.addCost, { projectId: other, expenseId, amount: 1 })).rejects.toThrow(/Enter an amount/)
    expect((await s.as(s.owner).query(api.projects.linkable, { projectId: other })).expenses.map((e) => e.id)).not.toContain(expenseId)

    await s.as(s.owner).mutation(api.expenses.update, { id: expenseId, amount: 13_000 })
    expect((await s.as(s.owner).query(api.projects.get, { id, today: TODAY })).project.spent).toBe(13000)
    const listed = await s.as(s.owner).query(api.projects.listCosts, { projectId: id, paginationOpts: page })
    expect(listed.page[0]).toMatchObject({ id: cost, amount: 13000, source: 'expense' })

    await s.as(s.owner).mutation(api.expenses.remove, { id: expenseId })
    expect((await s.as(s.owner).query(api.projects.get, { id, today: TODAY })).project.spent).toBe(0)
    expect(await s.rows('projectCosts')).toHaveLength(0)
  })
})

describe('permissions, site scope and tenancy', () => {
  test('projects.manage: owner and manager write; field staff only read', async () => {
    const s = await setup()
    const id = await project(s, {}, s.manager)
    const seen = await s.as(s.staff).query(api.projects.get, { id, today: TODAY })
    expect(seen.canManage).toBe(false)
    await expect(project(s, {}, s.staff)).rejects.toThrow(/projects.manage/)
    await expect(s.as(s.staff).mutation(api.projects.addCost, { projectId: id, amount: 5, date: TODAY })).rejects.toThrow(/projects.manage/)
    await expect(
      s.as(s.staff).mutation(api.projects.addMilestone, { projectId: id, title: 'x', dueDate: TODAY }),
    ).rejects.toThrow(/projects.manage/)
  })

  test('site scope: a north-only manager sees north and company-wide projects, never south', async () => {
    const s = await setup()
    const northP = await project(s, { name: 'North nets' })
    const southP = await project(s, { name: 'South pond liner', locationId: s.south })
    const companyP = await project(s, { name: 'ASC certification', locationId: undefined })
    const listed = await s.as(s.northMgr).query(api.projects.list, { paginationOpts: page, today: TODAY })
    expect(listed.page.map((p) => p.id).sort()).toEqual([northP, companyP].sort())
    await expect(s.as(s.northMgr).query(api.projects.get, { id: southP, today: TODAY })).rejects.toThrow(/Project not found/)
    await expect(s.as(s.northMgr).mutation(api.projects.addCost, { projectId: southP, amount: 1, date: TODAY })).rejects.toThrow(/not found/)
    await expect(project(s, { locationId: s.south }, s.northMgr)).rejects.toThrow(/do not have access/)
    // Limited members must pick one of their sites.
    await expect(project(s, { locationId: undefined }, s.northMgr)).rejects.toThrow(/Pick one of your sites/)
    await expect(
      s.as(s.northMgr).query(api.projects.list, { paginationOpts: page, today: TODAY, locationId: s.south }),
    ).rejects.toThrow(/do not have access/)
  })

  test('cross-tenant: another organization cannot read, write or link', async () => {
    const s = await setup()
    const id = await project(s)
    const expenseB = await s.as(s.ownerB).mutation(api.expenses.create, { category: 'equipment', amount: 99, date: TODAY })
    await expect(s.as(s.ownerB).query(api.projects.get, { id, today: TODAY })).rejects.toThrow(/Project not found/)
    await expect(s.as(s.ownerB).mutation(api.projects.update, { id, name: 'Hijack' })).rejects.toThrow(/Project not found/)
    await expect(s.as(s.ownerB).mutation(api.projects.remove, { id })).rejects.toThrow(/Project not found/)
    expect((await s.as(s.ownerB).query(api.projects.list, { paginationOpts: page, today: TODAY })).page).toEqual([])
    // A's project cannot take B's expense, and B's site cannot host A's project.
    await expect(s.as(s.owner).mutation(api.projects.addCost, { projectId: id, expenseId: expenseB })).rejects.toThrow(/Expense not found/)
    await expect(project(s, { locationId: s.siteB })).rejects.toThrow(/Site not found/)
    await expect(project(s, { ownerUserId: s.ownerB })).rejects.toThrow(/active member/)
  })
})

describe('lists at scale', () => {
  test('pagination is bounded and filters use indexes', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 130; i++) {
        await ctx.db.insert('projects', {
          companyId: s.companyA, locationId: i % 2 ? s.north : s.south, name: `Project ${i}`, category: 'other',
          ownerUserId: i % 3 ? s.owner : s.manager, startDate: '2026-11-01', targetEndDate: `2027-0${(i % 9) + 1}-01`,
          budget: 100, currency: 'GHS', status: i % 4 ? 'active' : 'done', spent: i % 10 === 0 ? 150 : 10,
          overBudget: i % 10 === 0, milestonesTotal: 0, milestonesDone: 0, progressPct: 0, createdBy: s.owner, updatedAt: 0,
        })
      }
    })
    await expect(
      s.as(s.owner).query(api.projects.list, { paginationOpts: { numItems: 101, cursor: null }, today: TODAY }),
    ).rejects.toThrow(/At most 100/)
    const first = await s.as(s.owner).query(api.projects.list, { paginationOpts: { numItems: 100, cursor: null }, today: TODAY })
    expect(first.page.length).toBe(100)
    expect(first.isDone).toBe(false)
    const second = await s.as(s.owner).query(api.projects.list, { paginationOpts: { numItems: 100, cursor: first.continueCursor }, today: TODAY })
    expect(first.page.length + second.page.length).toBe(130)
    // Ordered by target end.
    const ends = first.page.map((p) => p.targetEndDate)
    expect([...ends].sort()).toEqual(ends)

    const atRisk = await s.as(s.owner).query(api.projects.list, { paginationOpts: { numItems: 100, cursor: null }, today: TODAY, atRisk: true })
    expect(atRisk.page.every((p) => p.atRisk && p.status !== 'done')).toBe(true)
    expect(atRisk.page.length).toBeGreaterThan(0)
    const owned = await s.as(s.owner).query(api.projects.list, { paginationOpts: page, today: TODAY, ownerUserId: s.manager, status: 'active' })
    expect(owned.page.every((p) => p.ownerUserId === s.manager && p.status === 'active')).toBe(true)
    const found = await s.as(s.owner).query(api.projects.list, { paginationOpts: page, today: TODAY, search: 'Project 7' })
    expect(found.page.some((p) => p.name === 'Project 7')).toBe(true)
    // North-only manager never sees south rows, even across pages.
    const north = await s.as(s.northMgr).query(api.projects.list, { paginationOpts: { numItems: 100, cursor: null }, today: TODAY })
    expect(north.page.every((p) => p.locationId === s.north)).toBe(true)
  })
})

describe('Ask Anowa and projects', () => {
  function toolCall(toolName: string, input: Record<string, unknown>, id = 'c1') {
    return { type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }
  }

  test('proposals never write before confirm; confirm writes once; undo removes', async () => {
    const s = await setup()
    const id = await project(s, { status: 'active' })
    testHooks.languageModel = mockModel({
      contentSteps: [
        [
          toolCall('proposeProject', { name: 'Feed store roof', budget: 45000, targetEndDate: '2027-03-01', site: 'North' }, 'c1'),
          toolCall('proposeMilestone', { project: 'Row D', title: 'Mooring install', dueDate: '2026-11-28', progressPct: 60 }, 'c2'),
          toolCall('proposeProjectCost', { project: 'row d cage build', amount: 12000, note: 'Ropes' }, 'c3'),
        ],
        [{ type: 'text', text: 'Three changes are ready. Nothing is saved until you confirm.' }],
      ],
    })
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Set up the roof project and log Row D', lang: 'en' })
    if (!res.ok) throw new Error(`ask failed: ${res.code}`)
    expect(res.draftGroup).toBeTruthy()
    // Nothing written yet.
    expect(await s.rows('projects')).toHaveLength(1)
    expect(await s.rows('projectMilestones')).toHaveLength(0)
    expect(await s.rows('projectCosts')).toHaveLength(0)

    const card = await s.as(s.owner).query(api.anowa.drafts.get, { draftGroup: res.draftGroup! })
    expect(card?.items.map((i) => i.payload.kind)).toEqual(['project_create', 'project_milestone', 'project_cost'])
    expect(card?.items.every((i) => i.problem === null)).toBe(true)
    expect(card?.items[2].payload).toMatchObject({ kind: 'project_cost', projectId: id, amount: 12000, spentBefore: 0 })

    const saved = await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: res.draftGroup! })
    expect(saved).toMatchObject({ status: 'saved', saved: 3 })
    expect(await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: res.draftGroup! })).toEqual({ status: 'already' })
    expect(await s.rows('projects')).toHaveLength(2)
    const row = (await s.as(s.owner).query(api.projects.get, { id, today: TODAY })).project
    expect(row).toMatchObject({ spent: 12000, milestonesTotal: 1, nextDueDate: '2026-11-28' })
    const viaAnowa = (await s.rows('auditLogs')).filter((a) => a.tableName.startsWith('project') && a.channel === 'anowa')
    expect(viaAnowa.length).toBe(3)

    const undone = await s.as(s.owner).mutation(api.anowa.drafts.undo, { draftGroup: res.draftGroup! })
    expect(undone).toEqual({ status: 'undone', count: 3 })
    expect(await s.rows('projects')).toHaveLength(1)
    expect(await s.rows('projectCosts')).toHaveLength(0)
    expect(await s.rows('projectMilestones')).toHaveLength(0)
  })

  test('a role without projects.manage gets a greyed item and nothing is written', async () => {
    const s = await setup()
    await project(s)
    await s.t.run(async (ctx) => {
      const role = await ctx.db.insert('roles', {
        companyId: s.companyA, key: 'clerk', name: 'Clerk', archived: false, updatedAt: 0,
        permissions: ['org.view', 'ai.use', 'projects.view'],
      })
      const m = await ctx.db
        .query('memberships')
        .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', s.companyA).eq('userId', s.staff))
        .unique()
      await ctx.db.patch(m!._id, { roleKey: 'clerk', roleId: role })
    })
    testHooks.languageModel = mockModel({
      contentSteps: [
        [toolCall('proposeProjectCost', { project: 'Row D', amount: 500 })],
        [{ type: 'text', text: 'Drafted.' }],
      ],
    })
    const res = await s.as(s.staff).action(api.anowa.agent.ask, { question: 'log 500 on Row D', lang: 'en' })
    if (!res.ok) throw new Error('ask failed')
    const card = await s.as(s.staff).query(api.anowa.drafts.get, { draftGroup: res.draftGroup! })
    expect(card?.items[0].problem).toMatch(/cannot log project costs/)
    expect(await s.as(s.staff).mutation(api.anowa.drafts.confirm, { draftGroup: res.draftGroup! })).toEqual({ status: 'nothing_allowed' })
    expect(await s.rows('projectCosts')).toHaveLength(0)
  })

  test('read tools answer from the records the member can see', async () => {
    const s = await setup()
    const id = await project(s, { name: 'Solar aeration', budget: 60000, status: 'active' })
    await s.as(s.owner).mutation(api.projects.addCost, { projectId: id, amount: 73800, date: '2026-11-02' })
    await project(s, { name: 'South liner', locationId: s.south, status: 'active' })
    const now = Date.now()
    const overview = await s.as(s.northMgr).query(internal.anowa.projects.read, { tool: 'projects_overview', now })
    expect(overview).toMatchObject({ ok: true })
    if (overview.ok) {
      expect(overview.data).toMatch(/Solar aeration .*23% over/)
      expect(overview.data).not.toMatch(/South liner/)
    }
    const detail = await s.as(s.northMgr).query(internal.anowa.projects.read, { tool: 'project_detail', project: 'solar', now })
    expect(detail.ok && detail.data).toMatch(/Budget .*60,000, spent .*73,800 \(123%\)/)
    // A project outside the member's sites is "not found", not described.
    const hidden = await s.as(s.northMgr).query(internal.anowa.projects.read, { tool: 'project_detail', project: 'South liner', now })
    expect(hidden).toMatchObject({ ok: false })
    // Another organization sees none of it.
    const other = await s.as(s.ownerB).query(internal.anowa.projects.read, { tool: 'project_detail', project: 'Solar aeration', now })
    expect(other).toMatchObject({ ok: false })
  })
})
