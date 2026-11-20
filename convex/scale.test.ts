/// <reference types="vite/client" />
/**
 * PLAT-001: a company's results do not depend on other companies' data.
 *
 * Company A's view is captured twice: once with company B empty, once with B
 * holding more rows than any read cap the old code had (listForDate 500,
 * reminders 2000 daily rows / 5000 users / 1000 companies, pending approvals
 * 100, growthAll 300, audit getByTable 200). B's rows are written so they sit
 * where the old cross-tenant windows read first (earlier in `by_date` /
 * `by_status`, newer in the audit log). Every A result must be identical.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

/**
 * Ids replaced by their order of first appearance: convex-test numbers
 * documents with one counter across tables, so A's ids differ when B's rows
 * are inserted too. Structure and values must still match exactly.
 */
function canonicalIds(value: unknown): unknown {
  const seen = new Map<string, string>()
  const isId = (x: string) => /^\d{5,};?[A-Za-z_]+$/.test(x)
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string' && isId(x)) {
      if (!seen.has(x)) seen.set(x, `id#${seen.size}`)
      return seen.get(x)
    }
    if (Array.isArray(x)) return x.map(walk)
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    return x
  }
  return walk(value)
}
const DATE = '2026-11-18'
const PAST = '2026-11-01'
const now = 1_763_000_000_000

const daily = (cageId: any, companyId: any, date: string, feed = 10, mortality = 0) => ({
  cageId, date, feedAmount: feed, feedPrice: 2, feedCost: feed * 2, mortality, companyId,
})

/** Builds company A, and company B (heavy or empty) around it. */
async function seed(heavyB: boolean) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', {
        name, code, status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
      })
    // A first: its audit rows are the OLDEST, so a newest-N global window misses them.
    const a = await company('Lake A', 'LKA')
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: a })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: a })
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert('auditLogs', { userId: adminA, actionType: 'update', tableName: 'cages', recordId: `a-${i}`, companyId: a })
    }

    const b = await company('Big B', 'BIGB')
    if (heavyB) {
      const bUser = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: b })
      const bCages = []
      for (let i = 0; i < 310; i++) {
        bCages.push(await ctx.db.insert('cages', { name: `B${i}`, status: 'active', companyId: b, updatedAt: now }))
      }
      for (let i = 0; i < 2100; i++) {
        await ctx.db.insert('dailyRecords', daily(bCages[i % bCages.length], b, DATE))
      }
      for (let i = 0; i < 5001; i++) {
        await ctx.db.insert('users', { email: `u${i}@b.com`, role: 'user', companyId: b })
      }
      const bStock = await ctx.db.insert('stockingHistory', {
        cageId: bCages[0], batchNumber: 'B0-1', stockingDate: PAST, fishCount: 100,
        initialAbw: 5, initialBiomass: 0.5, status: 'approved', companyId: b,
      })
      for (let i = 0; i < 110; i++) {
        await ctx.db.insert('stockingHistory', {
          cageId: bCages[i], batchNumber: `B-${i}`, stockingDate: DATE, fishCount: 100,
          initialAbw: 5, initialBiomass: 0.5, status: 'pending_approval', companyId: b,
        })
        await ctx.db.insert('topupHistory', {
          stockingId: bStock, topupDate: DATE, fishCount: 10, abw: 5, status: 'pending_approval', companyId: b,
        })
        await ctx.db.insert('fishTransfers', {
          sourceCageId: bCages[i], destinationCageId: bCages[i + 1], transferDate: DATE, quantity: 1,
          abw: 5, biomass: 0.005, transferType: 'partial', status: 'pending_approval', companyId: b, updatedAt: now,
        })
      }
      for (let i = 0; i < 250; i++) {
        await ctx.db.insert('auditLogs', { userId: bUser, actionType: 'update', tableName: 'cages', recordId: `b-${i}`, companyId: b })
      }
      for (let i = 0; i < 50; i++) {
        await ctx.db.insert('biweeklyRecords', {
          cageId: bCages[i], date: DATE, batchCode: `BW-B-${i}`, averageBodyWeight: 100,
          totalFishCount: 100, totalWeight: 10, companyId: b, updatedAt: now,
        })
        const h = await ctx.db.insert('harvestRecords', {
          cageId: bCages[i], harvestDate: DATE, averageBodyWeight: 300, totalWeight: 100,
          estimatedCount: 300, fcr: 1.5, companyId: b,
        })
        await ctx.db.insert('sales', {
          harvestId: h, cageId: bCages[i], saleDate: DATE, weightKg: 50, pricePerKg: 20,
          totalAmount: 1000, companyId: b, updatedAt: now,
        })
        await ctx.db.insert('healthTreatments', {
          cageId: bCages[i], date: DATE, treatment: 'salt bath', withdrawalUntil: '2026-12-31',
          companyId: b, updatedAt: now,
        })
      }
      // More approved companies than one digest page; the last one has a
      // user and an unlogged cage, so it should get a reminder.
      let last = b
      for (let i = 0; i < 60; i++) {
        last = await company(`Filler ${i}`, `F${i}`)
      }
      await ctx.db.insert('users', { email: 'last@filler.com', role: 'user', companyId: last })
      await ctx.db.insert('cages', { name: 'L1', status: 'active', companyId: last, updatedAt: now })
    }

    // The rest of A, after B: its rows come last in by_date / by_status.
    const cage = (name: string, status: 'active' | 'harvested') =>
      ctx.db.insert('cages', {
        name, status, companyId: a, updatedAt: now, initialCount: 1000, currentCount: 950,
        initialAbw: 5, stockingDate: PAST,
      })
    const a1 = await cage('A1', 'active')
    const a2 = await cage('A2', 'active')
    const a3 = await cage('A3', 'harvested')
    await ctx.db.insert('dailyRecords', daily(a1, a, DATE, 12, 1))
    await ctx.db.insert('dailyRecords', daily(a1, a, PAST, 8, 2))
    await ctx.db.insert('dailyRecords', daily(a2, a, PAST, 9, 0))
    const stock = await ctx.db.insert('stockingHistory', {
      cageId: a1, batchNumber: 'A1-20261101', stockingDate: PAST, fishCount: 1000,
      initialAbw: 5, initialBiomass: 5, status: 'approved', companyId: a,
    })
    await ctx.db.insert('stockingHistory', {
      cageId: a2, batchNumber: 'A2-20261118', stockingDate: DATE, fishCount: 500,
      initialAbw: 5, initialBiomass: 2.5, status: 'pending_approval', companyId: a,
    })
    await ctx.db.insert('topupHistory', {
      stockingId: stock, topupDate: DATE, fishCount: 50, abw: 6, status: 'pending_approval', companyId: a,
    })
    await ctx.db.insert('fishTransfers', {
      sourceCageId: a1, destinationCageId: a2, transferDate: DATE, quantity: 10, abw: 6,
      biomass: 0.06, transferType: 'partial', status: 'pending_approval', companyId: a, updatedAt: now,
    })
    await ctx.db.insert('biweeklyRecords', {
      cageId: a1, date: PAST, batchCode: 'BW-A-1', averageBodyWeight: 20, totalFishCount: 100,
      totalWeight: 2, companyId: a, updatedAt: now,
    })
    await ctx.db.insert('biweeklyRecords', {
      cageId: a1, date: DATE, batchCode: 'BW-A-2', averageBodyWeight: 40, totalFishCount: 100,
      totalWeight: 4, companyId: a, updatedAt: now,
    })
    const harvest = await ctx.db.insert('harvestRecords', {
      cageId: a3, harvestDate: PAST, averageBodyWeight: 350, totalWeight: 200,
      estimatedCount: 570, fcr: 1.4, companyId: a,
    })
    await ctx.db.insert('sales', {
      harvestId: harvest, cageId: a3, saleDate: PAST, weightKg: 150, pricePerKg: 25,
      totalAmount: 3750, companyId: a, updatedAt: now,
    })
    await ctx.db.insert('healthTreatments', {
      cageId: a1, date: PAST, treatment: 'oxytetracycline', withdrawalUntil: '2026-11-30',
      companyId: a, updatedAt: now,
    })
    await ctx.db.insert('feedTypes', {
      name: 'Grower 4mm', currentStock: 50, minimumStock: 200, pricePerKg: 10, active: true,
      companyId: a, updatedAt: now,
    })
    return { a, adminA, staffA, cages: [a1, a2, a3] }
  })
  return { t, ...ids }
}

