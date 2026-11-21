/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { statusPageUrl } from './platform/maintenance'

const modules = import.meta.glob('./**/*.ts')

/** Paper 62 maintenance mode: set from the console only, and audited. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const root = await ctx.db.insert('users', { email: 'root@platform.com', role: 'super_admin' })
    const rootNoMfa = await ctx.db.insert('users', { email: 'root2@platform.com', role: 'super_admin' })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    await ctx.db.insert('memberships', { userId: adminA, companyId: companyA, roleKey: 'owner', status: 'active', allLocations: true, updatedAt: now })
    const session = (userId: Id<'users'>) => ctx.db.insert('authSessions', { userId, expirationTime: now + 86_400_000 })
    const sRoot = await session(root)
    await ctx.db.insert('mfaSessions', { userId: root, sessionId: sRoot, purpose: 'verify', attempts: 0, verifiedAt: now, method: 'totp' })
    return { root, sRoot, rootNoMfa, sRootNoMfa: await session(rootNoMfa), adminA, sAdminA: await session(adminA) }
  })
  return {
    t,
    ...ids,
    asRoot: t.withIdentity({ subject: `${ids.root}|${ids.sRoot}` }),
    asRootNoMfa: t.withIdentity({ subject: `${ids.rootNoMfa}|${ids.sRootNoMfa}` }),
    asAdminA: t.withIdentity({ subject: `${ids.adminA}|${ids.sAdminA}` }),
  }
}

async function failed(p: Promise<unknown>) {
  try {
    await p
    return false
  } catch {
    return true
  }
}

const HOUR = 60 * 60 * 1000

describe('platform maintenance mode', () => {
  test('console admins set and clear the window; each change is audited', async () => {
    const s = await setup()
    const startsAt = Date.now()
    const endsAt = startsAt + 2 * HOUR
    await s.asRoot.mutation(api.platform.maintenance.set, { startsAt, endsAt, message: ' Database upgrade ' })
    const status = await s.t.query(api.platform.maintenance.status, {})
    expect(status.window).toMatchObject({ startsAt, endsAt, message: 'Database upgrade' })

    await s.asRoot.mutation(api.platform.maintenance.clear, {})
    expect((await s.t.query(api.platform.maintenance.status, {})).window).toBeNull()

    const events = await s.t.run((ctx) => ctx.db.query('platformEvents').collect())
    expect(events.map((e) => [e.action, e.actorId])).toEqual([
      ['maintenance.set', s.root],
      ['maintenance.clear', s.root],
    ])
  })

  test('org admins and admins without two-step verification are refused', async () => {
    const s = await setup()
    const args = { startsAt: Date.now(), endsAt: Date.now() + HOUR }
    expect(await failed(s.asAdminA.mutation(api.platform.maintenance.set, args))).toBe(true)
    expect(await failed(s.asRootNoMfa.mutation(api.platform.maintenance.set, args))).toBe(true)
    expect(await failed(s.t.mutation(api.platform.maintenance.set, args))).toBe(true)
    expect(await failed(s.asAdminA.mutation(api.platform.maintenance.clear, {}))).toBe(true)
    expect((await s.t.query(api.platform.maintenance.status, {})).window).toBeNull()
    expect(await s.t.run((ctx) => ctx.db.query('platformEvents').collect())).toHaveLength(0)
  })

  test('rejects an end before the start or in the past', async () => {
    const s = await setup()
    const now = Date.now()
    expect(await failed(s.asRoot.mutation(api.platform.maintenance.set, { startsAt: now, endsAt: now - 1 }))).toBe(true)
    expect(await failed(s.asRoot.mutation(api.platform.maintenance.set, { startsAt: now - 2 * HOUR, endsAt: now - HOUR }))).toBe(true)
  })

  test('status page link comes from STATUS_PAGE_URL and must be http(s)', () => {
    expect(statusPageUrl('https://status.getanowa.com')).toBe('https://status.getanowa.com/')
    expect(statusPageUrl('')).toBeNull()
    expect(statusPageUrl('javascript:alert(1)')).toBeNull()
  })
})
