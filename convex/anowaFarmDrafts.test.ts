/// <reference types="vite/client" />
/**
 * Ask Anowa farm drafts (convex/anowa/farmDrafts.ts): every confirm goes
 * through the form's own helper and refuses what the form refuses; approval
 * over chat keeps segregation of duties; tenant and site scope hold.
 */
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { mockModel } from '@convex-dev/agent'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { testHooks } from './bot/agent'
import { defaultDefinition } from './lib/reportCatalog'
import { DEFAULT_SETTINGS } from './lib/farmRules'

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

let groupSeq = 0
const newGroup = () => `group-${String(++groupSeq).padStart(4, '0')}-abcdefghijkl`

async function setup(settings: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now,
      settings: { aiAssistantEnabled: true, ...settings } as never,
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River', code: 'RIVER', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const north = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const south = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'South', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B site', active: true, updatedAt: now })
    const member = async (email: string, name: string, companyId: Id<'companies'>, roleKey: string, extra: Record<string, unknown> = {}) => {
      const id = await ctx.db.insert('users', { email, name, role: 'user', companyId })
      await ctx.db.insert('memberships', {
        userId: id, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now, ...extra,
      })
      return id
    }
    const owner = await member('owner@a.com', 'Kofi', companyA, 'owner')
    // Approvals are admin-only (permissionCatalog ADMIN_ONLY).
    const manager = await member('manager@a.com', 'Abena', companyA, 'admin')
    // Ask Anowa and daily records only, at North.
    const clerkRole = await ctx.db.insert('roles', {
      companyId: companyA, key: 'clerk', name: 'Clerk', archived: false, updatedAt: now,
      permissions: ['org.view', 'ai.use', 'production.view', 'production.daily.record'],
    })
    const clerk = await member('clerk@a.com', 'Ama', companyA, 'clerk', {
      roleId: clerkRole, allLocations: false, locationIds: [north],
    })
    // An admin limited to South.
    const southManager = await member('south@a.com', 'Yaw', companyA, 'admin', { allLocations: false, locationIds: [south] })
    const ownerB = await member('owner@b.com', 'Esi', companyB, 'owner')
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>, stocked = true) =>
      ctx.db.insert('cages', {
        name, status: stocked ? 'active' : 'empty', companyId, locationId, updatedAt: now,
        ...(stocked
          ? { currentCount: 1000, initialCount: 1000, initialAbw: 10, currentWeight: 250, species: 'nile_tilapia', stockingDate: '2026-08-01' }
          : {}),
      })
    const c1 = await cage('C-01', companyA, north)
    const c2 = await cage('C-02', companyA, north)
    const empty = await cage('C-09', companyA, north, false)
    const empty2 = await cage('C-10', companyA, north, false)
    const s1 = await cage('S-01', companyA, south)
    const b1 = await cage('B-01', companyB, siteB)
    const customer = await ctx.db.insert('customers', { name: 'Accra Fish Market', active: true, companyId: companyA, updatedAt: now })
    return { companyA, companyB, north, south, siteB, owner, manager, clerk, southManager, ownerB, c1, c2, empty, empty2, s1, b1, customer }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  const propose = (userId: Id<'users'>, input: Record<string, unknown>, draftGroup = newGroup()) =>
    as(userId).mutation(internal.anowa.drafts.propose, { draftGroup, input: input as never }).then((r) => ({ ...r, draftGroup }))
  const confirm = (userId: Id<'users'>, draftGroup: string) => as(userId).mutation(api.anowa.drafts.confirm, { draftGroup })
  const card = (userId: Id<'users'>, draftGroup: string) => as(userId).query(api.anowa.drafts.get, { draftGroup })
  return { t, as, propose, confirm, card, ...ids }
}

