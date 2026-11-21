/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

/** Paper 53 bulk import: server-side row check and import of passing rows. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'Akosombo', active: true, updatedAt: now })
    const siteA2 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'Kpong', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'Main B', active: true, updatedAt: now })
    const user = (email: string, extra: Record<string, unknown>) => ctx.db.insert('users', { email, role: 'user', ...extra } as any)
    const adminA = await user('admin@a.com', { role: 'admin', companyId: companyA, activeLocationId: siteA })
    const staffA = await user('staff@a.com', { companyId: companyA, activeLocationId: siteA })
    const adminB = await user('admin@b.com', { role: 'admin', companyId: companyB, activeLocationId: siteB })
    await ctx.db.insert('feedTypes', {
      name: 'Grower 4mm', currentStock: 1000, minimumStock: 0, pricePerKg: 2, bagSizeKg: 25, active: true, companyId: companyA, updatedAt: now,
    })
    const cage = (name: string, companyId: any, locationId: any, status = 'active') =>
      ctx.db.insert('cages', {
        name, status, currentCount: 1000, initialCount: 1000, companyId, locationId, updatedAt: now,
      } as any)
    const cageA = await cage('C-01', companyA, siteA)
    await cage('C-02', companyA, siteA2)
    await cage('S-01', companyA, siteA, 'empty')
    await cage('B-01', companyB, siteB)
    for (const day of ['20', '21', '22', '23', '24', '25']) {
      await ctx.db.insert('dailyRecords', {
        cageId: cageA, date: `2026-10-${day}`, feedAmount: 0, feedPrice: 0, feedCost: 0, mortality: 2,
        companyId: companyA, locationId: siteA,
      })
    }
    return { companyA, siteA, siteA2, siteB, adminA, staffA, adminB, cageA }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

async function messageOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    const message = (err as Error).message
    try {
      const data = JSON.parse(message.slice(message.indexOf('{')))
      if (typeof data.message === 'string') return data.message.replace(/: [a-z_.]+$/, '')
    } catch {
      // plain Error
    }
    return message
  }
  return 'no error'
}

const DAILY = [
  { line: 2, date: '2026-11-01', cage: 'C-01', feed: '42', feedType: 'Grower 4mm', mortality: '2', doMgl: '6.1' },
  { line: 3, date: '2026-11-02', cage: 'C-01', feed: '40', feedType: 'Grower 4mm', mortality: '14' },
  { line: 4, date: '2026-11-03', cage: 'c-01', feed: '41', feedType: 'grower 4mm', mortality: '1', doMgl: '3.2' },
  { line: 5, date: '2026-11-01', cage: 'C-21', feed: '40', feedType: 'Grower 4mm', mortality: '0' },
  { line: 6, date: '2026-13-01', cage: 'C-01', feed: '40', feedType: 'Grower 4mm', mortality: '0' },
  { line: 7, date: '2026-11-04', cage: 'C-02', feed: '40', feedType: 'Grower 4mm', mortality: '0' },
  { line: 8, date: '2026-11-04', cage: 'B-01', feed: '40', feedType: 'Grower 4mm', mortality: '0' },
  { line: 9, date: '2026-10-25', cage: 'C-01', feed: '40', feedType: 'Grower 4mm', mortality: '0' },
]

describe('bulkImport.check', () => {
  test('marks rows OK, warning and error against real data', async () => {
    const s = await setup()
    const rows = await s.as(s.adminA).query(api.bulkImport.check, {
      kind: 'daily', locationId: s.siteA, today: '2026-11-15', rows: DAILY,
    })
    const byLine = Object.fromEntries(rows.map((r) => [r.line, r]))
    expect(byLine[2]).toMatchObject({ status: 'ok' })
    expect(byLine[3]).toMatchObject({ status: 'warning', field: 'mortality', reason: { code: 'mortalityOutlier', params: { times: 7 } } })
    expect(byLine[4]).toMatchObject({ status: 'warning', field: 'do', reason: { code: 'lowDo', params: { min: 4 } } })
    expect(byLine[5]).toMatchObject({ status: 'error', field: 'cage', reason: { code: 'cageNotAtSite', params: { value: 'C-21', site: 'Akosombo' } } })
    expect(byLine[6]).toMatchObject({ status: 'error', field: 'date', reason: { code: 'invalidDate' } })
    // Wrong site: C-02 is at Kpong; another company's cage is never found.
    expect(byLine[7]).toMatchObject({ status: 'error', field: 'cage', reason: { code: 'cageNotAtSite' } })
    expect(byLine[8]).toMatchObject({ status: 'error', field: 'cage', reason: { code: 'cageNotAtSite' } })
    expect(byLine[9]).toMatchObject({ status: 'error', field: 'date', reason: { code: 'alreadyRecorded' } })
  })

  test('future dates and feed beyond the store stock are errors', async () => {
    const s = await setup()
    const rows = await s.as(s.adminA).query(api.bulkImport.check, {
      kind: 'daily', locationId: s.siteA, today: '2026-11-15',
      rows: [
        { line: 2, date: '2026-11-20', cage: 'C-01', feed: '1', feedType: 'Grower 4mm' },
        { line: 3, date: '2026-11-05', cage: 'C-01', feed: '900', feedType: 'Grower 4mm' },
        { line: 4, date: '2026-11-06', cage: 'C-01', feed: '200', feedType: 'Grower 4mm' },
      ],
    })
    expect(rows.map((r) => r.reason?.code ?? r.status)).toEqual(['futureDate', 'ok', 'notEnoughStock'])
  })

  test('needs production.import', async () => {
    const s = await setup()
    expect(await messageOf(s.as(s.staffA).query(api.bulkImport.check, {
      kind: 'daily', locationId: s.siteA, today: '2026-11-15', rows: DAILY,
    }))).toBe('Insufficient permissions')
  })

  test("another company's site is refused", async () => {
    const s = await setup()
    expect(await messageOf(s.as(s.adminB).query(api.bulkImport.check, {
      kind: 'daily', locationId: s.siteA, today: '2026-11-15', rows: DAILY,
    }))).toBe('Site not found')
  })

  test('stocking rows follow the stocking rules', async () => {
    const s = await setup()
    const rows = await s.as(s.adminA).query(api.bulkImport.check, {
      kind: 'stocking', locationId: s.siteA, today: '2026-11-15',
      rows: [
        { line: 2, date: '2026-11-10', cage: 'S-01', fishCount: '5000', abw: '5' },
        { line: 3, date: '2026-11-10', cage: 'C-01', fishCount: '5000', abw: '5' },
        { line: 4, date: '2026-11-10', cage: 'S-01', fishCount: '5000', abw: '5' },
      ],
    })
    expect(rows.map((r) => r.reason?.code ?? r.status)).toEqual(['ok', 'stockStatus', 'duplicateRow'])
  })
})

describe('bulkImport.importRows', () => {
  test('imports OK and warning rows only, and a retry adds nothing', async () => {
    const s = await setup()
    const before = await s.t.run((ctx) => ctx.db.query('dailyRecords').collect())
    const res = await s.as(s.adminA).mutation(api.bulkImport.importRows, {
      kind: 'daily', locationId: s.siteA, rows: DAILY,
    })
    expect(res).toEqual({ imported: 3, skipped: 5 })
    const after = await s.t.run((ctx) => ctx.db.query('dailyRecords').collect())
    const added = after.filter((r) => !before.some((b) => b._id === r._id))
    expect(added.map((r) => r.date).sort()).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
    expect(added.find((r) => r.date === '2026-11-03')?.dissolvedOxygen).toBe(3.2)
    expect(added.every((r) => r.cageId === s.cageA)).toBe(true)

    const again = await s.as(s.adminA).mutation(api.bulkImport.importRows, {
      kind: 'daily', locationId: s.siteA, rows: DAILY,
    })
    expect(again.imported).toBe(0)
  })

  test('stocking import creates requests and is refused without production.import', async () => {
    const s = await setup()
    const rows = [{ line: 2, date: '2026-11-10', cage: 'S-01', fishCount: '5000', abw: '5' }]
    expect(await messageOf(s.as(s.staffA).mutation(api.bulkImport.importRows, {
      kind: 'stocking', locationId: s.siteA, rows,
    }))).toBe('Insufficient permissions')
    const res = await s.as(s.adminA).mutation(api.bulkImport.importRows, { kind: 'stocking', locationId: s.siteA, rows })
    expect(res.imported).toBe(1)
    const stockings = await s.t.run((ctx) => ctx.db.query('stockingHistory').collect())
    expect(stockings).toHaveLength(1)
    expect(stockings[0]).toMatchObject({ fishCount: 5000, initialAbw: 5, initialBiomass: 25 })
  })
})
