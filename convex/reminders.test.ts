/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const DATE = '2026-11-18'

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: Date.now() } as any)
    const companyId = await company('Lake Farm', 'LAKE')
    const otherId = await company('Other Farm', 'OTHR')
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const otherUserId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherId })
    const cage = (name: string, cid: any, status = 'active') =>
      ctx.db.insert('cages', { name, status, companyId: cid, updatedAt: Date.now() } as any)
    const b1 = await cage('B1', companyId)
    const b2 = await cage('B2', companyId)
    await cage('B3', companyId, 'harvested') // not active: never nagged about
    await cage('X1', otherId)
    await ctx.db.insert('dailyRecords', {
      cageId: b1, date: DATE, feedAmount: 10, feedPrice: 1, feedCost: 10, mortality: 0, companyId,
    } as any)
    await ctx.db.insert('feedTypes', {
      name: 'Grower 4mm', currentStock: 120, minimumStock: 500, pricePerKg: 10, active: true, companyId, updatedAt: Date.now(),
    } as any)
    await ctx.db.insert('feedTypes', {
      name: 'Starter 2mm', currentStock: 900, minimumStock: 200, pricePerKg: 12, active: true, companyId, updatedAt: Date.now(),
    } as any)
    return { companyId, adminId, staffId, otherUserId, b2 }
  })
  return { t, ...ids }
}

// dailyDigest fans out one scheduled companyDigest per approved company.
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

async function runDigest(t: any) {
  await t.mutation(internal.reminders.dailyDigest, { date: DATE })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}

const notesFor = (t: any, userId: any) =>
  t.run((ctx: any) =>
    ctx.db.query('notifications').withIndex('by_user', (q: any) => q.eq('userId', userId)).collect(),
  )

test('missed entries go to everyone with a pre-filled link; low stock only to admins', async () => {
  const { t, adminId, staffId, otherUserId, b2 } = await setup()
  await runDigest(t)

  const staff = await notesFor(t, staffId)
  expect(staff).toHaveLength(1)
  expect(staff[0].title).toBe('Daily entry missing for 1 cage')
  expect(staff[0].message).toContain('B2')
  expect(staff[0].message).toContain('(1 of 2 done)')
  expect(staff[0].link).toBe(`/daily-entry?cages=${b2}`)

  const admin = await notesFor(t, adminId)
  expect(admin.map((n: any) => n.title).sort()).toEqual([
    'Daily entry missing for 1 cage',
    'Low feed stock: 1 feed type',
  ])
  const low = admin.find((n: any) => n.title.startsWith('Low'))
  expect(low.message).toBe('Grower 4mm 120 kg left (minimum 500 kg)')

  // The other company has its own unlogged cage, but nothing about ours.
  const other = await notesFor(t, otherUserId)
  expect(other).toHaveLength(1)
  expect(other[0].message).toContain('X1')
})

test('running twice on the same day sends nothing new', async () => {
  const { t, staffId, companyId } = await setup()
  await runDigest(t)
  await runDigest(t)
  expect(await notesFor(t, staffId)).toHaveLength(1)
  const again = await t.mutation(internal.reminders.companyDigest, { companyId, date: DATE })
  expect(again.sent).toBe(0)
})

test('only admins can trigger reminders by hand', async () => {
  const { t, staffId } = await setup()
  await expect(
    t.withIdentity({ subject: `${staffId}|s` }).mutation(api.reminders.runForMyCompanyNow, {}),
  ).rejects.toThrow(/Insufficient permissions/)
})

test("each company's reminders are right however busy the other tenants are", async () => {
  const { t, staffId, adminId, b2 } = await setup()
  const late = await t.run(async (ctx) => {
    // A big tenant: 600 active cages, 2,500 entries on the same day.
    const bigId = await ctx.db.insert('companies', { name: 'Big', code: 'BIG', status: 'approved', createdAt: Date.now() } as any)
    const bigCages = []
    for (let i = 0; i < 600; i++) {
      bigCages.push(await ctx.db.insert('cages', { name: `Z${i}`, status: 'active', companyId: bigId, updatedAt: Date.now() } as any))
    }
    for (let i = 0; i < 2500; i++) {
      await ctx.db.insert('dailyRecords', {
        cageId: bigCages[i % 600], date: i < 600 ? DATE : `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        feedAmount: 1, feedPrice: 1, feedCost: 1, mortality: 0, companyId: bigId,
      } as any)
    }
    // More approved companies than one digest page, so ours spans pages.
    for (let i = 0; i < 60; i++) {
      await ctx.db.insert('companies', { name: `Filler ${i}`, code: `F${i}`, status: 'approved', createdAt: Date.now() } as any)
    }
    const lateId = await ctx.db.insert('companies', { name: 'Late', code: 'LATE', status: 'approved', createdAt: Date.now() } as any)
    const userId = await ctx.db.insert('users', { email: 'l@x.com', role: 'user', companyId: lateId })
    await ctx.db.insert('cages', { name: 'L1', status: 'active', companyId: lateId, updatedAt: Date.now() } as any)
    return { userId }
  })
  await runDigest(t)

  const staff = await notesFor(t, staffId)
  expect(staff.map((n: any) => n.title)).toEqual(['Daily entry missing for 1 cage'])
  expect(staff[0].message).toContain('(1 of 2 done)')
  expect(staff[0].link).toBe(`/daily-entry?cages=${b2}`)
  expect((await notesFor(t, adminId)).map((n: any) => n.title).sort()).toEqual([
    'Daily entry missing for 1 cage',
    'Low feed stock: 1 feed type',
  ])
  // A company on the second page of the fan-out still gets its reminder.
  const lateNotes = await notesFor(t, late.userId)
  expect(lateNotes).toHaveLength(1)
  expect(lateNotes[0].message).toContain('L1')
})