describe('Ask Anowa farm drafts confirm through the form helpers', () => {
  test('sampling: a bi-weekly record with the computed ABW, the cage weight follows; no Undo', async () => {
    const s = await setup()
    const r = await s.propose(s.owner, { kind: 'sampling', unit: 'C-01', fishCounted: 50, abwG: 312 })
    expect(r).toMatchObject({ ok: true, refused: null })
    expect(await s.t.run((ctx) => ctx.db.query('biweeklyRecords').collect())).toHaveLength(0)
    const res = await s.confirm(s.owner, r.draftGroup)
    expect(res).toMatchObject({ status: 'saved', saved: 1 })
    const rows = await s.t.run((ctx) => ctx.db.query('biweeklyRecords').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ cageId: s.c1, totalFishCount: 50, totalWeight: 15600, averageBodyWeight: 312 })
    expect((await s.t.run((ctx) => ctx.db.get(s.c1)))?.currentWeight).toBe(312)
    // Ledger records have no Undo.
    expect(await s.as(s.owner).mutation(api.anowa.drafts.undo, { draftGroup: r.draftGroup })).toEqual({ status: 'too_late' })
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(audit.some((a) => a.tableName === 'biweeklyRecords')).toBe(true)
  })

  test('a role without the form permission sees the item refused and nothing is written', async () => {
    const s = await setup()
    const r = await s.propose(s.clerk, { kind: 'sampling', unit: 'C-01', fishCounted: 50, abwG: 312 })
    expect(r).toMatchObject({ ok: true, refused: 'Your role cannot record sampling.' })
    expect(await s.confirm(s.clerk, r.draftGroup)).toEqual({ status: 'nothing_allowed' })
    expect(await s.t.run((ctx) => ctx.db.query('biweeklyRecords').collect())).toHaveLength(0)
  })

  test('water reading: a manual reading for the clerk (daily-record permission), breaches evaluated', async () => {
    const s = await setup()
    const bad = await s.propose(s.clerk, { kind: 'water_reading', unit: 'C-01', ph: 20 })
    expect(bad).toMatchObject({ ok: false })
    const r = await s.propose(s.clerk, { kind: 'water_reading', unit: 'C-01', dissolvedOxygen: 2.1, temperatureC: 29 })
    expect(r).toMatchObject({ ok: true, refused: null })
    expect(await s.confirm(s.clerk, r.draftGroup)).toMatchObject({ status: 'saved', saved: 1 })
    const rows = await s.t.run((ctx) => ctx.db.query('waterQualityReadings').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ unitId: s.c1, source: 'manual', dissolvedOxygen: 2.1, temperatureC: 29 })
    expect(rows[0].breachCount).toBeGreaterThan(0)
  })

  test('harvest with its lot; a withdrawal period refuses it exactly like the form', async () => {
    const s = await setup()
    const r = await s.propose(s.owner, { kind: 'harvest', unit: 'C-01', totalWeightKg: 100, abwG: 400, lotCode: 'lot-a1' })
    expect(r).toMatchObject({ ok: true })
    expect(await s.confirm(s.owner, r.draftGroup)).toMatchObject({ status: 'saved' })
    const harvests = await s.t.run((ctx) => ctx.db.query('harvestRecords').collect())
    expect(harvests).toHaveLength(1)
    expect(harvests[0]).toMatchObject({ cageId: s.c1, totalWeight: 100, averageBodyWeight: 400, estimatedCount: 250, harvestType: 'partial' })
    const lots = await s.t.run((ctx) => ctx.db.query('harvestLots').collect())
    expect(lots).toMatchObject([{ lotCode: 'LOT-A1', weightKg: 100, harvestId: harvests[0]._id }])

    await s.t.run(async (ctx) => {
      await ctx.db.insert('healthTreatments', {
        cageId: s.c2, date: '2026-11-15', treatment: 'Oxytetracycline', withdrawalDays: 30, withdrawalUntil: '2026-12-15',
        companyId: s.companyA, locationId: s.north, updatedAt: Date.now(),
      })
    })
    const blocked = await s.propose(s.owner, { kind: 'harvest', unit: 'C-02', totalWeightKg: 50, abwG: 250 })
    expect(blocked).toMatchObject({ ok: true })
    await expect(s.confirm(s.owner, blocked.draftGroup)).rejects.toThrow(/withdrawal period/)
    // Rolled back: still one harvest, the draft still pending.
    expect(await s.t.run((ctx) => ctx.db.query('harvestRecords').collect())).toHaveLength(1)
    expect((await s.card(s.owner, blocked.draftGroup))?.items[0].status).toBe('pending')
  })

  test('harvest refuses more fish than the unit holds', async () => {
    const s = await setup()
    expect(await s.propose(s.owner, { kind: 'harvest', unit: 'C-01', totalWeightKg: 100, count: 5000 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/more than the 1000/),
    })
  })

  test('stocking and transfer go to approval as usual', async () => {
    const s = await setup()
    const g = newGroup()
    expect(await s.propose(s.owner, { kind: 'stocking', unit: 'C-09', fishCount: 5000, abwG: 10 }, g)).toMatchObject({ ok: true })
    expect(await s.propose(s.owner, { kind: 'fish_transfer', fromUnit: 'C-01', toUnit: 'C-10', count: 200 }, g)).toMatchObject({ ok: true })
    expect(await s.confirm(s.owner, g)).toMatchObject({ status: 'saved', saved: 2 })
    const stockings = await s.t.run((ctx) => ctx.db.query('stockingHistory').collect())
    expect(stockings.find((x) => x.cageId === s.empty)).toMatchObject({ fishCount: 5000, status: 'pending_approval', createdBy: s.owner })
    const transfers = await s.t.run((ctx) => ctx.db.query('fishTransfers').collect())
    expect(transfers).toMatchObject([{ sourceCageId: s.c1, destinationCageId: s.empty2, quantity: 200, abw: 250, status: 'pending_approval' }])
    // Cages untouched until approval.
    expect((await s.t.run((ctx) => ctx.db.get(s.c1)))?.currentCount).toBe(1000)
    // Into a stocked cage with no approved stocking: the form's refusal, the card rolls back.
    const topup = await s.propose(s.owner, { kind: 'fish_transfer', fromUnit: 'C-01', toUnit: 'C-02', count: 100 })
    await expect(s.confirm(s.owner, topup.draftGroup)).rejects.toThrow(/no approved stocking/)
    expect(await s.t.run((ctx) => ctx.db.query('fishTransfers').collect())).toHaveLength(1)
  })

  test('transfer refuses more fish than the source holds', async () => {
    const s = await setup()
    expect(await s.propose(s.owner, { kind: 'fish_transfer', fromUnit: 'C-01', toUnit: 'C-02', count: 1001 })).toMatchObject({ ok: false })
  })

  test('sale with its invoice; the buyer is matched to a customer', async () => {
    const s = await setup()
    const r = await s.propose(s.owner, { kind: 'sale', customer: 'accra fish', weightKg: 80, pricePerKg: 35, unit: 'C-01', invoice: true, dueInDays: 14 })
    expect(r).toMatchObject({ ok: true })
    expect(await s.confirm(s.owner, r.draftGroup)).toMatchObject({ status: 'saved' })
    const sales = await s.t.run((ctx) => ctx.db.query('sales').collect())
    expect(sales).toMatchObject([{ customerId: s.customer, weightKg: 80, pricePerKg: 35, totalAmount: 2800, cageId: s.c1 }])
    const invoices = await s.t.run((ctx) => ctx.db.query('invoices').collect())
    expect(invoices).toMatchObject([{ saleId: sales[0]._id, number: 'INV-0001', amount: 2800, dueDate: '2026-12-04' }])
    expect(sales[0].invoiceId).toBe(invoices[0]._id)
  })

  test('report schedule from a saved report; recipients default to the user', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await ctx.db.insert('savedReports', {
        companyId: s.companyA, name: 'Weekly sales', visibility: 'company', definition: defaultDefinition('sales'),
        createdBy: s.owner, updatedAt: Date.now(),
      })
    })
    const r = await s.propose(s.owner, { kind: 'report_schedule', report: 'weekly sales', frequency: 'weekly', time: '07:00', weekday: 1 })
    expect(r).toMatchObject({ ok: true })
    expect(await s.confirm(s.owner, r.draftGroup)).toMatchObject({ status: 'saved' })
    const rows = await s.t.run((ctx) => ctx.db.query('reportSchedules').collect())
    expect(rows).toMatchObject([{ frequency: 'weekly', weekday: 1, localTime: '07:00', recipientIds: [s.owner], enabled: true }])
    expect(rows[0].nextRunAt).toBeGreaterThan(Date.now())
  })

  test('cycle plan saved with the species-default assumptions', async () => {
    const s = await setup()
    const r = await s.propose(s.owner, {
      kind: 'cycle_plan', name: 'Next cycle', units: ['C-09'], fishPerUnit: 5000, stockAbwG: 10, harvestAbwG: 400,
      salePricePerKg: 35, fingerlingPrice: 1, feedPricePerBag: 400,
    })
    expect(r).toMatchObject({ ok: true })
    expect(await s.confirm(s.owner, r.draftGroup)).toMatchObject({ status: 'saved' })
    const plans = await s.t.run((ctx) => ctx.db.query('cyclePlans').collect())
    expect(plans).toMatchObject([{ name: 'Next cycle', unitIds: [s.empty], inputs: { stockOn: '2026-11-20', bagKg: 25 } }])
  })
})

