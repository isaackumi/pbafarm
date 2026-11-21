/// <reference types="vite/client" />
/**
 * Sidebar counts, palette hints, palette search and recents (convex/navSearch):
 * permissions, tenant isolation, site scope, separator-tolerant matching and
 * the recents cap.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { alertLine, alertSample, matchRank, normalizeTerm } from './navSearch'

const modules = import.meta.glob('./**/*.ts')
const TODAY = '2026-11-20'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T08:00:00Z`))
})
afterEach(() => vi.useRealTimers())

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: now, timezone: 'UTC' })
    const a = await company('Lake', 'LAKE')
    const b = await company('River', 'RIVER')
    const site = await ctx.db.insert('farmLocations', { companyId: a, name: 'Akosombo', active: true, updatedAt: now })
    const site2 = await ctx.db.insert('farmLocations', { companyId: a, name: 'Kpong', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: b, name: 'B site', active: true, updatedAt: now })
    const member = async (name: string, companyId: Id<'companies'>, roleKey: string, extra: Record<string, unknown> = {}) => {
      const id = await ctx.db.insert('users', { email: `${name.split(' ')[0].toLowerCase()}@x.com`, name, role: 'user', companyId })
      await ctx.db.insert('memberships', { userId: id, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now, ...extra })
      return id
    }
    const owner = await member('Kofi Owner', a, 'owner')
    const staff = await member('Ama Staff', a, 'field_staff')
    const viewer = await member('Yaw Viewer', a, 'viewer')
    const kpong = await member('Efua Kpong', a, 'field_staff', { allLocations: false, locationIds: [site2] })
    const ownerB = await member('Esi River', b, 'owner')
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>, extra: Record<string, unknown> = {}) =>
      ctx.db.insert('cages', {
        name, status: 'active', currentCount: 1000, species: 'nile_tilapia', stockingDate: '2026-09-19',
        companyId, locationId, updatedAt: now, ...extra,
      })
    const c07 = await cage('C-07', a, site)
    const c08 = await cage('C-08', a, site)
    const k01 = await cage('K-01', a, site2)
    const empty = await cage('C-070', a, site, { status: 'empty', stockingDate: undefined })
    const bC07 = await cage('C-07', b, siteB)
    const batch = (companyId: Id<'companies'>, batchNumber: string) =>
      ctx.db.insert('batches', { companyId, batchNumber, origin: 'stocking', status: 'active', openedOn: '2026-09-19', updatedAt: now })
    const tl031 = await batch(a, 'TL-2026-031')
    const tlK = await batch(a, 'TL-2026-077')
    const tlB = await batch(b, 'TL-2026-031')
    await ctx.db.patch(c07, { currentBatchId: tl031 })
    await ctx.db.patch(k01, { currentBatchId: tlK })
    await ctx.db.patch(bC07, { currentBatchId: tlB })
    const ev = (companyId: Id<'companies'>, unitId: Id<'cages'>, batchId: Id<'batches'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('stockEvents', {
        companyId, unitId, batchId, locationId, type: 'stock_in', qtyDelta: 1000, biomassKgDelta: 10,
        eventDate: '2026-09-19', intraDayOrder: 0, sourceTable: 'stockingHistory', sourceId: 'x', recordedAt: now,
      })
    await ev(a, c07, tl031, site)
    await ev(a, k01, tlK, site2)
    await ev(b, bC07, tlB, siteB)
    const lot = async (companyId: Id<'companies'>, cageId: Id<'cages'>, locationId: Id<'farmLocations'>, lotCode: string) => {
      const harvestId = await ctx.db.insert('harvestRecords', {
        cageId, harvestDate: '2026-06-17', averageBodyWeight: 400, totalWeight: 4730, estimatedCount: 11000, fcr: 1.5,
        companyId, locationId,
      } as never)
      return ctx.db.insert('harvestLots', { companyId, locationId, harvestId, cageId, lotCode, harvestDate: '2026-06-17', weightKg: 4730, updatedAt: now })
    }
    await lot(a, c07, site, 'LOT-24-C07-A')
    await lot(a, k01, site2, 'LOT-24-K01-A')
    await lot(b, bC07, siteB, 'LOT-24-C07-B')
    // A low-oxygen alert on C-07 and one on K-01 (Kpong).
    const alert = (companyId: Id<'companies'>, unitId: Id<'cages'>, unitName: string, locationId: Id<'farmLocations'>, status: 'open' | 'acknowledged' = 'open') =>
      ctx.db.insert('farmAlerts', {
        companyId, unitId, unitName, locationId, rule: 'low_oxygen', severity: 'critical', status,
        date: TODAY, lastSeenDate: TODAY, evidence: { do_mg_l: 3.1, min_mg_l: 4 }, createdAt: now, updatedAt: now,
      })
    await alert(a, c07, 'C-07', site)
    await alert(a, k01, 'K-01', site2)
    await alert(a, c08, 'C-08', site, 'acknowledged')
    await alert(b, bC07, 'C-07', siteB)
    return { a, b, site, site2, owner, staff, viewer, kpong, ownerB, c07, c08, k01, empty, bC07, tl031, tlK, tlB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, ids, as }
}

describe('helpers', () => {
  test('normalizeTerm ignores case and separators', () => {
    expect(normalizeTerm('C-07')).toBe('c07')
    expect(normalizeTerm('c 07')).toBe('c07')
    expect(normalizeTerm(' C_07 ')).toBe('c07')
  })
  test('matchRank: exact, prefix, contains, none', () => {
    expect(matchRank('C-07', 'c07')).toBe(0)
    expect(matchRank('C-070', 'c07')).toBe(1)
    expect(matchRank('LOT-24-C07-A', 'c07')).toBe(2)
    expect(matchRank('C-08', 'c07')).toBe(-1)
    expect(matchRank(null, 'c07')).toBe(-1)
  })
  test('alertLine formats water alerts as reading · target, in both languages', () => {
    const a = { rule: 'low_oxygen' as const, unitName: 'C-07', evidence: { do_mg_l: 3.1, min_mg_l: 4 } }
    expect(alertLine(a, 'en')).toBe('Dissolved O₂ 3.1 mg/L · below 4 target')
    expect(alertLine(a, 'fr')).toContain('O₂ dissous 3.1 mg/L')
    const m = { rule: 'missing_entries' as const, unitName: 'C-07', evidence: { days_missing: 3 } }
    expect(alertLine(m, 'en')).toBe('No daily entry for 3 days')
    expect(alertSample(a, 'en')).toBe('DO 3.1 mg/L')
    expect(alertSample(a, 'fr')).toBe('OD 3.1 mg/L')
  })
})

describe('navCounts', () => {
  test('signed out: both null', async () => {
    const { t } = await setup()
    expect(await t.query(api.navSearch.navCounts, {})).toEqual({ openAlerts: null, approvals: null })
  })

  test('open alerts in scope; approvals only for approvers', async () => {
    const { t, ids, as } = await setup()
    await t.run(async (ctx) => {
      const now = Date.now()
      const s1 = await ctx.db.insert('stockingHistory', {
        cageId: ids.c08, batchNumber: 'TL-1', stockingDate: TODAY, fishCount: 10, initialAbw: 5, initialBiomass: 0.05,
        status: 'pending_approval', companyId: ids.a, locationId: ids.site,
      })
      // A transfer's destination stocking is counted once, as the transfer.
      const s2 = await ctx.db.insert('stockingHistory', {
        cageId: ids.c08, batchNumber: 'TL-2', stockingDate: TODAY, fishCount: 10, initialAbw: 5, initialBiomass: 0.05,
        status: 'pending_approval', companyId: ids.a, locationId: ids.site,
      })
      await ctx.db.insert('fishTransfers', {
        sourceCageId: ids.c07, destinationCageId: ids.c08, destinationStockingId: s2, transferDate: TODAY, quantity: 5,
        abw: 5, biomass: 0.025, transferType: 'partial', status: 'pending_approval', companyId: ids.a, updatedAt: now,
      })
      await ctx.db.insert('stockingHistory', {
        cageId: ids.c08, batchNumber: 'TL-3', stockingDate: TODAY, fishCount: 10, initialAbw: 5, initialBiomass: 0.05,
        status: 'pending_approval', companyId: ids.a, locationId: ids.site, deletedAt: now,
      })
      // Company B's pending stocking never counts for A.
      await ctx.db.insert('stockingHistory', {
        cageId: ids.bC07, batchNumber: 'TL-B', stockingDate: TODAY, fishCount: 10, initialAbw: 5, initialBiomass: 0.05,
        status: 'pending_approval', companyId: ids.b,
      })
      return s1
    })
    expect(await as(ids.owner).query(api.navSearch.navCounts, {})).toEqual({ openAlerts: 2, approvals: 2 })
    // Field staff: alerts yes, approvals no.
    expect(await as(ids.staff).query(api.navSearch.navCounts, {})).toEqual({ openAlerts: 2, approvals: null })
    // Kpong-only member sees only the Kpong alert.
    expect(await as(ids.kpong).query(api.navSearch.navCounts, {})).toEqual({ openAlerts: 1, approvals: null })
    // Company B: its own alert only.
    expect(await as(ids.ownerB).query(api.navSearch.navCounts, {})).toEqual({ openAlerts: 1, approvals: 1 })
  })
})

describe('quickHints', () => {
  test('counts unlogged and sampling-due stocked units; null without permission', async () => {
    const { t, ids, as } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert('dailyRecords', {
        cageId: ids.c07, date: TODAY, feedAmount: 10, feedPrice: 1, feedCost: 10, mortality: 0, companyId: ids.a, locationId: ids.site,
      })
      // C-08 was sampled recently: not due.
      await ctx.db.insert('biweeklyRecords', {
        cageId: ids.c08, date: '2026-11-15', batchCode: 'x', averageBodyWeight: 100, totalFishCount: 10, totalWeight: 1,
        companyId: ids.a, locationId: ids.site, updatedAt: Date.now(),
      })
    })
    // Stocked: C-07, C-08 (Akosombo), K-01 (Kpong); C-070 is empty.
    expect(await as(ids.owner).query(api.navSearch.quickHints, { date: TODAY })).toEqual({ notLoggedToday: 2, samplingDue: 2 })
    expect(await as(ids.kpong).query(api.navSearch.quickHints, { date: TODAY })).toEqual({ notLoggedToday: 1, samplingDue: 1 })
    expect(await as(ids.viewer).query(api.navSearch.quickHints, { date: TODAY })).toEqual({ notLoggedToday: null, samplingDue: null })
    expect(await t.query(api.navSearch.quickHints, { date: TODAY })).toEqual({ notLoggedToday: null, samplingDue: null })
    // Company B: its one cage, not logged.
    expect(await as(ids.ownerB).query(api.navSearch.quickHints, { date: TODAY })).toEqual({ notLoggedToday: 1, samplingDue: 1 })
  })
})

describe('palette', () => {
  test('"c-07", "c07" and "C 07" find the cage, its batch and its lot', async () => {
    const { ids, as } = await setup()
    for (const q of ['c-07', 'c07', 'C 07']) {
      const r = await as(ids.owner).query(api.navSearch.palette, { q, date: TODAY })
      expect(r.cages.map((c) => c._id)).toEqual([ids.c07, ids.empty])
      expect(r.batches.map((b) => b._id)).toEqual([ids.tl031])
      expect(r.lots.map((l) => l.code)).toEqual(['LOT-24-C07-A'])
    }
    const r = await as(ids.owner).query(api.navSearch.palette, { q: 'c-07', date: TODAY })
    expect(r.cages[0]).toMatchObject({
      name: 'C-07',
      species: 'Nile tilapia',
      dayOfCycle: 62,
      location: 'Row C, Akosombo',
      kind: 'cage',
      alert: { text: 'Dissolved O₂ 3.1 mg/L · below 4 target', severity: 'critical', water: true },
      sampleText: 'DO 3.1 mg/L',
    })
    // An empty unit has no species, day or alert.
    expect(r.cages[1]).toMatchObject({ name: 'C-070', species: null, dayOfCycle: null, alert: null, sampleText: null })
    expect(r.batches[0]).toMatchObject({ code: 'TL-2026-031', cageId: ids.c07, cageName: 'C-07', fishCount: 1000 })
    expect(r.lots[0]).toMatchObject({ cageName: 'C-07', weightKg: 4730, date: '2026-06-17' })
  })

  test('batch code search and empty query', async () => {
    const { ids, as } = await setup()
    const r = await as(ids.owner).query(api.navSearch.palette, { q: 'tl-2026', date: TODAY })
    expect(r.batches.map((b) => b.code).sort()).toEqual(['TL-2026-031', 'TL-2026-077'])
    expect(await as(ids.owner).query(api.navSearch.palette, { q: '  - ' })).toEqual({ cages: [], batches: [], lots: [], people: [] })
  })

  test('tenant isolation: company B rows never appear', async () => {
    const { ids, as } = await setup()
    const r = await as(ids.owner).query(api.navSearch.palette, { q: 'c07', date: TODAY })
    expect(r.cages.some((c) => c._id === ids.bC07)).toBe(false)
    expect(r.batches.some((b) => b._id === ids.tlB)).toBe(false)
    expect(r.lots.some((l) => l.code === 'LOT-24-C07-B')).toBe(false)
    const p = await as(ids.owner).query(api.navSearch.palette, { q: 'esi' })
    expect(p.people).toEqual([])
    const rb = await as(ids.ownerB).query(api.navSearch.palette, { q: 'c07', date: TODAY })
    expect(rb.cages.map((c) => c._id)).toEqual([ids.bC07])
    expect(rb.lots.map((l) => l.code)).toEqual(['LOT-24-C07-B'])
  })

  test('site scope: a Kpong-only member sees only Kpong rows', async () => {
    const { ids, as } = await setup()
    const r = await as(ids.kpong).query(api.navSearch.palette, { q: 'c07', date: TODAY })
    expect(r).toEqual({ cages: [], batches: [], lots: [], people: [] })
    const k = await as(ids.kpong).query(api.navSearch.palette, { q: 'k01', date: TODAY })
    expect(k.cages.map((c) => c._id)).toEqual([ids.k01])
    expect(k.batches.map((b) => b._id)).toEqual([ids.tlK])
    expect(k.lots.map((l) => l.code)).toEqual(['LOT-24-K01-A'])
    const tl = await as(ids.kpong).query(api.navSearch.palette, { q: 'tl-2026', date: TODAY })
    expect(tl.batches.map((b) => b.code)).toEqual(['TL-2026-077'])
  })

  test('people: member managers only, active members of the company', async () => {
    const { t, ids, as } = await setup()
    const r = await as(ids.owner).query(api.navSearch.palette, { q: 'ama' })
    expect(r.people).toEqual([{ userId: ids.staff, name: 'Ama Staff', detail: 'Field staff' }])
    expect((await as(ids.staff).query(api.navSearch.palette, { q: 'ama' })).people).toEqual([])
    await t.run(async (ctx) => {
      const ms = await ctx.db
        .query('memberships')
        .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', ids.a).eq('userId', ids.staff))
        .first()
      await ctx.db.patch(ms!._id, { status: 'removed' })
    })
    expect((await as(ids.owner).query(api.navSearch.palette, { q: 'ama' })).people).toEqual([])
  })

  test('without production.view: no records', async () => {
    const { t, ids, as } = await setup()
    const noProd = await t.run(async (ctx) => {
      const role = await ctx.db.insert('roles', { companyId: ids.a, key: 'acct', name: 'Accounts', archived: false, updatedAt: 0, permissions: ['org.view', 'finance.view'] })
      const u = await ctx.db.insert('users', { email: 'acct@x.com', name: 'Acc', role: 'user', companyId: ids.a })
      await ctx.db.insert('memberships', { userId: u, companyId: ids.a, roleKey: 'acct', roleId: role, allLocations: true, status: 'active', updatedAt: 0 })
      return u
    })
    expect(await as(noProd).query(api.navSearch.palette, { q: 'c07' })).toEqual({ cages: [], batches: [], lots: [], people: [] })
    expect(await t.query(api.navSearch.palette, { q: 'c07' })).toEqual({ cages: [], batches: [], lots: [], people: [] })
  })
})

describe('recents', () => {
  test('newest first, deduped, three shown, pages kept', async () => {
    const { ids, as } = await setup()
    const me = as(ids.owner)
    await me.mutation(api.navSearch.recordRecent, { kind: 'page', key: '/cycle-planner' })
    vi.advanceTimersByTime(1000)
    await me.mutation(api.navSearch.recordRecent, { kind: 'batch', key: ids.tl031 })
    vi.advanceTimersByTime(1000)
    await me.mutation(api.navSearch.recordRecent, { kind: 'cage', key: ids.c07 })
    vi.advanceTimersByTime(1000)
    await me.mutation(api.navSearch.recordRecent, { kind: 'page', key: '/cycle-planner' })
    const r = await me.query(api.navSearch.recents, { date: TODAY })
    expect(r.map((x) => x.key)).toEqual(['/cycle-planner', ids.c07, ids.tl031])
    const cage = r[1]
    expect(cage.kind === 'cage' && cage.cage.alert?.water).toBe(true)
    const batch = r[2]
    expect(batch.kind === 'batch' && batch.batch.cageName).toBe('C-07')
  })

  test('keeps at most 20 per member', async () => {
    const { t, ids, as } = await setup()
    for (let i = 0; i < 25; i++) {
      vi.advanceTimersByTime(1000)
      await as(ids.owner).mutation(api.navSearch.recordRecent, { kind: 'page', key: `/p${i}` })
    }
    const rows = await t.run((ctx) => ctx.db.query('navRecents').take(100))
    expect(rows).toHaveLength(20)
    expect(rows.some((r) => r.key === '/p0')).toBe(false)
  })

  test("another company's ids and bad keys are ignored", async () => {
    const { t, ids, as } = await setup()
    await as(ids.owner).mutation(api.navSearch.recordRecent, { kind: 'cage', key: ids.bC07 })
    await as(ids.owner).mutation(api.navSearch.recordRecent, { kind: 'batch', key: ids.tlB })
    await as(ids.owner).mutation(api.navSearch.recordRecent, { kind: 'cage', key: 'not-an-id' })
    await as(ids.owner).mutation(api.navSearch.recordRecent, { kind: 'page', key: 'https://evil.example' })
    expect(await t.run((ctx) => ctx.db.query('navRecents').take(10))).toEqual([])
    await expect(t.mutation(api.navSearch.recordRecent, { kind: 'page', key: '/x' })).rejects.toThrow()
  })

  test('drops deleted and out-of-scope entries at read time; per user', async () => {
    const { t, ids, as } = await setup()
    await as(ids.kpong).mutation(api.navSearch.recordRecent, { kind: 'cage', key: ids.c07 })
    await as(ids.kpong).mutation(api.navSearch.recordRecent, { kind: 'cage', key: ids.k01 })
    // C-07 is Akosombo: not shown to the Kpong-only member.
    expect((await as(ids.kpong).query(api.navSearch.recents, {})).map((r) => r.key)).toEqual([ids.k01])
    // Another member's recents are not mine.
    expect(await as(ids.staff).query(api.navSearch.recents, {})).toEqual([])
    await t.run((ctx) => ctx.db.delete(ids.k01))
    expect(await as(ids.kpong).query(api.navSearch.recents, {})).toEqual([])
    expect(await t.query(api.navSearch.recents, {})).toEqual([])
  })
})
