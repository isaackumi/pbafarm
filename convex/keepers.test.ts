/// <reference types="vite/client" />
/**
 * Cage keepers: assignment and history, cover and the effective keeper,
 * permissions and tenant isolation, the "own cages only" rule, the deadline
 * escalation and its dedupe, Ask Anowa drafts that write nothing before
 * confirm, and the scale bound of the board (1,000 units, 200 keepers).
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
import { balance, escalationStage } from './keepers/balance'
import { effectiveFrom, mergeKeeperSettings, rowOf } from './keepers/model'
import { buildKeeperRows, loadOrg } from './keepers/board'
import type { MemberContext } from './lib/permissions'

const modules = import.meta.glob('./**/*.ts')
const TODAY = '2026-11-20'

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(`${TODAY}T08:00:00Z`))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  testHooks.languageModel = null
})

let groupN = 0
const group = () => `kg-${String(++groupN).padStart(4, '0')}-abcdefghijkl`

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: now, timezone: 'UTC', settings: { aiAssistantEnabled: true } })
    const a = await company('Lake', 'LAKE')
    const b = await company('River', 'RIVER')
    const site = await ctx.db.insert('farmLocations', { companyId: a, name: 'Akosombo', active: true, updatedAt: now })
    const site2 = await ctx.db.insert('farmLocations', { companyId: a, name: 'Kpong', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: b, name: 'B site', active: true, updatedAt: now })
    const member = async (name: string, companyId: Id<'companies'>, roleKey: string, extra: Record<string, unknown> = {}) => {
      const id = await ctx.db.insert('users', { email: `${name.toLowerCase()}@x.com`, name, role: 'user', companyId, phone: '+233200000000' })
      await ctx.db.insert('memberships', { userId: id, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now, ...extra })
      return id
    }
    const owner = await member('Kofi Owner', a, 'owner')
    const kwame = await member('Kwame Agyei', a, 'field_staff')
    const ama = await member('Ama Owusu', a, 'field_staff')
    const yaw = await member('Yaw Boateng', a, 'field_staff')
    // Kpong-only staff: may not keep Akosombo units.
    const efua = await member('Efua Mensah', a, 'field_staff', { allLocations: false, locationIds: [site2] })
    // A supervisor who manages keepers but has no assistant (ai.use).
    const role = await ctx.db.insert('roles', {
      companyId: a, key: 'supervisor', name: 'Supervisor', archived: false, updatedAt: now,
      permissions: ['org.view', 'production.view', 'production.keepers.manage', 'production.daily.record'],
    })
    const sup = await ctx.db.insert('users', { email: 'sup@x.com', name: 'Sena Sup', role: 'user', companyId: a })
    await ctx.db.insert('memberships', { userId: sup, companyId: a, roleKey: 'supervisor', roleId: role, allLocations: true, status: 'active', updatedAt: now })
    const ownerB = await member('Esi B', b, 'owner')
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10, currentWeight: 100,
        species: 'nile_tilapia', stockingDate: '2026-10-01', companyId, locationId, updatedAt: now,
      })
    const a1 = await cage('A-01', a, site)
    const a2 = await cage('A-02', a, site)
    const c1 = await cage('C-01', a, site)
    const d1 = await cage('D-01', a, site2)
    const bUnit = await cage('B-01', b, siteB)
    return { a, b, site, site2, siteB, owner, kwame, ama, yaw, efua, sup, ownerB, a1, a2, c1, d1, bUnit }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

/** Draft from a keeper screen and confirm it; returns the group. */
async function draftAndConfirm(s: S, userId: Id<'users'>, input: any) {
  const g = group()
  const r = await s.as(userId).mutation(api.anowa.drafts.draftKeeper, { draftGroup: g, input })
  expect(r).toMatchObject({ ok: true })
  const c = await s.as(userId).mutation(api.anowa.drafts.confirm, { draftGroup: g })
  expect(c.status).toBe('saved')
  return g
}

const keeperRows = (s: S) => s.t.run(async (ctx) => await ctx.db.query('cageKeepers').collect())