describe('approvals through Ask Anowa', () => {
  async function pendingStocking(s: Awaited<ReturnType<typeof setup>>, by: Id<'users'>, unit = 'C-09') {
    const r = await s.propose(by, { kind: 'stocking', unit, fishCount: 5000, abwG: 10 })
    await s.confirm(by, r.draftGroup)
    const all = await s.t.run((ctx) => ctx.db.query('stockingHistory').collect())
    return all[all.length - 1]
  }

  test('the requester cannot approve their own request when a different approver is required', async () => {
    const s = await setup({ stockingRules: { ...DEFAULT_SETTINGS.stockingRules, requireDifferentApprover: true } })
    const st = await pendingStocking(s, s.owner)
    const mine = await s.propose(s.owner, { kind: 'approval_decision', ref: st._id, decision: 'approve' })
    expect(mine).toMatchObject({ ok: true })
    const card = await s.card(s.owner, mine.draftGroup)
    expect(card?.items[0].problem).toMatch(/other than the requester/)
    expect(await s.confirm(s.owner, mine.draftGroup)).toEqual({ status: 'nothing_allowed' })
    expect((await s.t.run((ctx) => ctx.db.get(st._id)))?.status).toBe('pending_approval')

    // Another manager approves it: the same helper as the web, cage stocked.
    const other = await s.propose(s.manager, { kind: 'approval_decision', ref: st._id, decision: 'approve' })
    expect(await s.confirm(s.manager, other.draftGroup)).toMatchObject({ status: 'saved' })
    expect(await s.t.run((ctx) => ctx.db.get(st._id))).toMatchObject({ status: 'approved', approvedBy: s.manager })
    expect((await s.t.run((ctx) => ctx.db.get(s.empty)))?.currentCount).toBe(5000)
    // Decided: a second decision is refused at draft time.
    expect(await s.propose(s.manager, { kind: 'approval_decision', ref: st._id, decision: 'reject' })).toMatchObject({
      ok: false,
      error: 'That request has already been decided.',
    })
  })

  test('reject with a reason; the clerk may not decide; scope and tenant hold', async () => {
    const s = await setup()
    const st = await pendingStocking(s, s.owner)
    const clerk = await s.propose(s.clerk, { kind: 'approval_decision', ref: st._id, decision: 'approve' })
    expect(clerk).toMatchObject({ ok: true, refused: 'Your role cannot approve this request.' })
    // A manager limited to South cannot reach a North request.
    expect(await s.propose(s.southManager, { kind: 'approval_decision', ref: st._id, decision: 'approve' })).toMatchObject({
      ok: false,
      error: 'That site is not in your access.',
    })
    // Another organization's owner gets "not found".
    expect(await s.propose(s.ownerB, { kind: 'approval_decision', ref: st._id, decision: 'approve' })).toMatchObject({
      ok: false,
      error: 'That request was not found.',
    })
    expect(await s.propose(s.owner, { kind: 'approval_decision', ref: 'not-an-id', decision: 'approve' })).toMatchObject({ ok: false })

    const r = await s.propose(s.manager, { kind: 'approval_decision', ref: st._id, decision: 'reject', reason: 'Wrong cage' })
    expect((await s.card(s.manager, r.draftGroup))?.items[0].problem).toBeNull()
    expect(await s.confirm(s.manager, r.draftGroup)).toMatchObject({ status: 'saved' })
    const after = await s.t.run((ctx) => ctx.db.get(st._id))
    expect(after?.status).toBe('rejected')
    expect(after?.notes).toMatch(/Wrong cage/)
  })
})

