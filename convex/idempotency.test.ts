/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { IDEMPOTENCY_RETENTION_MS } from './lib/idempotency'

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
    const userId = await ctx.db.insert('users', {
      email: 'field@example.com',
      role: 'user',
      companyId,
    })
    const otherUserId = await ctx.db.insert('users', {
      email: 'field2@example.com',
      role: 'user',
      companyId,
    })
    const cageId = await ctx.db.insert('cages', {
      name: 'A1',
      status: 'active',
      currentCount: 1000,
      initialCount: 1000,
      initialAbw: 5,
      stockingDate: '2026-05-01',
      companyId,
      updatedAt: Date.now(),
    } as any)
    await ctx.db.insert('stockingHistory', {
      cageId,
      batchNumber: 'A1-2605',
      stockingDate: '2026-05-01',
      fishCount: 1000,
      initialAbw: 5,
      initialBiomass: 5,
      status: 'approved',
      companyId,
    } as any)
    return { userId, otherUserId, cageId }
  })
  return {
    t,
    as: t.withIdentity({ subject: `${ids.userId}|s` }),
    asOther: t.withIdentity({ subject: `${ids.otherUserId}|s` }),
    ...ids,
  }
}

const sampling = (cageId: any, clientMutationId?: string) => ({
  date: '2026-06-15',
  records: [{ cageId, totalFishCount: 50, totalWeight: 5000 }],
  ...(clientMutationId ? { clientMutationId } : {}),
})

describe('idempotent field writes', () => {
  test('a retried bi-weekly batch returns the first result and writes once', async () => {
    const { t, as, cageId } = await setup()
    const first = await as.mutation(api.biweeklyRecords.createBatch, sampling(cageId, 'cm-1'))
    const again = await as.mutation(api.biweeklyRecords.createBatch, sampling(cageId, 'cm-1'))
    expect(again).toEqual(first)
    await t.run(async (ctx) => {
      expect(await ctx.db.query('biweeklyRecords').collect()).toHaveLength(1)
      expect(await ctx.db.query('idempotencyKeys').collect()).toHaveLength(1)
    })
    // A new key is a new entry.
    await as.mutation(api.biweeklyRecords.createBatch, sampling(cageId, 'cm-2'))
    await t.run(async (ctx) => {
      expect(await ctx.db.query('biweeklyRecords').collect()).toHaveLength(2)
    })
  })

  test('a retried daily batch (lost response) does not double mortality', async () => {
    const { t, as, cageId } = await setup()
    const args = {
      date: '2026-06-02',
      records: [{ cageId, feedAmount: 0, mortality: 7 }],
      clientMutationId: 'daily-1',
    }
    const first = await as.mutation(api.dailyRecords.createBatch, args)
    // Without the key the second call would fail "already exists".
    const again = await as.mutation(api.dailyRecords.createBatch, args)
    expect(again).toEqual(first)
    await t.run(async (ctx) => {
      expect(await ctx.db.query('dailyRecords').collect()).toHaveLength(1)
      expect((await ctx.db.get(cageId))!.currentCount).toBe(993)
    })
  })

  test('keys are per user and per mutation; failures are not remembered', async () => {
    const { t, as, asOther, cageId } = await setup()
    await as.mutation(api.biweeklyRecords.createBatch, sampling(cageId, 'shared'))
    await asOther.mutation(api.biweeklyRecords.createBatch, sampling(cageId, 'shared'))
    await expect(
      as.mutation(api.dailyRecords.createBatch, {
        date: '2026-06-02',
        records: [{ cageId, feedAmount: 0, mortality: 1 }],
        clientMutationId: 'shared',
      }),
    ).rejects.toThrow(/different save/)
    // A rejected write leaves no key, so a corrected retry still runs.
    await expect(
      as.mutation(api.biweeklyRecords.createBatch, {
        date: '2026-06-15',
        records: [{ cageId, totalFishCount: 0, totalWeight: 1 }],
        clientMutationId: 'bad',
      }),
    ).rejects.toThrow()
    await t.run(async (ctx) => {
      expect(await ctx.db.query('biweeklyRecords').collect()).toHaveLength(2)
      const keys = await ctx.db.query('idempotencyKeys').collect()
      expect(keys.map((k) => k.key).sort()).toEqual(['shared', 'shared'])
    })
  })

  test('calls without a key behave as before', async () => {
    const { t, as, cageId } = await setup()
    await as.mutation(api.biweeklyRecords.createBatch, sampling(cageId))
    await as.mutation(api.biweeklyRecords.createBatch, sampling(cageId))
    await t.run(async (ctx) => {
      expect(await ctx.db.query('biweeklyRecords').collect()).toHaveLength(2)
      expect(await ctx.db.query('idempotencyKeys').collect()).toHaveLength(0)
    })
  })

  test('prune drops keys past retention only', async () => {
    const { t, userId } = await setup()
    const now = Date.now()
    await t.run(async (ctx) => {
      for (const [key, age] of [
        ['old', IDEMPOTENCY_RETENTION_MS + 1000],
        ['new', 1000],
      ] as const) {
        await ctx.db.insert('idempotencyKeys', {
          userId,
          key,
          mutation: 'x',
          result: null,
          createdAt: now - age,
        })
      }
    })
    const removed = await t.mutation(internal.idempotency.prune, { now })
    expect(removed).toBe(1)
    await t.run(async (ctx) => {
      const keys = await ctx.db.query('idempotencyKeys').collect()
      expect(keys.map((k) => k.key)).toEqual(['new'])
    })
  })
})