describe('pure rules', () => {
  test('effective keeper: cover wins on its days, split per unit, back on toDate', () => {
    const unit = 'u1' as Id<'cages'>
    const a = { keeperId: 'k' as Id<'users'>, backupId: 'b' as Id<'users'> }
    const cover = { _id: 'c' as Id<'keeperCovers'>, keeperId: a.keeperId, coverId: 'y' as Id<'users'>, fromDate: '2026-11-23', toDate: '2026-11-26' }
    expect(effectiveFrom(a, [cover], unit, '2026-11-22')?.keeperId).toBe('k')
    expect(effectiveFrom(a, [cover], unit, '2026-11-23')).toMatchObject({ keeperId: 'y', assignedId: 'k', backupId: 'b', coverId: 'y' })
    expect(effectiveFrom(a, [cover], unit, '2026-11-26')?.keeperId).toBe('k')
    const split = { ...cover, split: [{ unitId: unit, coverId: 'z' as Id<'users'> }] }
    expect(effectiveFrom(a, [split], unit, '2026-11-24')?.keeperId).toBe('z')
    expect(effectiveFrom(a, [{ ...cover, cancelledAt: 1 }], unit, '2026-11-24')?.keeperId).toBe('k')
    expect(effectiveFrom(null, [cover], unit, '2026-11-24')).toBeNull()
  })

  test('escalation stages follow the deadline', () => {
    const s = mergeKeeperSettings(null)
    expect(s).toMatchObject({ capacity: 25, deadline: '10:00', backupAfterMin: 60, managerAfterMin: 120, ownCagesOnly: false })
    expect(escalationStage(9 * 60 + 59, s)).toBe(0)
    expect(escalationStage(10 * 60, s)).toBe(1)
    expect(escalationStage(11 * 60, s)).toBe(2)
    expect(escalationStage(12 * 60, s)).toBe(3)
    expect(escalationStage(23 * 60, s)).toBe(0)
  })

  test('auto-balance gives keeperless units to the lightest keeper at the site and trims over capacity', () => {
    const units = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `A-0${i}`, site: 's', row: 'A', keeperId: 'heavy' })),
      { id: 'b1', name: 'B-01', site: 's', row: 'B', keeperId: 'light' },
      { id: 'd1', name: 'D-01', site: 's', row: 'D', keeperId: null },
      { id: 'x1', name: 'X-01', site: 'other', row: 'X', keeperId: null },
    ]
    const r = balance({ units, capacity: 3, maxMoves: 50 })
    expect(r.moves).toEqual([
      { unitId: 'd1', fromKeeperId: null, toKeeperId: 'light' },
      { unitId: 'a3', fromKeeperId: 'heavy', toKeeperId: 'light' },
    ])
    // X-01's site has no keeper; A-04 has nowhere under capacity left.
    expect(r.unplaced).toBe(2)
    expect(rowOf({ name: 'B-12', unitGroup: undefined })).toBe('B')
    expect(rowOf({ name: 'Pond 3', unitGroup: 'Block A' })).toBe('Block A')
  })
})