/** Replace ids by first-appearance order and drop per-run fields. */
function normalize(value: unknown) {
  const ids = new Map<string, string>()
  const walk = (v: any): any => {
    if (typeof v === 'string' && /^\d+;[A-Za-z_]+$/.test(v)) {
      if (!ids.has(v)) ids.set(v, `id${ids.size}`)
      return ids.get(v)
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        if (['_creationTime', 'created_at', 'createdAt', 'continueCursor', 'splitCursor', 'pageStatus'].includes(k)) continue
        out[k] = walk(x)
      }
      return out
    }
    return v
  }
  return walk(value)
}

async function viewOfA(t: any, adminA: any, cages: any[]) {
  const as = t.withIdentity({ subject: `${adminA}|s` })
  const page = { numItems: 50, cursor: null }
  const range = { dateFrom: '2026-10-01', dateTo: DATE }
  return normalize({
    dashboardSummary: await as.query(api.reports.dashboardSummary, { asOf: DATE }),
    dashboardKpis: await as.query(api.reports.dashboardKpis, { asOf: DATE }),
    exportBundle: await as.query(api.reports.exportBundle, range),
    productionReport: await as.query(api.reports.productionReport, {
      reportType: 'summary', startDate: '2026-10-01', endDate: DATE, cageIds: cages,
    }),
    listCagePnL: await as.query(api.reports.listCagePnL, {}),
    cagePnL: await as.query(api.reports.getCagePnL, { cageId: cages[2] }),
    farmContextForAi: await as.query(api.reports.farmContextForAi, { asOf: DATE }),
    dailyList: await as.query(api.dailyRecords.list, {}),
    dailyListForDate: await as.query(api.dailyRecords.listForDate, { date: DATE }),
    dailyPage: await as.query(api.dailyRecords.listPage, { paginationOpts: page }),
    pending: await as.query(api.stocking.listPendingApprovals, {}),
    stockings: await as.query(api.stocking.listStockingHistory, {}),
    stockingsPage: await as.query(api.stocking.listStockingHistoryPage, { paginationOpts: page }),
    auditByTable: await as.query(api.audit.getByTable, { tableName: 'cages' }),
    auditList: await as.query(api.audit.list, { tableName: 'cages' }),
    auditPage: await as.query(api.audit.listPage, { paginationOpts: page }),
    growthAll: await as.query(api.cages.growthAll, { asOf: DATE }),
    cagesList: await as.query(api.cages.list, {}),
    harvests: await as.query(api.harvest.list, {}),
    harvestPage: await as.query(api.harvest.listPage, { paginationOpts: page }),
    sales: await as.query(api.sales.listSales, {}),
    salesPage: await as.query(api.sales.listSalesPage, { paginationOpts: page }),
    biweekly: await as.query(api.biweeklyRecords.list, {}),
    biweeklyPage: await as.query(api.biweeklyRecords.listPage, { paginationOpts: page }),
    transfers: await as.query(api.fishTransfers.listFishTransfers, {}),
    transfersPage: await as.query(api.fishTransfers.listFishTransfersPage, { paginationOpts: page }),
    withdrawals: await as.query(api.health.activeWithdrawals, { asOf: DATE }),
    feedTypes: await as.query(api.feed.listFeedTypes, {}),
    users: await as.query(api.users.list, {}),
    batchNumber: await as.query(api.stocking.suggestBatchNumber, { cageId: cages[0], stockingDate: PAST }),
  })
}

