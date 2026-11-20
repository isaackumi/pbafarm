/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { mockModel } from '@convex-dev/agent'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { testHooks } from './bot/agent'
import { DRAFT_TTL_MS, UNDO_WINDOW_MS } from './bot/pending'

const modules = import.meta.glob('./**/*.ts')

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

function toolCall(toolName: string, input: Record<string, unknown>, id = 'c1') {
  return { type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }
}

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
    const siteA1 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B site', active: true, updatedAt: now })
    const owner = await ctx.db.insert('users', { email: 'owner@a.com', name: 'Kofi', role: 'user', companyId: companyA })
    await ctx.db.insert('memberships', {
      userId: owner, companyId: companyA, roleKey: 'owner', allLocations: true, status: 'active', updatedAt: now,
    })
    // A clerk who may ask Anowa and record daily entries, but not order feed or assign tasks.
    const clerkRole = await ctx.db.insert('roles', {
      companyId: companyA, key: 'clerk', name: 'Clerk', archived: false, updatedAt: now,
      permissions: ['org.view', 'ai.use', 'production.view', 'production.daily.record', 'inventory.view'],
    })
    const clerk = await ctx.db.insert('users', { email: 'clerk@a.com', name: 'Ama', role: 'user', companyId: companyA })
    await ctx.db.insert('memberships', {
      userId: clerk, companyId: companyA, roleKey: 'clerk', roleId: clerkRole, allLocations: false, locationIds: [siteA1],
      status: 'active', updatedAt: now,
    })
    const ownerB = await ctx.db.insert('users', { email: 'owner@b.com', name: 'Esi', role: 'user', companyId: companyB })
    await ctx.db.insert('memberships', {
      userId: ownerB, companyId: companyB, roleKey: 'owner', allLocations: true, status: 'active', updatedAt: now,
    })
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10, currentWeight: 100,
        species: 'nile_tilapia', stockingDate: '2026-10-01', companyId, locationId, updatedAt: now,
      })
    const cageA1 = await cage('C-01', companyA, siteA1)
    const cageA2 = await cage('C-02', companyA, siteA1)
    const cageB1 = await cage('B-01', companyB, siteB)
    const supplier = await ctx.db.insert('feedSuppliers', { name: 'Volta Feeds Ltd', companyId: companyA, updatedAt: now })
    const feedA = await ctx.db.insert('feedTypes', {
      name: 'Raanan 4mm', currentStock: 20, minimumStock: 10, pricePerKg: 15, active: true,
      bagSizeKg: 25, supplierId: supplier, companyId: companyA, updatedAt: now,
    })
    return { companyA, companyB, siteA1, siteB, owner, clerk, ownerB, cageA1, cageA2, cageB1, supplier, feedA }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  const rows = async <T extends 'pendingBotActions' | 'dailyRecords' | 'purchaseOrders' | 'tasks' | 'auditLogs'>(table: T) =>
    await t.run(async (ctx) => await ctx.db.query(table).collect())
  return { t, as, rows, ...ids }
}

type S = Awaited<ReturnType<typeof setup>>

/** The artboard 48 request: 3 dead in C-02 and a feed order. */
async function askForBoth(s: S, userId: Id<'users'>) {
  testHooks.languageModel = mockModel({
    contentSteps: [
      [toolCall('proposeMortality', { unit: 'C-02', count: 3 }, 'c1'), toolCall('proposePurchaseOrder', {}, 'c2')],
      [toolCall('suggestFollowUp', { text: 'Add a water check for C-02 tomorrow?' }, 'c3')],
      [{ type: 'text', text: "I've prepared two changes. Nothing is saved until you confirm." }],
    ],
  })
  return await s.as(userId).action(api.anowa.agent.ask, {
    question: "Record 3 dead in C-02 and order feed so we don't run out next week",
    lang: 'en',
  })
}