describe('assign, reassign and history', () => {
  test('nothing is written before confirm; reassign closes the old row and keeps history; undo restores', async () => {
    const s = await setup()
    const g = group()
    const r = await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, {
      draftGroup: g,
      input: { kind: 'keeper_assign', unitIds: [s.a1, s.a2], keeperId: s.kwame, backupId: s.ama },
    })
    expect(r.ok).toBe(true)
    expect(await keeperRows(s)).toHaveLength(0)
    const card = await s.as(s.owner).query(api.anowa.drafts.get, { draftGroup: g })
    expect(card?.items[0]).toMatchObject({ status: 'pending', problem: null, payload: { kind: 'keeper_assign', reason: 'assign' } })
    await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: g })
    let rows = await keeperRows(s)
    expect(rows).toHaveLength(2)
    expect(rows.every((x) => x.active && x.keeperId === s.kwame && x.backupId === s.ama && x.sinceDate === TODAY)).toBe(true)

    // Reassign A-01 to Yaw; the backup stays.
    const g2 = await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.yaw })
    rows = await keeperRows(s)
    const a1rows = rows.filter((x) => x.unitId === s.a1)
    expect(a1rows).toHaveLength(2)
    expect(a1rows.find((x) => x.active)).toMatchObject({ keeperId: s.yaw, backupId: s.ama })
    expect(a1rows.find((x) => !x.active)).toMatchObject({ keeperId: s.kwame, untilDate: TODAY })

    const chip = await s.as(s.kwame).query(api.keepers.views.forUnit, { unitId: s.a1, asOf: TODAY })
    expect(chip.keeper?.name).toBe('Yaw Boateng')
    expect(chip.keeper?.phone).toBeNull() // field staff do not see contact details
    expect(chip.history.map((h) => h.keeper)).toEqual(['Yaw Boateng', 'Kwame Agyei'])
    const chipMgr = await s.as(s.owner).query(api.keepers.views.forUnit, { unitId: s.a1, asOf: TODAY })
    expect(chipMgr.keeper?.phone).toBe('+233200000000')

    // Undo puts Kwame back.
    expect(await s.as(s.owner).mutation(api.anowa.drafts.undo, { draftGroup: g2 })).toMatchObject({ status: 'undone' })
    rows = await keeperRows(s)
    expect(rows.filter((x) => x.unitId === s.a1)).toHaveLength(1)
    expect(rows.find((x) => x.unitId === s.a1)).toMatchObject({ active: true, keeperId: s.kwame })
    expect(rows.find((x) => x.unitId === s.a1)?.untilDate).toBeUndefined()
    // Kwame was told in-app when he got the units.
    const notes = await s.t.run(async (ctx) => await ctx.db.query('notifications').collect())
    expect(notes.some((n) => n.userId === s.kwame && /You now keep/.test(n.title))).toBe(true)
  })

  test('a keeper must have access to the site; a stale draft is refused at confirm', async () => {
    const s = await setup()
    const bad = await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, {
      draftGroup: group(),
      input: { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.efua },
    })
    expect(bad).toMatchObject({ ok: false })
    if (!bad.ok) expect(bad.error).toMatch(/no access to that site/)

    const g = group()
    await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, { draftGroup: g, input: { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.kwame } })
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.yaw })
    expect(await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: g })).toEqual({ status: 'nothing_allowed' })
    const rows = await keeperRows(s)
    expect(rows.filter((x) => x.active).map((x) => x.keeperId)).toEqual([s.yaw])
  })

  test('a keeper manager without the assistant can draft and confirm keeper cards only', async () => {
    const s = await setup()
    await draftAndConfirm(s, s.sup, { kind: 'keeper_assign', unitIds: [s.c1], keeperId: s.yaw })
    expect((await keeperRows(s)).length).toBe(1)
  })
})

describe('permissions and tenant isolation', () => {
  test('field staff cannot draft keeper changes or read the board', async () => {
    const s = await setup()
    await expect(
      s.as(s.kwame).mutation(api.anowa.drafts.draftKeeper, { draftGroup: group(), input: { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.kwame } }),
    ).rejects.toThrow(/production.keepers.manage/)
    await expect(s.as(s.kwame).query(api.keepers.board.board, { asOf: TODAY })).rejects.toThrow(/production.keepers.manage/)
  })

  test("another organization's units, people and boards are refused", async () => {
    const s = await setup()
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.kwame })
    // B's owner cannot draft on A's unit, nor give B's unit to A's member.
    const r1 = await s.as(s.ownerB).mutation(api.anowa.drafts.draftKeeper, { draftGroup: group(), input: { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.ownerB } })
    expect(r1).toMatchObject({ ok: false, error: 'A unit is not in your access.' })
    const r2 = await s.as(s.ownerB).mutation(api.anowa.drafts.draftKeeper, { draftGroup: group(), input: { kind: 'keeper_assign', unitIds: [s.bUnit], keeperId: s.kwame } })
    expect(r2).toMatchObject({ ok: false })
    const r3 = await s.as(s.ownerB).mutation(api.anowa.drafts.draftKeeper, { draftGroup: group(), input: { kind: 'keeper_cover', keeperId: s.kwame, coverId: s.ownerB, days: 2 } })
    expect(r3).toMatchObject({ ok: false })
    await expect(s.as(s.ownerB).query(api.keepers.views.forUnit, { unitId: s.a1 })).rejects.toThrow(/not found/i)
    await expect(s.as(s.ownerB).query(api.keepers.board.row, { siteId: s.site, row: 'A' })).rejects.toThrow(/not found/i)
    const boardB = await s.as(s.ownerB).query(api.keepers.board.board, { asOf: TODAY, filter: 'all' })
    expect(boardB.keepersTotal).toBe(0)
    expect(boardB.sites.flatMap((x) => x.units).map((u) => u.n)).toEqual(['B-01'])
    // B cannot read or confirm A's draft group.
    const g = group()
    await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, { draftGroup: g, input: { kind: 'keeper_assign', unitIds: [s.a2], keeperId: s.ama } })
    expect(await s.as(s.ownerB).query(api.anowa.drafts.get, { draftGroup: g })).toBeNull()
    await expect(s.as(s.ownerB).mutation(api.anowa.drafts.confirm, { draftGroup: g })).rejects.toThrow(/not found/i)
  })
})

