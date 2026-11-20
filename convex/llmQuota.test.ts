/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

/** SEC-004: server-key assistant calls spend durable Convex limits, not only the per-instance ones. */
async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const a = await ctx.db.insert('users', { email: 'a@a.com', role: 'admin', companyId })
    const b = await ctx.db.insert('users', { email: 'b@a.com', role: 'admin', companyId })
    const viewer = await ctx.db.insert('users', { email: 'v@a.com', role: 'user', companyId })
    await ctx.db.insert('memberships', {
      userId: viewer, companyId, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: now,
    })
    return { a, b, viewer }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}

describe('server-key assistant quota (SEC-004)', () => {
  test('per-user minute limit is enforced across calls, per user', async () => {
    const s = await setup()
    for (let i = 0; i < 10; i++) {
      // Each finished call gives its concurrency lease back (D-023).
      const gate = await s.as(s.a).mutation(api.llmQuota.consumeServerKeyQuota, {})
      await s.as(s.a).mutation(api.aiGuard.releaseLease, { leaseId: gate.leaseId })
    }
    await expect(s.as(s.a).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/Too many assistant requests/)
    // Another user of the company still has quota.
    await expect(s.as(s.b).mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toMatchObject({ blocked: [] })
  })

  test('requires ai.use', async () => {
    const s = await setup()
    await expect(s.as(s.viewer).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow()
    await expect(s.t.mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow()
  })
})
