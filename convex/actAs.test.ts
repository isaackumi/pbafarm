/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

/** ENT-006: super-admin support access ("act as"), time-boxed and audited. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'A1', active: true, updatedAt: now })
    await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B1', active: true, updatedAt: now })
    const root = await ctx.db.insert('users', { email: 'root@platform.com', role: 'super_admin' })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA })
    await ctx.db.insert('users', { email: 'staff@b.com', role: 'user', companyId: companyB })
    const session = (userId: Id<'users'>) => ctx.db.insert('authSessions', { userId, expirationTime: now + 86_400_000 })
    return { companyA, companyB, siteA, root, adminA, sRoot: await session(root), sAdminA: await session(adminA) }
  })
  return {
    t,
    ...ids,
    asRoot: t.withIdentity({ subject: `${ids.root}|${ids.sRoot}` }),
    asAdminA: t.withIdentity({ subject: `${ids.adminA}|${ids.sAdminA}` }),
  }
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    const raw = (e as { data?: unknown }).data
    return ((typeof raw === 'string' ? JSON.parse(raw) : raw) ?? { message: String((e as Error).message) }) as {
      code?: string
      message: string
      details?: Record<string, unknown>
    }
  }
  throw new Error('expected a rejection')
}

const REASON = 'Ticket #4411: feed totals look wrong'

describe('act as (ENT-006)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('only a super_admin may start, and only with a reason and a bounded duration', async () => {
    const s = await setup()
    expect(await errorOf(s.asAdminA.mutation(api.actAs.start, { companyId: s.companyB, reason: REASON }))).toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await errorOf(s.asRoot.mutation(api.actAs.start, { companyId: s.companyA, reason: 'because' }))).toMatchObject({
      code: 'VALIDATION',
    })
    expect(
      await errorOf(s.asRoot.mutation(api.actAs.start, { companyId: s.companyA, reason: REASON, minutes: 600 })),
    ).toMatchObject({ code: 'VALIDATION' })
    expect(await s.asAdminA.query(api.actAs.status, {})).toBeNull()
    expect(await s.t.run((ctx) => ctx.db.query('actAsSessions').collect())).toEqual([])
  })

  test('read-only by default: sees only the target organization, writes refused', async () => {
    const s = await setup()
    // Without a session the super_admin has the platform-wide view.
    expect(await s.asRoot.query(api.users.listDirectory, {})).toHaveLength(4)

    const { sessionId } = await s.asRoot.mutation(api.actAs.start, { companyId: s.companyA, reason: REASON })
    expect(await s.asRoot.query(api.actAs.status, {})).toMatchObject({
      sessionId,
      companyName: 'Lake Farm',
      allowWrites: false,
    })
    const people = await s.asRoot.query(api.users.listDirectory, {})
    expect(people.map((p) => p.email).sort()).toEqual(['admin@a.com', 'staff@a.com'])
    // The app renders the target organization, with the real role kept for the banner.
    expect(await s.asRoot.query(api.users.current, {})).toMatchObject({
      role: 'admin',
      realRole: 'super_admin',
      companyId: s.companyA,
      actingAs: { sessionId, companyId: s.companyA, allowWrites: false },
    })

    const write = await errorOf(s.asRoot.mutation(api.equipment.create, { name: 'Aerator', kind: 'aerator' }))
    expect(write).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'ACT_AS_READ_ONLY' } })
    expect(await s.t.run((ctx) => ctx.db.query('equipment').collect())).toEqual([])
    // Platform functions are off while acting as an organization.
    await expect(s.asRoot.query(api.companies.list, {})).rejects.toThrow()

    // Stop: back to the platform account.
    expect(await s.asRoot.mutation(api.actAs.stop, {})).toEqual({ ended: true })
    expect(await s.asRoot.query(api.actAs.status, {})).toBeNull()
    expect(await s.asRoot.query(api.users.current, {})).toMatchObject({ role: 'super_admin', actingAs: null })
    expect(await s.asRoot.query(api.users.listDirectory, {})).toHaveLength(4)
  })

  test('with writes: every write is audited with the real actor, in the target only', async () => {
    const s = await setup()
    const { sessionId } = await s.asRoot.mutation(api.actAs.start, {
      companyId: s.companyA,
      reason: REASON,
      allowWrites: true,
      minutes: 15,
    })
    const id = await s.asRoot.mutation(api.equipment.create, { name: 'Aerator', kind: 'aerator' })
    const row = await s.t.run((ctx) => ctx.db.get(id))
    expect(row).toMatchObject({ companyId: s.companyA })

    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(audit.map((r) => r.actionType)).toEqual(expect.arrayContaining(['act_as_start', 'act_as_mutation']))
    for (const r of audit) {
      expect(r).toMatchObject({ userId: s.root, companyId: s.companyA, actAsSessionId: sessionId })
    }
    // The platform log of support sessions still answers while acting.
    expect(await s.asRoot.query(api.actAs.listForCompany, { companyId: s.companyA })).toEqual([
      expect.objectContaining({ sessionId, adminEmail: 'root@platform.com', reason: REASON, allowWrites: true, endedAt: null }),
    ])
    await expect(s.asAdminA.query(api.actAs.listForCompany, { companyId: s.companyA })).rejects.toThrow()
  })

  test('expires on its own and is audited', async () => {
    const s = await setup()
    await s.asRoot.mutation(api.actAs.start, { companyId: s.companyA, reason: REASON, minutes: 5 })
    expect(await s.asRoot.query(api.users.listDirectory, {})).toHaveLength(2)

    vi.advanceTimersByTime(5 * 60_000 + 1)
    // Past expiresAt the session no longer applies, even before the job runs.
    expect(await s.asRoot.query(api.users.listDirectory, {})).toHaveLength(4)
    await s.t.finishAllScheduledFunctions(vi.runAllTimers)
    const [session] = await s.t.run((ctx) => ctx.db.query('actAsSessions').collect())
    expect(session).toMatchObject({ endedReason: 'expired' })
    const actions = (await s.t.run((ctx) => ctx.db.query('auditLogs').collect())).map((r) => r.actionType)
    expect(actions).toEqual(['act_as_start', 'act_as_expired'])
  })

  test('starting a second session replaces the first; tenant isolation holds', async () => {
    const s = await setup()
    await s.asRoot.mutation(api.actAs.start, { companyId: s.companyA, reason: REASON })
    await s.asRoot.mutation(api.actAs.start, { companyId: s.companyB, reason: REASON })
    const people = await s.asRoot.query(api.users.listDirectory, {})
    expect(people.map((p) => p.email)).toEqual(['staff@b.com'])
    const sessions = await s.t.run((ctx) => ctx.db.query('actAsSessions').collect())
    expect(sessions.map((x) => x.endedReason)).toEqual(['replaced', undefined])
    // The organization admin's own view is unaffected.
    expect((await s.asAdminA.query(api.users.listDirectory, {})).map((p) => p.email).sort()).toEqual([
      'admin@a.com',
      'staff@a.com',
    ])
    await s.t.mutation(internal.actAs.expire, { sessionId: sessions[0]._id })
    expect((await s.t.run((ctx) => ctx.db.get(sessions[0]._id)))?.endedReason).toBe('replaced')
  })
})