describe('security review regressions (docs/security/audits/2026-11-20-cage-keepers)', () => {
  test("another organization's user id reveals no name through drafts or the cover preview", async () => {
    const s = await setup()
    const name = /Esi/
    for (const input of [
      { kind: 'keeper_assign', moves: [{ unitId: s.a1, keeperId: s.ownerB }] },
      { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.ownerB },
      { kind: 'keeper_cover', keeperId: s.ownerB, coverId: s.yaw, days: 2 },
      { kind: 'keeper_cover', keeperId: s.kwame, coverId: s.ownerB, days: 2 },
    ]) {
      const r = await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, { draftGroup: group(), input: input as any })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).not.toMatch(name)
    }
    await expect(s.as(s.owner).query(api.keepers.board.coverPreview, { keeperId: s.ownerB })).rejects.toThrow(/not found/i)
  })

  test('a removed member is no longer alerted or nudged about the units', async () => {
    const s = await setup()
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.kwame, backupId: s.ama })
    await s.t.run(async (ctx) => {
      for (const id of [s.kwame, s.ama]) {
        const m = await ctx.db.query('memberships').withIndex('by_companyId_and_userId', (q) => q.eq('companyId', s.a).eq('userId', id)).unique()
        await ctx.db.patch(m!._id, { status: 'removed' })
      }
    })
    await s.t.mutation(internal.keepers.escalation.company, { companyId: s.a, now: Date.parse(`${TODAY}T11:05:00Z`) })
    const alerted = await s.t.run(async (ctx) => (await ctx.db.query('keeperAlerts').collect()).map((x) => x.userId))
    expect(alerted).not.toContain(s.kwame)
    expect(alerted).not.toContain(s.ama)
    const r = await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, { draftGroup: group(), input: { kind: 'keeper_nudge', keeperIds: [s.kwame] } })
    expect(r.ok).toBe(false)
  })

  test('a manager limited to some sites cannot change organization-wide keeper rules', async () => {
    const s = await setup()
    const lim = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { email: 'lim@x.com', name: 'Lim', role: 'user', companyId: s.a })
      await ctx.db.insert('memberships', { userId: id, companyId: s.a, roleKey: 'manager', allLocations: false, locationIds: [s.site], status: 'active', updatedAt: Date.now() })
      return id
    })
    await expect(s.as(lim).mutation(api.keepers.views.updateSettings, { ownCagesOnly: true })).rejects.toThrow(/every site/)
  })
})

