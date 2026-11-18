/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
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
      email: 'field@example.com',
      role: 'user',
      companyId,
    })
    const cage = (name: string, cid = companyId) =>
      ctx.db.insert('cages', {
        name,
        status: 'active',
        currentCount: 1000,
        initialCount: 1000,
        companyId: cid,
        updatedAt: Date.now(),
      } as any)
    return {
      userId,
      a: await cage('A1'),
      b: await cage('A2'),
      foreign: await cage('X1', otherCompanyId),
    }
  })
  const as = t.withIdentity({ subject: `${ids.userId}|s` })
  return { t, as, ...ids }
}

describe('biweeklyRecords.createBatch', () => {
  test('saves one sample per cage, computes ABW and updates the cage', async () => {
    const { t, as, a, b } = await setup()
    const ids = await as.mutation(api.biweeklyRecords.createBatch, {
      date: '2026-06-15',
      records: [
        { cageId: a, totalFishCount: 50, totalWeight: 5000 },
        { cageId: b, totalFishCount: 40, totalWeight: 6000, dissolvedOxygen: 5.5 },
      ],
    })
    expect(ids).toHaveLength(2)
    await t.run(async (ctx) => {
      const rows = await Promise.all(ids.map((id) => ctx.db.get(id)))
      expect(rows[0]!.averageBodyWeight).toBe(100)
      expect(rows[1]!.averageBodyWeight).toBe(150)
      expect(rows[1]!.dissolvedOxygen).toBe(5.5)
      expect(rows[0]!.batchCode).toMatch(/^BW260615\d{4}$/)
      expect(rows[0]!.batchCode).not.toBe(rows[1]!.batchCode)
      const samples = await ctx.db.query('biweeklySampling').collect()
      expect(samples).toHaveLength(2)
    })
  })

  test('rejects a foreign cage and writes nothing', async () => {
    const { t, as, a, foreign } = await setup()
    await expect(
      as.mutation(api.biweeklyRecords.createBatch, {
        date: '2026-06-15',
        records: [
          { cageId: a, totalFishCount: 50, totalWeight: 5000 },
          { cageId: foreign, totalFishCount: 50, totalWeight: 5000 },
        ],
      }),
    ).rejects.toThrow(/not found/)
    await t.run(async (ctx) => {
      expect(await ctx.db.query('biweeklyRecords').collect()).toHaveLength(0)
    })
  })

  test('rejects duplicate cages, zero counts and bad dates', async () => {
    const { as, a } = await setup()
    await expect(
      as.mutation(api.biweeklyRecords.createBatch, {
        date: '2026-06-15',
        records: [
          { cageId: a, totalFishCount: 50, totalWeight: 5000 },
          { cageId: a, totalFishCount: 50, totalWeight: 5000 },
        ],
      }),
    ).rejects.toThrow()
    await expect(
      as.mutation(api.biweeklyRecords.createBatch, {
        date: '2026-06-15',
        records: [{ cageId: a, totalFishCount: 0, totalWeight: 5000 }],
      }),
    ).rejects.toThrow()
    await expect(
      as.mutation(api.biweeklyRecords.createBatch, {
        date: 'yesterday',
        records: [{ cageId: a, totalFishCount: 5, totalWeight: 5000 }],
      }),
    ).rejects.toThrow()
  })
})