async function remindersOfA(t: any, adminA: any, staffA: any) {
  await t.mutation(internal.reminders.dailyDigest, { date: DATE })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const notes = await t.run(async (ctx: any) => {
    const out = []
    for (const userId of [adminA, staffA]) {
      const rows = await ctx.db
        .query('notifications')
        .withIndex('by_user', (q: any) => q.eq('userId', userId))
        .collect()
      out.push(rows.map((n: any) => ({ title: n.title, message: n.message })))
    }
    return out
  })
  return notes
}

describe('company A is unaffected by company B (PLAT-001)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('queries return identical results whether B is empty or larger than every old cap', async () => {
    // One convex-test instance at a time: read each before building the next.
    const empty = await seed(false)
    const before = await viewOfA(empty.t, empty.adminA, empty.cages)
    const heavy = await seed(true)
    const after = await viewOfA(heavy.t, heavy.adminA, heavy.cages)
    expect(canonicalIds(after)).toEqual(canonicalIds(before))

    // Sanity: the fixture really exercises what it claims.
    const v = before as any
    expect(v.dailyListForDate).toHaveLength(1)
    expect(v.pending.all.map((r: any) => r.type).sort()).toEqual(['fish_transfer', 'stocking', 'topup'])
    expect(v.auditByTable).toHaveLength(3)
    expect(v.growthAll.cages).toHaveLength(2)
    expect(v.dashboardSummary.recent_feed_usage_kg).toBe(29)
    expect(v.dailyPage.page).toHaveLength(3)
  }, 120_000)

  test('reminders for A are identical whether B is empty or large', async () => {
    const empty = await seed(false)
    const before = await remindersOfA(empty.t, empty.adminA, empty.staffA)
    const heavy = await seed(true)
    const after = await remindersOfA(heavy.t, heavy.adminA, heavy.staffA)
    expect(canonicalIds(after)).toEqual(canonicalIds(before))
    // A1 is logged for DATE; only A2 is missing. Low stock goes to the admin.
    expect(before[1]).toEqual([
      {
        title: 'Daily entry missing for 1 cage',
        message: `No feed or mortality logged on ${DATE} for A2 (1 of 2 done).`,
      },
    ])
    expect(before[0].map((n: any) => n.title).sort()).toEqual([
      'Daily entry missing for 1 cage',
      'Low feed stock: 1 feed type',
    ])
  }, 120_000)

  test('the digest reaches every approved company across pages', async () => {
    const heavy = await seed(true)
    await heavy.t.mutation(internal.reminders.dailyDigest, { date: DATE })
    await heavy.t.finishAllScheduledFunctions(vi.runAllTimers)
    // The last of 62 approved companies (second digest page) is reached.
    const lastNotes = await heavy.t.run(async (ctx: any) => {
      const last = await ctx.db
        .query('users')
        .withIndex('email', (q: any) => q.eq('email', 'last@filler.com'))
        .first()
      return ctx.db
        .query('notifications')
        .withIndex('by_user', (q: any) => q.eq('userId', last._id))
        .collect()
    })
    expect(lastNotes.map((n: any) => n.title)).toEqual(['Daily entry missing for 1 cage'])
  }, 120_000)
})