describe('cover', () => {
  test('cover moves My cages to the cover for its days, then back; the cover is told', async () => {
    const s = await setup()
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1, s.a2], keeperId: s.kwame })
    await draftAndConfirm(s, s.owner, {
      kind: 'keeper_cover', keeperId: s.kwame, coverId: s.yaw, fromDate: '2026-11-23', toDate: '2026-11-26', note: 'A-02 aerator checked daily',
    })
    const mine = (who: Id<'users'>, asOf: string) => s.as(who).query(api.keepers.views.myCages, { asOf })
    expect((await mine(s.kwame, '2026-11-22')).total).toBe(2)
    expect((await mine(s.yaw, '2026-11-22')).total).toBe(0)
    const during = await mine(s.yaw, '2026-11-24')
    expect(during.total).toBe(2)
    expect(during.todo[0].coverFor).toBe('Kwame Agyei')
    expect((await mine(s.kwame, '2026-11-24'))).toMatchObject({ total: 0, away: { toDate: '2026-11-26', coverName: 'Yaw Boateng' } })
    expect((await mine(s.kwame, '2026-11-26')).total).toBe(2)
    expect((await mine(s.yaw, '2026-11-26')).total).toBe(0)
    const notes = await s.t.run(async (ctx) => await ctx.db.query('notifications').collect())
    expect(notes.find((n) => n.userId === s.yaw)?.message).toMatch(/aerator/)
    const dispatches = await s.t.run(async (ctx) => await ctx.db.query('notificationDispatches').collect())
    expect(dispatches.some((d) => d.deliveries.some((x) => x.channel === 'whatsapp' && x.userId === s.yaw))).toBe(true)
    // Overlapping cover is refused.
    const again = await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, {
      draftGroup: group(), input: { kind: 'keeper_cover', keeperId: s.kwame, coverId: s.ama, fromDate: '2026-11-25', toDate: '2026-11-27' },
    })
    expect(again).toMatchObject({ ok: false })
  })
})

describe('own cages only', () => {
  const entry = (cageId: Id<'cages'>) => ({ date: TODAY, records: [{ cageId, feedAmount: 0, mortality: 1 }] })

  test('off by default; when on, staff log only their (or covered / backup) units, managers any', async () => {
    const s = await setup()
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.kwame, backupId: s.ama })
    // Off: anyone with daily.record may log.
    await s.as(s.yaw).mutation(api.dailyRecords.createBatch, entry(s.c1))
    await s.as(s.owner).mutation(api.keepers.views.updateSettings, { ownCagesOnly: true })
    await expect(s.as(s.yaw).mutation(api.dailyRecords.createBatch, entry(s.a1))).rejects.toThrow(/keeper can log/)
    await expect(s.as(s.yaw).mutation(api.dailyRecords.createBatch, entry(s.a2))).rejects.toThrow(/keeper can log/)
    await s.as(s.kwame).mutation(api.dailyRecords.createBatch, entry(s.a1))
    await s.as(s.owner).mutation(api.dailyRecords.createBatch, entry(s.a2))
    // The backup may log.
    await s.t.run(async (ctx) => {
      const r = await ctx.db.query('dailyRecords').withIndex('by_cage_date', (q) => q.eq('cageId', s.a1)).first()
      await ctx.db.delete(r!._id)
    })
    await s.as(s.ama).mutation(api.dailyRecords.createBatch, entry(s.a1))
    // Field staff cannot change the setting.
    await expect(s.as(s.kwame).mutation(api.keepers.views.updateSettings, { ownCagesOnly: false })).rejects.toThrow(/production.keepers.manage/)
  })
})

