/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { insertUsage } from './llmGateway'
import { admitCall } from './aiGuard'
import { monthOf } from './lib/aiGuard'

const modules = import.meta.glob('./**/*.ts')

/**
 * AI protections (D-023): leases, budgets, breakers, alerts and tenant
 * isolation, through the real gate mutations and usage rows.
 */
async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = async (name: string, code: string) =>
      await ctx.db.insert('companies', { name, code, status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true } })
    const lake = await company('Lake', 'LAKE')
    const river = await company('River', 'RIVER')
    const member = async (email: string, companyId: Id<'companies'>, roleKey: string) => {
      const userId = await ctx.db.insert('users', { email, name: email, role: roleKey === 'owner' ? 'admin' : 'user', companyId })
      await ctx.db.insert('memberships', { userId, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now })
      return userId
    }
    const owner = await member('owner@lake.com', lake, 'owner')
    const worker = await member('worker@lake.com', lake, 'manager')
    const riverOwner = await member('owner@river.com', river, 'owner')
    const platform = await ctx.db.insert('users', { email: 'root@anowa.com', role: 'super_admin' })
    const platformSession = await ctx.db.insert('authSessions', { userId: platform, expirationTime: now + 86_400_000 })
    await ctx.db.insert('mfaSessions', { userId: platform, sessionId: platformSession, purpose: 'verify', attempts: 0, verifiedAt: now, method: 'totp' })
    return { lake, river, owner, worker, riverOwner, platform, platformSession }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|${userId === ids.platform ? ids.platformSession : 's'}` })
  return { t, as, ...ids }
}

type S = Awaited<ReturnType<typeof setup>>

/** One usage row as a path writes it (priced: $1 per million input tokens). */
async function usage(s: S, row: { companyId: Id<'companies'>; userId?: Id<'users'>; ok?: boolean; error?: string; status?: number; tokens?: number; priced?: boolean; model?: string; source?: 'org_key' | 'server_key'; durationMs?: number }) {
  await s.t.run(async (ctx) => {
    await insertUsage(ctx, {
      companyId: row.companyId,
      userId: row.userId,
      source: row.source ?? 'server_key',
      providerId: 'gemini',
      model: row.model ?? 'gemini-2.5-flash',
      feature: 'chat',
      ok: row.ok ?? true,
      error: row.error,
      status: row.status,
      inputTokens: row.tokens ?? 1_000_000,
      outputTokens: 0,
      durationMs: row.durationMs ?? 1_000,
      ...(row.priced === false ? {} : { inputPerM: 1, outputPerM: 1 }),
    })
  })
}

afterEach(() => {
  vi.useRealTimers()
  delete process.env.AI_COMPANY_MONTHLY_BUDGET_USD
  delete process.env.AI_MAX_INFLIGHT_SERVER
  delete process.env.AI_SERVER_MONTHLY_BUDGET_USD
  delete process.env.AI_SERVER_TENANT_SHARE
})

describe('concurrency leases', () => {
  test('two in flight per user; the third is refused as busy, then a release frees a slot', async () => {
    const s = await setup()
    const me = s.as(s.worker)
    const a = await me.mutation(api.llmQuota.consumeServerKeyQuota, {})
    await me.mutation(api.llmQuota.consumeServerKeyQuota, {})
    await expect(me.mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/still working on other questions/)
    // Another member of the company is not affected by my cap.
    const theirs = await s.as(s.owner).mutation(api.llmQuota.consumeServerKeyQuota, {})
    expect(theirs.leaseId).toBeTruthy()
    await me.mutation(api.aiGuard.releaseLease, { leaseId: a.leaseId })
    await expect(me.mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toMatchObject({ blocked: [] })
  })

  test('a lease of a crashed call expires with its deadline; the 5-minute check deletes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const s = await setup()
    const me = s.as(s.worker)
    await me.mutation(api.llmQuota.consumeServerKeyQuota, {})
    await me.mutation(api.llmQuota.consumeServerKeyQuota, {})
    await expect(me.mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/still working/)
    vi.setSystemTime(Date.now() + 80_000) // deadline 45 s + 30 s margin
    await expect(me.mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toBeTruthy()
    await s.t.mutation(internal.aiGuard.checkHealth, {})
    const left = await s.t.run(async (ctx) => (await ctx.db.query('aiLeases').collect()).length)
    expect(left).toBe(1)
  })

  test("only the caller's own lease can be released", async () => {
    const s = await setup()
    const mine = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    await s.as(s.owner).mutation(api.aiGuard.releaseLease, { leaseId: mine.leaseId })
    expect(await s.t.run(async (ctx) => await ctx.db.get(mine.leaseId))).not.toBeNull()
  })

  test('company and server-key caps (env), and a refusal spends no quota and writes no usage', async () => {
    process.env.AI_MAX_INFLIGHT_SERVER = '1'
    const s = await setup()
    const held = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    // River is another tenant, but the shared server key is full.
    await expect(s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/still working/)
    await s.as(s.worker).mutation(api.aiGuard.releaseLease, { leaseId: held.leaseId })
    // The refused call did not spend River's minute bucket: ten more go through, the eleventh is rate limited.
    for (let i = 0; i < 10; i++) {
      const g = await s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})
      await s.as(s.riverOwner).mutation(api.aiGuard.releaseLease, { leaseId: g.leaseId })
    }
    await expect(s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/Too many assistant requests/)
    expect(await s.t.run(async (ctx) => (await ctx.db.query('llmUsage').collect()).length)).toBe(0)
  })

  test('per-company cap counts scheduled calls (no user) too', async () => {
    const s = await setup()
    const refusals = await s.t.run(async (ctx) => {
      const out = []
      for (let i = 0; i < 11; i++) out.push((await admitCall(ctx, { companyId: s.lake, server: false, feature: 'report' })).ok)
      return out
    })
    expect(refusals.filter((ok) => ok)).toHaveLength(10)
    expect(refusals[10]).toBe(false)
  })
})

describe('per-minute limit is a token bucket', () => {
  test('a burst of ten, then one more every 6 seconds (not a locked minute)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const s = await setup()
    const me = s.as(s.worker)
    const ask = async () => {
      const g = await me.mutation(api.llmQuota.consumeServerKeyQuota, {})
      await me.mutation(api.aiGuard.releaseLease, { leaseId: g.leaseId })
    }
    for (let i = 0; i < 10; i++) await ask()
    await expect(ask()).rejects.toThrow(/Too many assistant requests/)
    vi.setSystemTime(Date.now() + 6_100)
    await ask()
    await expect(ask()).rejects.toThrow(/Too many assistant requests/)
  })
})

describe('monthly budget', () => {
  test('warns admins at 80% and 100% once, refuses at 100%, platform override lets the tenant continue', async () => {
    const s = await setup()
    await s.as(s.owner).mutation(api.aiGuard.setBudget, { monthlyBudgetUsd: 5 })
    for (let i = 0; i < 4; i++) await usage(s, { companyId: s.lake, userId: s.worker }) // $4 = 80%
    await s.t.finishAllScheduledFunctions(() => {})
    const titles = async () =>
      await s.t.run(async (ctx) => (await ctx.db.query('notifications').withIndex('by_user', (q) => q.eq('userId', s.owner)).collect()).map((n) => n.title))
    expect(await titles()).toEqual(['AI budget at 80%'])
    await expect(s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toBeTruthy()

    await usage(s, { companyId: s.lake, userId: s.worker }) // $5 = 100%
    await usage(s, { companyId: s.lake, userId: s.worker }) // past it: no second notice
    await s.t.finishAllScheduledFunctions(() => {})
    expect(await titles()).toEqual(['AI budget at 80%', 'AI budget used up'])
    // A worker (no org.settings.manage) is not told.
    const workerNotes = await s.t.run(async (ctx) => await ctx.db.query('notifications').withIndex('by_user', (q) => q.eq('userId', s.worker)).collect())
    expect(workerNotes).toHaveLength(0)

    await expect(s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/this month's AI budget/)
    const status = await s.as(s.owner).query(api.aiGuard.budgetStatus, { now: Date.now() })
    expect(status).toMatchObject({ spentUsd: 6, effectiveUsd: 5, refusing: true, allowedOver: false })

    // Platform admin: allow over budget this month.
    await s.as(s.platform).mutation(api.aiGuard.setTenantOverride, { companyId: s.lake, platformBudgetUsd: null, allowOverBudget: true })
    await expect(s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toBeTruthy()
    // Members cannot override.
    await expect(s.as(s.owner).mutation(api.aiGuard.setTenantOverride, { companyId: s.lake, platformBudgetUsd: 1000, allowOverBudget: true })).rejects.toThrow()
  })

  test('platform default (env) applies; the org can only lower it; unpriced models count against the token budget', async () => {
    process.env.AI_COMPANY_MONTHLY_BUDGET_USD = '2'
    const s = await setup()
    await s.as(s.owner).mutation(api.aiGuard.setBudget, { monthlyBudgetUsd: 100 })
    expect((await s.as(s.owner).query(api.aiGuard.budgetStatus, { now: Date.now() })).effectiveUsd).toBe(2)
    await s.as(s.owner).mutation(api.aiGuard.setBudget, { monthlyBudgetUsd: null, monthlyTokenBudget: 1000 })
    await usage(s, { companyId: s.lake, userId: s.worker, priced: false, tokens: 1000 })
    await expect(s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/AI budget/)
    // Validation and permission.
    await expect(s.as(s.owner).mutation(api.aiGuard.setBudget, { monthlyBudgetUsd: -5 })).rejects.toThrow(/positive/)
    await expect(s.as(s.worker).mutation(api.aiGuard.setBudget, { monthlyBudgetUsd: 5 })).rejects.toThrow()
  })

  test('tenant isolation: spend and budgets are per company', async () => {
    const s = await setup()
    await s.as(s.owner).mutation(api.aiGuard.setBudget, { monthlyBudgetUsd: 1 })
    await usage(s, { companyId: s.lake, userId: s.worker, tokens: 2_000_000 })
    const river = await s.as(s.riverOwner).query(api.aiGuard.budgetStatus, { now: Date.now() })
    expect(river).toMatchObject({ spentUsd: 0, monthlyBudgetUsd: null, refusing: false })
    await expect(s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toBeTruthy()
    await expect(s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/AI budget/)
    // Console-only reads.
    await expect(s.as(s.owner).query(api.aiGuard.platformHealth, { now: Date.now() })).rejects.toThrow()
    const page = await s.as(s.platform).query(api.aiGuard.tenantBudgets, { now: Date.now(), paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page.map((r) => r.name)).toEqual(['Lake'])
    expect(page.page[0]).toMatchObject({ spentUsd: 2, usedPct: 200 })
  })
})

describe('circuit breaker from usage rows', () => {
  test('two 503s open the model for the server key; a success closes it; org keys are per tenant', async () => {
    const s = await setup()
    const now = () => Date.now()
    await usage(s, { companyId: s.lake, ok: false, error: 'The model is overloaded', status: 503 })
    let gate = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    expect(gate.blocked).toEqual([])
    await usage(s, { companyId: s.river, ok: false, error: 'The model is overloaded', status: 503 })
    gate = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    // The server key is shared: River's failure counts for Lake too.
    expect(gate.blocked).toEqual(['server|gemini|gemini-2.5-flash'])
    const health = await s.as(s.platform).query(api.aiGuard.platformHealth, { now: now() })
    expect(health.breakers).toMatchObject([{ scope: 'server', providerId: 'gemini', model: 'gemini-2.5-flash', lastKind: 'unavailable' }])
    await usage(s, { companyId: s.lake, ok: true })
    gate = await s.as(s.owner).mutation(api.llmQuota.consumeServerKeyQuota, {})
    expect(gate.blocked).toEqual([])

    // An org key's quota refusal ("limit: 0") is that tenant's only.
    await usage(s, { companyId: s.lake, source: 'org_key', model: 'gemini-2.5-pro', ok: false, error: 'Quota exceeded for metric x, limit: 0', status: 429 })
    const rows = await s.t.run(async (ctx) => await ctx.db.query('aiBreakers').collect())
    expect(rows.find((r) => r.model === 'gemini-2.5-pro')).toMatchObject({ scope: s.lake, refused: true, lastKind: 'quota' })
    const riverGate = await s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})
    expect(riverGate.blocked).toEqual([])
  })

  test('question problems (400 too long) never open the breaker', async () => {
    const s = await setup()
    for (let i = 0; i < 3; i++) await usage(s, { companyId: s.lake, ok: false, error: 'maximum context length exceeded', status: 400 })
    expect(await s.t.run(async (ctx) => (await ctx.db.query('aiBreakers').collect()).length)).toBe(0)
  })
})

describe('breaker limits and console reset', () => {
  test('a quota retry-after is capped at a day ("limit: 0" too)', async () => {
    const s = await setup()
    const now = Date.now()
    await usage(s, { companyId: s.lake, model: 'm-zero', ok: false, error: 'Quota exceeded for metric x, limit: 0. Please retry in 100000h', status: 429 })
    await usage(s, { companyId: s.lake, model: 'm-quota', ok: false, error: 'You exceeded your current quota. Please retry in 100000h', status: 429 })
    const rows = await s.t.run(async (ctx) => await ctx.db.query('aiBreakers').collect())
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.lastKind).toBe('quota')
      expect(r.openUntil).toBeGreaterThan(now)
      expect(r.openUntil).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000)
    }
  })

  test('a platform admin with MFA can reset a breaker; audited; members and admins without MFA cannot', async () => {
    const s = await setup()
    for (let i = 0; i < 2; i++) await usage(s, { companyId: s.lake, ok: false, error: 'The model is overloaded', status: 503 })
    const health = await s.as(s.platform).query(api.aiGuard.platformHealth, { now: Date.now() })
    const breakerId = health.breakers[0].id
    await expect(s.as(s.owner).mutation(api.aiGuard.resetBreaker, { breakerId })).rejects.toThrow()
    const noMfa = await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'ops@anowa.com', role: 'super_admin' })
      const sessionId = await ctx.db.insert('authSessions', { userId, expirationTime: Date.now() + 86_400_000 })
      return { userId, sessionId }
    })
    await expect(s.t.withIdentity({ subject: `${noMfa.userId}|${noMfa.sessionId}` }).mutation(api.aiGuard.resetBreaker, { breakerId })).rejects.toThrow()

    await s.as(s.platform).mutation(api.aiGuard.resetBreaker, { breakerId })
    const gate = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    expect(gate.blocked).toEqual([])
    const events = await s.t.run(async (ctx) => await ctx.db.query('platformEvents').collect())
    expect(events).toMatchObject([{ action: 'ai.breaker_reset', actorId: s.platform, targetTable: 'aiBreakers' }])
  })
})

describe('5-minute health check', () => {
  test('error-rate alert per provider and tenant, deduped, sent to platform admins only', async () => {
    const s = await setup()
    for (let i = 0; i < 24; i++) {
      await usage(s, { companyId: s.lake, ok: i % 2 === 0, error: i % 2 ? 'bad request' : undefined, status: i % 2 ? 400 : undefined, priced: false })
    }
    const first = await s.t.mutation(internal.aiGuard.checkHealth, {})
    expect(first.alerts).toBe(2) // provider + tenant
    expect(first.sent).toBe(2)
    await s.t.finishAllScheduledFunctions(() => {})
    const notes = await s.t.run(async (ctx) => await ctx.db.query('notifications').collect())
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.every((n) => n.userId === s.platform)).toBe(true)
    // Same condition five minutes later: still active, not re-sent within the hour.
    const again = await s.t.mutation(internal.aiGuard.checkHealth, {})
    expect(again).toEqual({ alerts: 2, sent: 0 })
    const health = await s.as(s.platform).query(api.aiGuard.platformHealth, { now: Date.now() })
    expect(health.alerts.map((a) => a.kind)).toEqual(['error_rate', 'error_rate'])
    expect(health.lastHour).toMatchObject({ calls: 24, errors: 12 })
    expect(monthOf(Date.now())).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('Next-proxy usage reports cannot be abused (member sessions)', () => {
  const report = (s: S, userId: Id<'users'>, leaseId: Id<'aiLeases'>, extra: Record<string, unknown> = {}) =>
    s.as(userId).mutation(api.llmGateway.recordServerUsage, {
      leaseId,
      providerId: 'gemini',
      model: 'gemini-2.5-flash',
      feature: 'chat',
      ok: false,
      error: 'Quota exceeded for metric x, limit: 0',
      status: 429,
      ...extra,
    })
  const rows = (s: S) => s.t.run(async (ctx) => await ctx.db.query('llmUsage').collect())
  const breakers = (s: S) => s.t.run(async (ctx) => await ctx.db.query('aiBreakers').collect())

  test("needs the caller's own live server-key lease; at most two rows per lease", async () => {
    const s = await setup()
    const mine = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    // Someone else's lease: ignored.
    await report(s, s.owner, mine.leaseId)
    expect(await rows(s)).toHaveLength(0)
    await report(s, s.worker, mine.leaseId, { ok: true, error: undefined, status: undefined })
    await report(s, s.worker, mine.leaseId, { ok: true, error: undefined, status: undefined })
    await report(s, s.worker, mine.leaseId, { ok: true, error: undefined, status: undefined })
    expect(await rows(s)).toHaveLength(2)
  })

  const ok = { ok: true, error: undefined, status: undefined }

  test('forged 429s ("limit: 0, retry in 100000h") from two tenants never open, extend or close a server breaker', async () => {
    const s = await setup()
    const a = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    const b = await s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})
    const forged = { error: 'Quota exceeded for metric x, limit: 0. Please retry in 100000h', status: 429 }
    await report(s, s.worker, a.leaseId, forged)
    await report(s, s.worker, a.leaseId, forged)
    await report(s, s.riverOwner, b.leaseId, forged)
    expect(await rows(s)).toHaveLength(3) // usage is still logged (health alerts see it)
    expect(await breakers(s)).toHaveLength(0)
    const gate = await s.as(s.owner).mutation(api.llmQuota.consumeServerKeyQuota, {})
    expect(gate.blocked).toEqual([])
  })

  test("a member's ok row does not reset a server breaker (open, or closed with failures)", async () => {
    const s = await setup()
    // One Convex-side failure: closed, one failure counted.
    await usage(s, { companyId: s.lake, ok: false, error: 'The model is overloaded', status: 503 })
    const g = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    await report(s, s.worker, g.leaseId, ok)
    expect((await breakers(s))[0]).toMatchObject({ failures: 1, openUntil: 0 })
    // A second Convex-side failure opens it; a member's "success" cannot close it.
    await usage(s, { companyId: s.river, ok: false, error: 'The model is overloaded', status: 503 })
    const g2 = await s.as(s.owner).mutation(api.llmQuota.consumeServerKeyQuota, {})
    expect(g2.blocked).toEqual(['server|gemini|gemini-2.5-flash'])
    await report(s, s.owner, g2.leaseId, ok)
    expect((await breakers(s))[0].openUntil).toBeGreaterThan(Date.now())
  })

  test("forged spend counts for the member's own company only, never the shared server pool", async () => {
    const s = await setup()
    const g = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    await report(s, s.worker, g.leaseId, { ...ok, inputTokens: 250_000, outputTokens: 0, inputPerM: 20, outputPerM: 20 }) // $5
    let health = await s.as(s.platform).query(api.aiGuard.platformHealth, { now: Date.now() })
    expect(health.monthSpendUsd.server).toBe(0)
    expect((await s.as(s.owner).query(api.aiGuard.budgetStatus, { now: Date.now() })).spentUsd).toBe(5)
    // Convex-side server-key calls do move the pool.
    await usage(s, { companyId: s.river })
    health = await s.as(s.platform).query(api.aiGuard.platformHealth, { now: Date.now() })
    expect(health.monthSpendUsd.server).toBe(1)
  })

  test('tenant share cap: one tenant cannot use up the server key; the platform override lifts it', async () => {
    process.env.AI_SERVER_MONTHLY_BUDGET_USD = '10'
    process.env.AI_SERVER_TENANT_SHARE = '0.25' // $2.50 each
    const s = await setup()
    const g = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    await report(s, s.worker, g.leaseId, { ...ok, inputTokens: 250_000, outputTokens: 0, inputPerM: 20, outputPerM: 20 }) // $5 forged
    await expect(s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/AI budget/)
    // Other tenants are unaffected; the pool itself is untouched.
    await expect(s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toBeTruthy()
    // Convex-side calls count toward the share too.
    await usage(s, { companyId: s.river, tokens: 3_000_000 }) // $3
    await expect(s.as(s.riverOwner).mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/AI budget/)
    await s.as(s.platform).mutation(api.aiGuard.setTenantOverride, { companyId: s.lake, platformBudgetUsd: null, allowOverBudget: true })
    await expect(s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})).resolves.toBeTruthy()
  })

  test('reported tokens and prices are capped', async () => {
    const s = await setup()
    const g = await s.as(s.worker).mutation(api.llmQuota.consumeServerKeyQuota, {})
    await report(s, s.worker, g.leaseId, { ok: true, error: undefined, status: undefined, inputTokens: 9_000_000, outputTokens: 9_000_000, inputPerM: 1, outputPerM: 1 })
    await report(s, s.worker, g.leaseId, { ok: true, error: undefined, status: undefined, inputTokens: 1000, inputPerM: 9_000, outputPerM: 9_000 })
    const [capped, unpriced] = await rows(s)
    expect(capped).toMatchObject({ inputTokens: 250_000, outputTokens: 64_000, costUsd: 0.314 })
    expect(unpriced.costUsd).toBeUndefined()
  })
})