describe('scope and tenant isolation of farm drafts', () => {
  test('units of another site or organization are never matched', async () => {
    const s = await setup()
    expect(await s.propose(s.clerk, { kind: 'water_reading', unit: 'S-01', dissolvedOxygen: 5 })).toMatchObject({ ok: false })
    expect(await s.propose(s.owner, { kind: 'sampling', unit: 'B-01', fishCounted: 10, abwG: 100 })).toMatchObject({ ok: false })
    expect(await s.propose(s.ownerB, { kind: 'harvest', unit: 'C-01', totalWeightKg: 10, abwG: 300 })).toMatchObject({ ok: false })
  })

  test('a site removed from the member after drafting greys the item out at confirm', async () => {
    const s = await setup()
    const r = await s.propose(s.manager, { kind: 'sampling', unit: 'C-01', fishCounted: 20, abwG: 300 })
    await s.t.run(async (ctx) => {
      const m = await ctx.db
        .query('memberships')
        .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', s.companyA).eq('userId', s.manager))
        .unique()
      await ctx.db.patch(m!._id, { allLocations: false, locationIds: [s.south] })
    })
    expect(await s.confirm(s.manager, r.draftGroup)).toEqual({ status: 'nothing_allowed' })
    expect(await s.t.run((ctx) => ctx.db.query('biweeklyRecords').collect())).toHaveLength(0)
  })

  test('unit names resolve on a 1,000-unit farm', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const now = Date.now()
      for (let i = 0; i < 1000; i += 1) {
        await ctx.db.insert('cages', {
          name: `R-${String(i).padStart(4, '0')}`, status: 'active', currentCount: 500, currentWeight: 200,
          companyId: s.companyA, locationId: s.north, updatedAt: now,
        })
      }
    })
    const r = await s.propose(s.owner, { kind: 'water_reading', unit: 'R-0999', dissolvedOxygen: 6 })
    expect(r).toMatchObject({ ok: true })
    expect(await s.confirm(s.owner, r.draftGroup)).toMatchObject({ status: 'saved' })
  })
})

describe('the agent wires the new tools', () => {
  test('proposeHarvest and pendingApprovals through the model', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      contentSteps: [
        [
          { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'pendingApprovals', input: '{}' },
          { type: 'tool-call' as const, toolCallId: 'c2', toolName: 'proposeHarvest', input: JSON.stringify({ unit: 'C-01', totalWeightKg: 40, abwG: 400 }) },
        ],
        [{ type: 'text', text: 'Nothing is waiting for you. I drafted the harvest; confirm to save it.' }],
      ],
    })
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Harvest 40 kg from C-01', lang: 'en' })
    expect(res).toMatchObject({ ok: true })
    if (!res.ok) return
    const card = await s.card(s.owner, res.draftGroup!)
    expect(card?.items[0].payload).toMatchObject({ kind: 'harvest', cageId: s.c1, totalWeightKg: 40, count: 100, withLot: true })
    expect(await s.t.run((ctx) => ctx.db.query('harvestRecords').collect())).toHaveLength(0)
  })
})