describe('deadline escalation', () => {
  const at = (hhmm: string) => Date.parse(`${TODAY}T${hhmm}:00Z`)

  test('keeper at the deadline, backup an hour later, managers after two; each once', async () => {
    const s = await setup()
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1, s.a2], keeperId: s.kwame, backupId: s.ama })
    await s.as(s.kwame).mutation(api.dailyRecords.createBatch, { date: TODAY, records: [{ cageId: s.a2, feedAmount: 0, mortality: 0 }] })
    const run = (hhmm: string) => s.t.mutation(internal.keepers.escalation.company, { companyId: s.a, now: at(hhmm) })
    const alerts = () => s.t.run(async (ctx) => (await ctx.db.query('keeperAlerts').collect()).map((x) => x.key.split(':').slice(0, 2).join(':') + ':' + x.userId))

    expect(await run('09:50')).toEqual({ sent: 0, stage: 0 })
    expect((await run('10:05')).sent).toBe(1)
    expect((await run('10:20')).sent).toBe(0) // dedupe
    expect(await alerts()).toEqual([`keeper-esc:1:${s.kwame}`])
    expect((await run('11:05')).sent).toBe(1)
    expect(await alerts()).toContain(`keeper-esc:2:${s.ama}`)
    const r3 = await run('12:10')
    expect(r3.stage).toBe(3)
    const keys = await alerts()
    // Managers: the owner and the supervisor (C-01 and D-01 have no keeper, so they are in it too).
    expect(keys).toContain(`keeper-esc:3:${s.owner}`)
    expect(keys).toContain(`keeper-esc:3:${s.sup}`)
    expect(keys.filter((k) => k.startsWith('keeper-esc:3')).length).toBe(2)
    expect((await run('12:40')).sent).toBe(0)
    // Kwame's alert lists only A-01 (A-02 is logged).
    const msg = await s.t.run(async (ctx) => (await ctx.db.query('notifications').collect()).find((n) => n.userId === s.kwame && /to log/.test(n.title)))
    expect(msg?.message).toMatch(/A-01/)
    expect(msg?.message).not.toMatch(/A-02/)
  })

  test('the cover is reminded instead of the keeper who is away', async () => {
    const s = await setup()
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.kwame })
    await draftAndConfirm(s, s.owner, { kind: 'keeper_cover', keeperId: s.kwame, coverId: s.yaw, fromDate: TODAY, toDate: '2026-11-22' })
    await s.t.mutation(internal.keepers.escalation.company, { companyId: s.a, now: at('10:05') })
    const keys = await s.t.run(async (ctx) => (await ctx.db.query('keeperAlerts').collect()).map((x) => x.userId))
    expect(keys).toEqual([s.yaw])
  })

  test('a manual nudge reaches each keeper once a day', async () => {
    const s = await setup()
    await draftAndConfirm(s, s.owner, { kind: 'keeper_assign', unitIds: [s.a1], keeperId: s.kwame })
    await draftAndConfirm(s, s.owner, { kind: 'keeper_nudge', keeperIds: [s.kwame] })
    const g = group()
    await s.as(s.owner).mutation(api.anowa.drafts.draftKeeper, { draftGroup: g, input: { kind: 'keeper_nudge' } })
    await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: g })
    const n = await s.t.run(async (ctx) => (await ctx.db.query('notifications').collect()).filter((x) => x.userId === s.kwame && /still to log/.test(x.title)))
    expect(n).toHaveLength(1)
  })
})

describe('Ask Anowa keeper tools', () => {
  function toolCall(toolName: string, input: Record<string, unknown>, id = 'c1') {
    return { type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }
  }

  test('"give row A to Yaw" only drafts; confirm writes; "who is behind" reads', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      contentSteps: [
        [toolCall('whoIsBehind', {}, 'c0'), toolCall('proposeAssignKeeper', { keeper: 'Yaw', row: 'A', site: 'Akosombo' }, 'c1')],
        [{ type: 'text', text: 'Drafted: A-01 and A-02 to Yaw. Nothing changes until you confirm.' }],
      ],
    })
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'give Akosombo row A to Yaw', lang: 'en' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draftGroup).toBeTruthy()
    expect(await keeperRows(s)).toHaveLength(0)
    const card = await s.as(s.owner).query(api.anowa.drafts.get, { draftGroup: res.draftGroup! })
    expect(card?.items[0].payload).toMatchObject({ kind: 'keeper_assign', moves: [{ unitName: 'A-01', toName: 'Yaw Boateng' }, { unitName: 'A-02', toName: 'Yaw Boateng' }] })
    await s.as(s.owner).mutation(api.anowa.drafts.confirm, { draftGroup: res.draftGroup! })
    expect((await keeperRows(s)).map((r) => r.keeperId)).toEqual([s.yaw, s.yaw])
    const read = await s.as(s.owner).query(internal.keepers.ask.read as any, { tool: 'behind', now: Date.now() })
    expect(JSON.parse(read.data)).toMatchObject({ behind: [{ keeper: 'Yaw Boateng', due: 2, of: 2 }], unitsWithoutKeeper: 2 })
  })
})

