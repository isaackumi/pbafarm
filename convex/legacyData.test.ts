/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

/** Two sites, a feed type and legacy one-row transfers in the shape the old createTransfer wrote. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'PBA', code: 'PBA', status: 'approved', createdAt: now })
    const user = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const siteA = await ctx.db.insert('farmLocations', { name: 'A', active: true, companyId, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { name: 'B', active: true, companyId, updatedAt: now })
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 100, minimumStock: 0, pricePerKg: 10, active: true, updatedAt: now, companyId,
    })
    const legacy = async (from: string, to: string, withAudit: boolean, qty = 40) => {
      const id = await ctx.db.insert('feedInventoryTransactions', {
        feedTypeId,
        transactionType: 'transfer',
        quantityKg: qty,
        transactionDate: now,
        notes: `Transfer ${qty} kg from ${from} → ${to}`,
        locationId: to === 'A' ? siteA : siteB,
        companyId,
        createdBy: user,
      })
      if (withAudit) {
        await ctx.db.insert('auditLogs', {
          userId: user,
          actionType: 'transfer',
          tableName: 'feedInventory',
          recordId: id,
          newValues: {
            feedTypeId,
            quantityKg: qty,
            fromLocationId: from === 'A' ? siteA : siteB,
            toLocationId: to === 'A' ? siteA : siteB,
          },
          companyId,
        })
      }
      return id
    }
    const known = await legacy('A', 'B', true)
    const orphan = await legacy('B', 'A', false, 5)
    await ctx.db.insert('feedInventoryTransactions', {
      feedTypeId, transactionType: 'purchase', quantityKg: 100, transactionDate: now, locationId: siteA, companyId,
    })
    return { companyId, siteA, siteB, feedTypeId, known, orphan }
  })
  return { t, ...ids }
}

async function ledger(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query('feedInventoryTransactions').collect())
}

describe('M16 legacy transfer conversion', () => {
  test('dry run (the default) reports and writes nothing', async () => {
    const { t, known, orphan } = await setup()
    const before = await ledger(t)
    const r = await t.mutation(internal.legacyData.m16ConvertLegacyTransfers, {})
    expect(r.dryRun).toBe(true)
    expect(r.converted.map((c) => c.transactionId)).toEqual([known])
    expect(r.unresolved).toEqual([expect.objectContaining({ transactionId: orphan, reason: expect.stringMatching(/no audit/) })])
    expect(await ledger(t)).toEqual(before)
  })

  test('converts a row with a known source into two legs, leaves the rest, and is idempotent', async () => {
    const { t, known, orphan, siteA, siteB } = await setup()
    const r = await t.mutation(internal.legacyData.m16ConvertLegacyTransfers, { dryRun: false })
    expect(r.isDone).toBe(true)
    const rows = await ledger(t)
    const legs = rows.filter((x) => x.transferId === String(known))
    expect(legs).toHaveLength(2)
    expect(legs.find((x) => x.transactionType === 'transfer_out')).toMatchObject({ quantityKg: -40, locationId: siteA })
    expect(legs.find((x) => x.transactionType === 'transfer_in')).toMatchObject({ _id: known, quantityKg: 40, locationId: siteB })
    expect(rows.find((x) => x._id === orphan)?.transactionType).toBe('transfer')
    const audit = await t.run((ctx) =>
      ctx.db.query('auditLogs').withIndex('by_table', (q) => q.eq('tableName', 'feedInventoryTransactions')).collect(),
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ recordId: known, actionType: 'migration', previousValues: { transactionType: 'transfer' } })

    const again = await t.mutation(internal.legacyData.m16ConvertLegacyTransfers, { dryRun: false })
    expect(again.converted).toHaveLength(0)
    expect(await ledger(t)).toEqual(rows)
  })

  test('walks the table in batches with the cursor', async () => {
    const { t, known } = await setup()
    let cursor: string | null = null
    const converted: string[] = []
    for (let i = 0; i < 10; i++) {
      const r: any = await t.mutation(internal.legacyData.m16ConvertLegacyTransfers, { dryRun: false, batchSize: 1, cursor })
      converted.push(...r.converted.map((c: any) => c.transactionId))
      if (r.isDone) break
      cursor = r.continueCursor
    }
    expect(converted).toEqual([known])
  })

  test('an audit row that disagrees with the ledger row is not trusted', async () => {
    const { t, known } = await setup()
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('auditLogs').collect()).find((a) => a.recordId === known)!
      await ctx.db.patch(row._id, { newValues: { ...row.newValues, quantityKg: 99 } })
    })
    const r = await t.mutation(internal.legacyData.m16ConvertLegacyTransfers, { dryRun: false })
    expect(r.converted).toHaveLength(0)
    expect(r.unresolved.map((u) => u.transactionId)).toContain(known)
  })
})

describe('M10 narrow verification', () => {
  test('ready only when no tenant row lacks companyId', async () => {
    const { t, companyId } = await setup()
    const ok = await t.query(internal.legacyData.m10VerifyNarrowReady, {})
    expect(ok.ready).toBe(true)
    expect(ok.blockers).toEqual([])

    await t.run(async (ctx) => {
      await ctx.db.insert('cages', { name: 'Legacy', status: 'active', updatedAt: Date.now() })
      await ctx.db.insert('notifications', { userId: (await ctx.db.query('users').first())!._id, title: 't', message: 'm', read: false })
      await ctx.db.insert('users', { email: 'x@x.com', role: 'user' })
    })
    const blocked = await t.query(internal.legacyData.m10VerifyNarrowReady, {})
    expect(blocked.ready).toBe(false)
    expect(blocked.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/^cages/), expect.stringMatching(/^notifications/)]))
    expect(blocked.users.companylessNonSuperAdmins).toBe(1)

    // After M1 assigns them, the check passes again.
    await t.mutation(internal.migrations.assignUnscopedToCompany, { name: 'PBA', code: 'PBA', dryRun: false })
    const after = await t.query(internal.legacyData.m10VerifyNarrowReady, {})
    expect(after.ready).toBe(true)
    expect(companyId).toBeTruthy()
  })
})
