/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

async function setup(role: 'user' | 'admin' = 'admin') {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
    } as any)
    const otherCompanyId = await ctx.db.insert('companies', {
      name: 'Other Farm',
      code: 'OTHR',
      status: 'approved',
      createdAt: Date.now(),
    } as any)
    const userId = await ctx.db.insert('users', {
      email: 'manager@example.com',
      role,
      companyId,
    })
    const cageId = await ctx.db.insert('cages', {
      name: 'B2',
      status: 'active',
      currentCount: 10000,
      initialCount: 10000,
      stockingDate: '2026-05-01',
      companyId,
      updatedAt: Date.now(),
    } as any)
    const otherCageId = await ctx.db.insert('cages', {
      name: 'X1',
      status: 'active',
      currentCount: 5000,
      companyId: otherCompanyId,
      updatedAt: Date.now(),
    } as any)
    const stockingId = await ctx.db.insert('stockingHistory', {
      cageId,
      batchNumber: 'B2-2605',
      stockingDate: '2026-05-01',
      fishCount: 10000,
      initialAbw: 5,
      initialBiomass: 50,
      status: 'approved',
      companyId,
    } as any)
    return { companyId, userId, cageId, otherCageId, stockingId }
  })
  const as = t.withIdentity({ subject: `${ids.userId}|session` })
  return { t, as, ...ids }
}

const harvestArgs = (cageId: any, over: Record<string, unknown> = {}) => ({
  cageId,
  harvestDate: '2026-11-10',
  averageBodyWeight: 450,
  totalWeight: 4410,
  estimatedCount: 9800,
  fcr: 1.6,
  harvestType: 'complete' as const,
  status: 'completed' as const,
  ...over,
})

describe('harvest and the cage', () => {
  test('a complete harvest empties the cage, marks it harvested and closes the cycle', async () => {
    const { t, as, cageId, stockingId } = await setup()
    const { id, warnings } = await as.mutation(api.harvest.create, harvestArgs(cageId))

    const cage = await t.run((ctx) => ctx.db.get(cageId))
    expect(cage?.currentCount).toBe(0)
    expect(cage?.status).toBe('harvested')
    const stocking = await t.run((ctx) => ctx.db.get(stockingId))
    expect(stocking?.closedAt).toBe('2026-11-10')
    // 10,000 on record vs 9,800 harvested
    expect(warnings.join(' ')).toMatch(/200 fish on record/)

    await as.mutation(api.harvest.remove, { id })
    const restored = await t.run((ctx) => ctx.db.get(cageId))
    expect(restored?.currentCount).toBe(10000)
    expect(restored?.status).toBe('active')
    const reopened = await t.run((ctx) => ctx.db.get(stockingId))
    expect(reopened?.closedAt).toBeUndefined()
  })

  test('a partial harvest subtracts fish, re-posts on edit and restores on delete', async () => {
    const { t, as, cageId } = await setup()
    const { id } = await as.mutation(
      api.harvest.create,
      harvestArgs(cageId, { harvestType: 'partial', status: 'in_progress', estimatedCount: 3000 }),
    )
    expect((await t.run((ctx) => ctx.db.get(cageId)))?.currentCount).toBe(7000)
    expect((await t.run((ctx) => ctx.db.get(cageId)))?.status).toBe('active')

    await as.mutation(api.harvest.update, { id, patch: { estimatedCount: 2500 } })
    expect((await t.run((ctx) => ctx.db.get(cageId)))?.currentCount).toBe(7500)

    await as.mutation(api.harvest.remove, { id })
    expect((await t.run((ctx) => ctx.db.get(cageId)))?.currentCount).toBe(10000)
  })

  test('switching a partial harvest to complete closes the cage', async () => {
    const { t, as, cageId } = await setup()
    const { id } = await as.mutation(
      api.harvest.create,
      harvestArgs(cageId, { harvestType: 'partial', status: 'in_progress', estimatedCount: 3000 }),
    )
    await as.mutation(api.harvest.update, {
      id,
      patch: { harvestType: 'complete', status: 'completed', estimatedCount: 10000 },
    })
    const cage = await t.run((ctx) => ctx.db.get(cageId))
    expect(cage?.currentCount).toBe(0)
    expect(cage?.status).toBe('harvested')
  })

  test("another company's cage cannot be harvested", async () => {
    const { t, as, otherCageId } = await setup()
    await expect(as.mutation(api.harvest.create, harvestArgs(otherCageId))).rejects.toThrow(
      /Cage not found/,
    )
    expect((await t.run((ctx) => ctx.db.get(otherCageId)))?.currentCount).toBe(5000)
  })
})
