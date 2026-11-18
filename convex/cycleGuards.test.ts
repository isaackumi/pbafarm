/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

/**
 * Regression tests for doc 09 scenarios S5, S6 and S8: once a cage has been
 * restocked, edits to records from the earlier cycle must not move the cage.
 */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
    } as any)
    const userId = await ctx.db.insert('users', { email: 'admin@example.com', role: 'admin', companyId })
    const cageId = await ctx.db.insert('cages', {
      name: 'B2',
      status: 'active',
      currentCount: 10000,
      initialCount: 10000,
      stockingDate: '2026-05-01',
      companyId,
      updatedAt: Date.now(),
    } as any)
    const firstStocking = await ctx.db.insert('stockingHistory', {
      cageId,
      batchNumber: 'B2-2605',
      stockingDate: '2026-05-01',
      fishCount: 10000,
      initialAbw: 5,
      initialBiomass: 50,
      status: 'approved',
      companyId,
    } as any)
    return { companyId, userId, cageId, firstStocking }
  })
  return { t, as: t.withIdentity({ subject: `${ids.userId}|s` }), ...ids }
}

const harvest = (cageId: any, over: Record<string, unknown> = {}) => ({
  cageId,
  harvestDate: '2026-11-10',
  averageBodyWeight: 450,
  totalWeight: 4500,
  estimatedCount: 10000,
  fcr: 1.6,
  harvestType: 'complete' as const,
  status: 'completed' as const,
  ...over,
})

/** Put a second cycle in the cage, the way an approved stocking leaves it. */
async function restock(t: any, cageId: any, companyId: any) {
  return await t.run(async (ctx: any) => {
    const id = await ctx.db.insert('stockingHistory', {
      cageId,
      batchNumber: 'B2-2611',
      stockingDate: '2026-11-15',
      fishCount: 8000,
      initialAbw: 5,
      initialBiomass: 40,
      status: 'approved',
      companyId,
    })
    await ctx.db.patch(cageId, {
      status: 'active',
      currentCount: 8000,
      initialCount: 8000,
      stockingDate: '2026-11-15',
    })
    return id
  })
}

const getDoc = (t: any, id: any) => t.run((ctx: any) => ctx.db.get(id))

describe('S5: editing an old complete harvest after restocking', () => {
  test('changing its count or type leaves the new cycle alone', async () => {
    const { t, as, cageId, companyId, firstStocking } = await setup()
    const { id } = await as.mutation(api.harvest.create, harvest(cageId))
    const secondStocking = await restock(t, cageId, companyId)

    const res = await as.mutation(api.harvest.update, {
      id,
      patch: { estimatedCount: 9500, harvestType: 'partial' },
    })
    expect(res.warnings.join(' ')).toMatch(/restocked or harvested again/)

    const cage = await getDoc(t, cageId)
    expect(cage.status).toBe('active')
    expect(cage.currentCount).toBe(8000)
    expect((await getDoc(t, secondStocking)).closedAt).toBeUndefined()
    expect((await getDoc(t, firstStocking)).closedAt).toBe('2026-11-10')
    // The record itself is corrected.
    expect((await getDoc(t, id)).estimatedCount).toBe(9500)
  })

  test('deleting it leaves the new cycle alone', async () => {
    const { t, as, cageId, companyId, firstStocking } = await setup()
    const { id } = await as.mutation(api.harvest.create, harvest(cageId))
    const secondStocking = await restock(t, cageId, companyId)

    const res = await as.mutation(api.harvest.remove, { id })
    expect(res.warnings.join(' ')).toMatch(/restocked/)
    const cage = await getDoc(t, cageId)
    expect(cage.status).toBe('active')
    expect(cage.currentCount).toBe(8000)
    expect((await getDoc(t, secondStocking)).closedAt).toBeUndefined()
    expect((await getDoc(t, firstStocking)).closedAt).toBe('2026-11-10')
  })

  test('before restocking, edits and deletes still re-post against the cage', async () => {
    const { t, as, cageId, firstStocking } = await setup()
    const { id } = await as.mutation(api.harvest.create, harvest(cageId))
    await as.mutation(api.harvest.remove, { id })
    const cage = await getDoc(t, cageId)
    expect(cage.status).toBe('active')
    expect(cage.currentCount).toBe(10000)
    expect((await getDoc(t, firstStocking)).closedAt).toBeUndefined()
  })
})