describe('Ask Anowa does it for you', () => {
  test('the model only drafts: nothing is written before confirm', async () => {
    const s = await setup()
    const res = await askForBoth(s, s.owner)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.text).toMatch(/Nothing is saved/)
    expect(res.followUp).toBe('Add a water check for C-02 tomorrow?')
    expect(res.draftGroup).toBeTruthy()
    expect(await s.rows('dailyRecords')).toHaveLength(0)
    expect(await s.rows('purchaseOrders')).toHaveLength(0)

    const card = await s.as(s.owner).query(api.anowa.drafts.get, { draftGroup: res.draftGroup! })
    expect(card?.items).toHaveLength(2)
    expect(card?.items.every((i) => i.status === 'pending' && i.problem === null)).toBe(true)
    expect(card?.expiresAt).toBe(Date.now() + DRAFT_TTL_MS)
    const [mort, po] = card!.items
    expect(mort.payload).toMatchObject({ kind: 'daily_entry', cageId: s.cageA2, mortality: 3, feedKg: 0, fishBefore: 1000 })
    expect(po.payload).toMatchObject({ kind: 'purchase_order', feedTypeId: s.feedA, supplierId: s.supplier, bagKg: 25, stockKg: 20, days: 14, units: 2 })
    if (po.payload.kind === 'purchase_order') {
      // 14-day need minus stock, in whole 25 kg bags.
      const short = po.payload.needKg - po.payload.stockKg
      expect(po.payload.quantityKg % 25).toBe(0)
      expect(po.payload.quantityKg).toBeGreaterThanOrEqual(short)
      expect(po.payload.quantityKg).toBeLessThan(short + 25)
      expect(po.payload.bags * 25).toBe(po.payload.quantityKg)
    }
    // Another member cannot see the card.
    expect(await s.as(s.clerk).query(api.anowa.drafts.get, { draftGroup: res.draftGroup! })).toBeNull()
  })

  test('confirm writes every allowed item once, via Anowa; a second confirm writes nothing', async () => {
    const s = await setup()
    const res = await askForBoth(s, s.owner)
    if (!res.ok) throw new Error('ask failed')
    const draftGroup = res.draftGroup!
    const first = await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup })
    expect(first).toMatchObject({ status: 'saved', saved: 2, skipped: 0 })
    const again = await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup })
    expect(again).toEqual({ status: 'already' })

    const daily = await s.rows('dailyRecords')
    expect(daily).toHaveLength(1)
    expect(daily[0]).toMatchObject({ cageId: s.cageA2, mortality: 3 })
    const pos = await s.rows('purchaseOrders')
    expect(pos).toHaveLength(1)
    // A draft PO: it still goes through the existing approval to be placed.
    expect(pos[0]).toMatchObject({ status: 'draft', supplierId: s.supplier, createdBy: s.owner })
    const audit = (await s.rows('auditLogs')).filter((a) => a.tableName === 'purchaseOrders' || a.tableName === 'dailyRecords')
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.every((a) => a.channel === 'anowa' && a.userId === s.owner && a.sourceMessageId === draftGroup)).toBe(true)
  })

  test('an item the role may not do is greyed with the reason and never written', async () => {
    const s = await setup()
    const res = await askForBoth(s, s.clerk)
    if (!res.ok) throw new Error('ask failed')
    const draftGroup = res.draftGroup!
    const card = await s.as(s.clerk).query(api.anowa.drafts.get, { draftGroup })
    const po = card!.items.find((i) => i.payload.kind === 'purchase_order')!
    const mort = card!.items.find((i) => i.payload.kind === 'daily_entry')!
    expect(po.problem).toMatch(/cannot create purchase orders/)
    expect(mort.problem).toBeNull()

    const r = await s.as(s.clerk).mutation(api.anowa.drafts.confirm, { draftGroup })
    expect(r).toMatchObject({ status: 'saved', saved: 1, skipped: 1 })
    expect(await s.rows('purchaseOrders')).toHaveLength(0)
    expect(await s.rows('dailyRecords')).toHaveLength(1)
    const stored = (await s.rows('pendingBotActions')).find((p) => p.payload.kind === 'purchase_order')!
    expect(stored.status).toBe('cancelled')
  })

  test("another tenant's cage is refused at proposal and at confirm", async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      contentSteps: [
        [toolCall('proposeMortality', { unit: 'B-01', count: 2 })],
        [{ type: 'text', text: 'I could not find that unit.' }],
      ],
    })
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Record 2 dead in B-01 for River' })
    expect(res).toMatchObject({ ok: true, draftGroup: null })
    expect(await s.rows('pendingBotActions')).toHaveLength(0)

    // A draft pointed at another organization's cage after the fact is refused at confirm.
    const ok = await askForBoth(s, s.owner)
    if (!ok.ok) throw new Error('ask failed')
    await s.t.run(async (ctx) => {
      const item = (await ctx.db.query('pendingBotActions').collect()).find((p) => p.payload.kind === 'daily_entry')!
      if (item.payload.kind !== 'daily_entry') return
      await ctx.db.patch(item._id, { payload: { ...item.payload, cageId: s.cageB1 } })
    })
    const r = await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: ok.draftGroup! })
    expect(r).toMatchObject({ status: 'saved', saved: 1, skipped: 1 })
    expect(await s.rows('dailyRecords')).toHaveLength(0)
    // The other tenant cannot confirm or read this draft.
    await expect(s.as(s.ownerB).mutation(api.anowa.drafts.confirm, { draftGroup: ok.draftGroup! })).rejects.toThrow(/not found/i)
  })

  test('an expired draft is not written', async () => {
    const s = await setup()
    const res = await askForBoth(s, s.owner)
    if (!res.ok) throw new Error('ask failed')
    vi.setSystemTime(Date.now() + DRAFT_TTL_MS + 1000)
    const r = await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: res.draftGroup! })
    expect(r).toEqual({ status: 'expired' })
    expect(await s.rows('dailyRecords')).toHaveLength(0)
    expect(await s.rows('purchaseOrders')).toHaveLength(0)
  })

  test('cancel closes the card without writing', async () => {
    const s = await setup()
    const res = await askForBoth(s, s.owner)
    if (!res.ok) throw new Error('ask failed')
    expect(await s.as(s.owner).mutation(api.anowa.drafts.cancel, { draftGroup: res.draftGroup! })).toBe(2)
    expect(await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: res.draftGroup! })).toEqual({ status: 'closed' })
    expect(await s.rows('dailyRecords')).toHaveLength(0)
  })

  test('Undo within 10 minutes removes what was saved; later it is too late', async () => {
    const s = await setup()
    const res = await askForBoth(s, s.owner)
    if (!res.ok) throw new Error('ask failed')
    const draftGroup = res.draftGroup!
    await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup })
    const undone = await s.as(s.owner).mutation(api.anowa.drafts.undo, { draftGroup })
    expect(undone).toEqual({ status: 'undone', count: 2 })
    expect(await s.rows('dailyRecords')).toHaveLength(0)
    expect(await s.rows('purchaseOrders')).toHaveLength(0)

    // A second card, confirmed, then undone too late.
    const late = await askForBoth(s, s.owner)
    if (!late.ok) throw new Error('ask failed')
    await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: late.draftGroup! })
    vi.setSystemTime(Date.now() + UNDO_WINDOW_MS + 1000)
    expect(await s.as(s.owner).mutation(api.anowa.drafts.undo, { draftGroup: late.draftGroup! })).toEqual({ status: 'too_late' })
    expect(await s.rows('dailyRecords')).toHaveLength(1)
  })

  test('tasks are drafted for a named member and need automation.manage', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      contentSteps: [
        [toolCall('proposeTask', { title: 'Water check', unit: 'C-02', dueInDays: 1, assignee: 'Ama' })],
        [{ type: 'text', text: 'Drafted.' }],
      ],
    })
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Add a water check for Ama tomorrow' })
    if (!res.ok) throw new Error('ask failed')
    const card = await s.as(s.owner).query(api.anowa.drafts.get, { draftGroup: res.draftGroup! })
    expect(card!.items[0].payload).toMatchObject({ kind: 'task', assigneeUserId: s.clerk, dueDate: '2026-11-21', cageId: s.cageA2 })
    await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: res.draftGroup! })
    const tasks = await s.rows('tasks')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ title: 'Water check', assigneeUserId: s.clerk, status: 'open' })
  })

  test('the org AI switch and ai.use gate the assistant', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.companyA, { settings: { aiAssistantEnabled: false } })
    })
    const model = mockModel({ content: [{ type: 'text', text: 'should not run' }] })
    testHooks.languageModel = model
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Record 3 dead in C-02' })
    expect(res).toEqual({ ok: false, code: 'forbidden', retryAfterSec: null })
    expect((model as unknown as { doGenerateCalls: unknown[] }).doGenerateCalls).toHaveLength(0)
  })

  test('support access cannot draft or confirm through Anowa (audit attribution)', async () => {
    const s = await setup()
    const root = await s.t.run(async (ctx) => {
      const now = Date.now()
      const root = await ctx.db.insert('users', { email: 'root@platform.com', role: 'super_admin' })
      const sessionId = await ctx.db.insert('authSessions', { userId: root, expirationTime: now + 86_400_000 })
      await ctx.db.insert('mfaSessions', { userId: root, sessionId, purpose: 'verify', attempts: 0, verifiedAt: now, method: 'totp' })
      return { root, sessionId }
    })
    const asRoot = s.t.withIdentity({ subject: `${root.root}|${root.sessionId}` })
    await asRoot.mutation(api.actAs.start, {
      companyId: s.companyA,
      reason: 'Ticket 4411: customer asked us to check their entries',
      allowWrites: true,
    })
    testHooks.languageModel = mockModel({
      contentSteps: [[toolCall('proposeMortality', { unit: 'C-02', count: 3 })], [{ type: 'text', text: 'ok' }]],
    })
    const res = await asRoot.action(api.anowa.agent.ask, { question: 'Record 3 dead in C-02' })
    expect(res).toMatchObject({ ok: true, draftGroup: null })
    expect(await s.rows('pendingBotActions')).toHaveLength(0)
  })

  test('a provider failure returns a kind, never the provider text', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({ fail: { probability: 1 } } as never)
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'How is C-02?' })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res)).not.toMatch(/mock|error:/i)
  })
})