describe('scale: 1,000 units and 200 keepers', () => {
  test('the board reads a bounded number of documents and returns one page', async () => {
    const t = convexTest(schema, modules)
    const UNITS = 1000
    const KEEPERS = 200
    const ids = await t.run(async (ctx) => {
      const now = Date.now()
      const a = await ctx.db.insert('companies', { name: 'Big', code: 'BIG', status: 'approved', createdAt: now, timezone: 'UTC' })
      const sites = []
      for (const name of ['Akosombo', 'Kpong', 'Volta North']) sites.push(await ctx.db.insert('farmLocations', { companyId: a, name, active: true, updatedAt: now }))
      const owner = await ctx.db.insert('users', { email: 'o@big.com', name: 'Owner', role: 'user', companyId: a })
      await ctx.db.insert('memberships', { userId: owner, companyId: a, roleKey: 'owner', allLocations: true, status: 'active', updatedAt: now })
      const keepers = []
      for (let i = 0; i < KEEPERS; i++) {
        const k = await ctx.db.insert('users', { email: `k${i}@big.com`, name: `Keeper ${i}`, role: 'user', companyId: a })
        keepers.push(k)
      }
      for (let i = 0; i < UNITS; i++) {
        const site = sites[i % 3]
        const row = String.fromCharCode(65 + (Math.floor(i / 36) % 26))
        const unit = await ctx.db.insert('cages', { name: `${row}-${i}`, status: 'active', currentCount: 5000, companyId: a, locationId: site, updatedAt: now })
        // 980 with a keeper (some keepers over capacity), 20 without.
        if (i < 980) {
          const k = keepers[i < 120 ? 0 : i % KEEPERS]
          await ctx.db.insert('cageKeepers', { companyId: a, unitId: unit, locationId: site, keeperId: k, sinceDate: '2026-11-01', active: true, assignedBy: owner, assignedAt: now })
        }
        if (i % 2 === 0) await ctx.db.insert('dailyRecords', { cageId: unit, date: TODAY, feedAmount: 0, feedPrice: 0, feedCost: 0, mortality: 0, companyId: a, locationId: site })
      }
      return { a, owner }
    })

    // Documents read by the board's loader, counted through a proxy on ctx.db.
    const reads = await t.run(async (ctx) => {
      let n = 0
      const count = (x: unknown) => {
        n += Array.isArray(x) ? x.length : x && typeof x === 'object' && 'page' in (x as object) ? (x as { page: unknown[] }).page.length : x ? 1 : 0
        return x
      }
      const wrap = (q: any): any =>
        new Proxy(q, {
          get(target, prop) {
            const value = target[prop]
            if (typeof value !== 'function') return value
            return (...args: unknown[]) => {
              const out = value.apply(target, args)
              return out && typeof out.then === 'function' ? out.then(count) : wrap(out)
            }
          },
        })
      const db = new Proxy(ctx.db, {
        get(target: any, prop) {
          if (prop === 'get') return async (...args: unknown[]) => count(await target.get(...args))
          if (prop === 'query') return (table: string) => wrap(target.query(table))
          return target[prop]
        },
      })
      const counted = { ...ctx, db } as typeof ctx
      const owner = (await ctx.db.get(ids.owner))!
      const m: MemberContext & { companyId: Id<'companies'> } = {
        user: owner, companyId: ids.a, membership: null, roleKey: 'owner', roleName: 'Owner', permissions: new Set(), siteScope: 'all', isPlatformAdmin: false,
      }
      const org = await loadOrg(counted, m, TODAY)
      const names = new Map<string, string>()
      for (const a of org.assignments.values()) names.set(a.keeperId, 'x')
      const rows = buildKeeperRows(org, names, TODAY)
      return { n, units: org.units.length, rows: rows.length }
    })
    expect(reads.units).toBe(UNITS)
    // Units + today's records + open assignments + sites + settings: a fixed
    // number of indexed reads, never one query per unit.
    expect(reads.n).toBeLessThanOrEqual(UNITS + UNITS / 2 + 980 + 3 + 10)

    const started = Date.now()
    const board = await t.withIdentity({ subject: `${ids.owner}|s` }).query(api.keepers.board.board, { asOf: TODAY })
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(board.sites.reduce((n, x) => n + x.units.length, 0)).toBe(UNITS)
    // No keeper wins over logged: 20 keeperless units (10 of them logged).
    expect(board.totals).toMatchObject({ logged: 490, none: 20, due: 490 })
    expect(board.rows.length).toBeLessThanOrEqual(25)
    expect(board.chips.over).toBe(1)
    expect(board.rows[0]).toMatchObject({ kind: 'unassigned' })
    // The browser gets one page plus the heatmap squares, not every keeper row.
    expect(JSON.stringify(board).length).toBeLessThan(250_000)
  }, 120_000)
})