describe('S6: deleting an old partial harvest after the cycle ended', () => {
  test('does not add its fish to the next cycle', async () => {
    const { t, as, cageId, companyId } = await setup()
    const partial = await as.mutation(
      api.harvest.create,
      harvest(cageId, {
        harvestDate: '2026-08-01',
        harvestType: 'partial',
        status: 'in_progress',
        estimatedCount: 3000,
      }),
    )
    expect((await getDoc(t, cageId)).currentCount).toBe(7000)
    await as.mutation(api.harvest.create, harvest(cageId, { estimatedCount: 7000 }))
    await restock(t, cageId, companyId)

    await as.mutation(api.harvest.remove, { id: partial.id })
    expect((await getDoc(t, cageId)).currentCount).toBe(8000)

    // Editing it is record-only too.
    const partial2 = await as.mutation(
      api.harvest.create,
      harvest(cageId, {
        harvestDate: '2026-11-20',
        harvestType: 'partial',
        status: 'in_progress',
        estimatedCount: 1000,
      }),
    )
    expect((await getDoc(t, cageId)).currentCount).toBe(7000)
    // A partial harvest in the current cycle still re-posts on edit.
    await as.mutation(api.harvest.update, { id: partial2.id, patch: { estimatedCount: 500 } })
    expect((await getDoc(t, cageId)).currentCount).toBe(7500)
  })
})

describe('S8: editing daily records from an earlier cycle', () => {
  async function daily(t: any, cageId: any, companyId: any, date: string, mortality: number) {
    return await t.run((ctx: any) =>
      ctx.db.insert('dailyRecords', {
        cageId,
        date,
        feedAmount: 0,
        feedPrice: 0,
        feedCost: 0,
        mortality,
        companyId,
      }),
    )
  }

  test('mortality edits and deletes on an old-cycle record leave the live count alone', async () => {
    const { t, as, cageId, companyId } = await setup()
    const old = await daily(t, cageId, companyId, '2026-06-01', 100)
    await as.mutation(api.harvest.create, harvest(cageId, { estimatedCount: 9900 }))
    await restock(t, cageId, companyId)

    const edit = await as.mutation(api.dailyRecords.update, { id: old, patch: { mortality: 300 } })
    expect((await getDoc(t, cageId)).currentCount).toBe(8000)
    expect((await getDoc(t, old)).mortality).toBe(300)
    expect(edit.warnings.join(' ')).toMatch(/earlier cycle/)

    const del = await as.mutation(api.dailyRecords.remove, { id: old })
    expect((await getDoc(t, cageId)).currentCount).toBe(8000)
    expect(del.warnings.join(' ')).toMatch(/earlier cycle/)
  })

  test('records in the current cycle still move the live count', async () => {
    const { t, as, cageId, companyId } = await setup()
    await restock(t, cageId, companyId)
    const rec = await daily(t, cageId, companyId, '2026-11-20', 50)
    await t.run((ctx: any) => ctx.db.patch(cageId, { currentCount: 7950 }))

    const edit = await as.mutation(api.dailyRecords.update, { id: rec, patch: { mortality: 80 } })
    expect((await getDoc(t, cageId)).currentCount).toBe(7920)
    expect(edit.warnings).toEqual([])

    // Moving the record back into the old cycle gives its deaths back to this one.
    await as.mutation(api.dailyRecords.update, { id: rec, patch: { date: '2026-10-01' } })
    expect((await getDoc(t, cageId)).currentCount).toBe(8000)

    await as.mutation(api.dailyRecords.update, { id: rec, patch: { date: '2026-11-21' } })
    expect((await getDoc(t, cageId)).currentCount).toBe(7920)
    await as.mutation(api.dailyRecords.remove, { id: rec })
    expect((await getDoc(t, cageId)).currentCount).toBe(8000)
  })
})
