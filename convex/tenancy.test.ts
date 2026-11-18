/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { authErrorCode } from './lib/authErrors'

const modules = import.meta.glob('./**/*.ts')

/**
 * Two approved companies A and B, plus the accounts SEC-001/003 care about:
 * A's admin and staff, an inactive A user, a user with a temporary password,
 * two company-less sign-ups, a company-less super_admin, and an unscoped
 * legacy cage.
 */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now,
    })
    const siteA = await ctx.db.insert('farmLocations', {
      companyId: companyA, name: 'Main', active: true, updatedAt: now,
    })
    const user = (email: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert('users', { email, role: 'user', ...extra } as any)
    const adminA = await user('admin@a.com', { role: 'admin', companyId: companyA, activeLocationId: siteA })
    const staffA = await user('staff@a.com', { companyId: companyA, activeLocationId: siteA })
    const inactiveA = await user('gone@a.com', { companyId: companyA, active: false })
    const tempA = await user('temp@a.com', { companyId: companyA, mustChangePassword: true })
    const adminB = await user('admin@b.com', { role: 'admin', companyId: companyB })
    const loner1 = await user('loner1@x.com')
    const loner2 = await user('loner2@x.com')
    const platform = await user('owner@platform.com', { role: 'super_admin' })
    const cageA = await ctx.db.insert('cages', {
      name: 'A1', status: 'active', companyId: companyA, locationId: siteA, updatedAt: now,
    })
    const legacyCage = await ctx.db.insert('cages', { name: 'Legacy', status: 'active', updatedAt: now })
    return {
      companyA, companyB, siteA, adminA, staffA, inactiveA, tempA, adminB,
      loner1, loner2, platform, cageA, legacyCage,
    }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    return authErrorCode(err) ?? (err as Error).message
  }
  return 'resolved'
}

async function addSession(t: ReturnType<typeof convexTest>, userId: any) {
  return t.run(async (ctx) => {
    const sessionId = await ctx.db.insert('authSessions', { userId, expirationTime: Date.now() + 1e9 })
    await ctx.db.insert('authRefreshTokens', { sessionId, expirationTime: Date.now() + 1e9 })
    return sessionId
  })
}

async function sessionsOf(t: ReturnType<typeof convexTest>, userId: any) {
  return t.run(async (ctx) => {
    const sessions = await ctx.db
      .query('authSessions')
      .withIndex('userId' as any, (q: any) => q.eq('userId', userId))
      .collect()
    const tokens = await ctx.db.query('authRefreshTokens').collect()
    return {
      sessions: sessions.length,
      tokens: tokens.filter((tk) => sessions.some((s) => s._id === tk.sessionId)).length,
      allTokens: tokens.length,
    }
  })
}

describe('SEC-001 inactive users', () => {
  test('an inactive user is refused on a query and a mutation', async () => {
    const { as, inactiveA } = await setup()
    expect(await codeOf(as(inactiveA).query(api.cages.list, {}))).toBe('USER_INACTIVE')
    expect(await codeOf(as(inactiveA).mutation(api.cages.create, { name: 'X' }))).toBe('USER_INACTIVE')
  })

  test('users.current still answers so the client can sign out with a reason', async () => {
    const { as, inactiveA } = await setup()
    const me = await as(inactiveA).query(api.users.current, {})
    expect(me).toMatchObject({ active: false, companyStatus: 'approved' })
  })

  test('deactivating a user deletes their sessions and refresh tokens', async () => {
    const { t, as, adminA, staffA } = await setup()
    await addSession(t, staffA)
    await addSession(t, staffA)
    const keep = await addSession(t, adminA)
    expect((await sessionsOf(t, staffA)).sessions).toBe(2)

    await as(adminA).mutation(api.users.deactivate, { id: staffA })

    expect(await sessionsOf(t, staffA)).toMatchObject({ sessions: 0, tokens: 0, allTokens: 1 })
    expect((await sessionsOf(t, adminA)).sessions).toBe(1)
    expect(await t.run((ctx) => ctx.db.get(keep))).not.toBeNull()
    expect(await codeOf(as(staffA).query(api.cages.list, {}))).toBe('USER_INACTIVE')
  })
})

describe('SEC-001 temporary passwords', () => {
  test('a user who must change their password is refused everywhere except users.current', async () => {
    const { as, tempA } = await setup()
    expect(await codeOf(as(tempA).query(api.cages.list, {}))).toBe('PASSWORD_CHANGE_REQUIRED')
    expect(await codeOf(as(tempA).mutation(api.cages.create, { name: 'X' }))).toBe('PASSWORD_CHANGE_REQUIRED')
    const me = await as(tempA).query(api.users.current, {})
    expect(me?.mustChangePassword).toBe(true)
  })
})

describe('SEC-001 company status', () => {
  test('members of a rejected company are refused', async () => {
    const { t, as, staffA, companyA } = await setup()
    await t.run((ctx) => ctx.db.patch(companyA, { status: 'rejected' }))
    expect(await codeOf(as(staffA).query(api.cages.list, {}))).toBe('COMPANY_NOT_APPROVED')
    expect(await codeOf(as(staffA).mutation(api.cages.create, { name: 'X' }))).toBe('COMPANY_NOT_APPROVED')
    expect(await as(staffA).query(api.users.current, {})).toMatchObject({ companyStatus: 'rejected' })
  })

  test('removing a company refuses its members and signs them out', async () => {
    const { t, as, platform, staffA, adminA, adminB, companyA } = await setup()
    await addSession(t, staffA)
    await addSession(t, adminA)
    await addSession(t, adminB)
    await as(platform).mutation(api.companies.remove, { companyId: companyA })
    expect((await sessionsOf(t, staffA)).sessions).toBe(0)
    expect((await sessionsOf(t, adminA)).sessions).toBe(0)
    expect((await sessionsOf(t, adminB)).sessions).toBe(1)
    expect(await codeOf(as(adminA).query(api.cages.list, {}))).toBe('COMPANY_NOT_APPROVED')
    expect(await codeOf(as(adminB).query(api.cages.list, {}))).toBe('resolved')
  })

  test('remove can leave sessions alone when asked', async () => {
    const { t, as, platform, staffA, companyA } = await setup()
    await addSession(t, staffA)
    await as(platform).mutation(api.companies.remove, { companyId: companyA, revokeSessions: false })
    expect((await sessionsOf(t, staffA)).sessions).toBe(1)
  })

  test('a super_admin still reaches companies.* without a company', async () => {
    const { as, platform } = await setup()
    const all = await as(platform).query(api.companies.list, {})
    expect(all).toHaveLength(2)
  })

  test('existing approved-company users see no change', async () => {
    const { as, staffA, cageA } = await setup()
    const cages = await as(staffA).query(api.cages.list, {})
    expect(cages.map((c: any) => c._id ?? c.id)).toEqual([cageA])
    await expect(as(staffA).mutation(api.cages.create, { name: 'A2' })).resolves.toBeTruthy()
  })
})

describe('SEC-001 company-less users', () => {
  // Tenant functions refuse company-less callers outright (requireMember, PERM-002).
  test('a company-less user sees no cages, not even unscoped legacy ones', async () => {
    const { as, loner1 } = await setup()
    expect(await codeOf(as(loner1).query(api.cages.list, {}))).toBe('NO_COMPANY')
  })

  test('a company-less user cannot create a cage', async () => {
    const { t, as, loner1 } = await setup()
    expect(await codeOf(as(loner1).mutation(api.cages.create, { name: 'Mine' }))).toBe('NO_COMPANY')
    const unscoped = await t.run(async (ctx) =>
      (await ctx.db.query('cages').collect()).filter((c) => !c.companyId),
    )
    expect(unscoped.map((c) => c.name)).toEqual(['Legacy'])
    const locations = await t.run((ctx) => ctx.db.query('farmLocations').collect())
    expect(locations).toHaveLength(1)
  })

  test('two company-less users cannot see or touch each other\'s rows', async () => {
    const { t, as, loner1, loner2 } = await setup()
    const theirs = await t.run((ctx) =>
      ctx.db.insert('cages', { name: 'Loner2 cage', status: 'active', createdBy: loner2, updatedAt: Date.now() }),
    )
    expect(await codeOf(as(loner1).query(api.cages.list, {}))).toBe('NO_COMPANY')
    expect(await codeOf(as(loner1).query(api.cages.get, { id: theirs }))).toBe('NO_COMPANY')
    expect(
      await codeOf(as(loner1).mutation(api.cages.update, { id: theirs, patch: { name: 'Mine now' } })),
    ).toBe('NO_COMPANY')
    expect((await t.run((ctx) => ctx.db.get(theirs)))?.name).toBe('Loner2 cage')
  })

  test('ensureDefault creates no location for a company-less user', async () => {
    const { t, as, loner1 } = await setup()
    expect(await codeOf(as(loner1).mutation(api.farmLocations.ensureDefault, {}))).toBe('NO_COMPANY')
    expect(await t.run((ctx) => ctx.db.query('farmLocations').collect())).toHaveLength(1)
  })

  test('a company-less super_admin cannot write tenant data', async () => {
    const { as, platform } = await setup()
    expect(await codeOf(as(platform).mutation(api.cages.create, { name: 'X' }))).toBe('NO_COMPANY')
  })

  test('a company-less user can still register a company and see its status', async () => {
    const { as, loner1 } = await setup()
    await as(loner1).mutation(api.companies.register, { name: 'Pond Co', code: 'POND' })
    expect(await as(loner1).query(api.companies.myRegistration, {})).toMatchObject({
      name: 'Pond Co', status: 'pending',
    })
  })
})

describe('SEC-003 invitations', () => {
  // users.invite schedules the invite email; keep it from running after the test.
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('V2: inviting a company-less super_admin is refused and changes nothing', async () => {
    const { t, as, adminA, platform } = await setup()
    await expect(
      as(adminA).mutation(api.users.invite, { email: 'owner@platform.com', role: 'user' }),
    ).rejects.toThrow(/cannot be invited/)
    const owner = await t.run((ctx) => ctx.db.get(platform))
    expect(owner).toMatchObject({ role: 'super_admin' })
    expect(owner?.companyId).toBeUndefined()
  })

  test('inviting an existing company-less user does not change their account', async () => {
    const { t, as, adminA, loner1 } = await setup()
    const r = await as(adminA).mutation(api.users.invite, { email: 'loner1@x.com', role: 'admin' })
    expect(r.status).toBe('invited')
    const loner = await t.run((ctx) => ctx.db.get(loner1))
    expect(loner).toMatchObject({ role: 'user' })
    expect(loner?.companyId).toBeUndefined()
  })

  test('V13: a second company inviting the same email does not overwrite the first invite', async () => {
    const { t, as, adminA, adminB, companyA, companyB } = await setup()
    await as(adminA).mutation(api.users.invite, { email: 'new@x.com', role: 'admin' })
    await as(adminB).mutation(api.users.invite, { email: 'new@x.com', role: 'user' })
    const invites = await t.run((ctx) =>
      ctx.db.query('userInvites').withIndex('by_email', (q) => q.eq('email', 'new@x.com')).collect(),
    )
    expect(invites).toHaveLength(2)
    expect(invites.find((i) => i.companyId === companyA)).toMatchObject({ role: 'admin', status: 'pending' })
    expect(invites.find((i) => i.companyId === companyB)).toMatchObject({ role: 'user', status: 'pending' })
  })

  test('claiming an invite only files a join request; the company admin approves it', async () => {
    const { t, as, adminA, loner1, companyA } = await setup()
    await as(adminA).mutation(api.users.invite, { email: 'loner1@x.com', role: 'admin' })

    const mine = await as(loner1).query(api.users.myInvites, {})
    expect(mine).toMatchObject([{ companyName: 'Lake Farm', role: 'admin', status: 'pending' }])

    const r = await as(loner1).mutation(api.users.claimInvite, { inviteId: mine[0].id })
    expect(r).toMatchObject({ claimed: false, requested: true })
    expect((await t.run((ctx) => ctx.db.get(loner1)))?.companyId).toBeUndefined()
    const audit = await t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(audit.find((a) => a.actionType === 'join_request')).toMatchObject({
      userId: loner1, companyId: companyA,
    })

    const requests = await as(adminA).query(api.users.listJoinRequests, {})
    expect(requests).toMatchObject([{ email: 'loner1@x.com', role: 'admin' }])
    await as(adminA).mutation(api.users.approveJoinRequest, { inviteId: requests[0].id })

    expect(await t.run((ctx) => ctx.db.get(loner1))).toMatchObject({ companyId: companyA, role: 'admin' })
    expect(await as(adminA).query(api.users.listJoinRequests, {})).toEqual([])
  })

  test("another company's admin cannot approve the request", async () => {
    const { as, adminA, adminB, loner1 } = await setup()
    await as(adminA).mutation(api.users.invite, { email: 'loner1@x.com' })
    await as(loner1).mutation(api.users.claimInvite, {})
    const [req] = await as(adminA).query(api.users.listJoinRequests, {})
    await expect(
      as(adminB).mutation(api.users.approveJoinRequest, { inviteId: req.id }),
    ).rejects.toThrow(/not found/)
  })

  test('a declined request leaves the user company-less', async () => {
    const { t, as, adminA, loner1 } = await setup()
    await as(adminA).mutation(api.users.invite, { email: 'loner1@x.com' })
    await as(loner1).mutation(api.users.claimInvite, {})
    const [req] = await as(adminA).query(api.users.listJoinRequests, {})
    await as(adminA).mutation(api.users.declineJoinRequest, { inviteId: req.id })
    expect((await t.run((ctx) => ctx.db.get(loner1)))?.companyId).toBeUndefined()
    await expect(
      as(adminA).mutation(api.users.approveJoinRequest, { inviteId: req.id }),
    ).rejects.toThrow(/no longer pending/)
  })

  test('a super_admin cannot claim an invite', async () => {
    const { t, as, adminA, platform } = await setup()
    // Invite rows can predate the super_admin account; write one directly.
    await t.run(async (ctx) => {
      const a = await ctx.db.get(adminA)
      await ctx.db.insert('userInvites', {
        email: 'owner@platform.com', role: 'user', companyId: a!.companyId!, createdAt: Date.now(),
      })
    })
    const r = await as(platform).mutation(api.users.claimInvite, {})
    expect(r).toMatchObject({ requested: false, reason: 'super_admin' })
  })

  test('reactivation is audited', async () => {
    const { t, as, adminA, inactiveA } = await setup()
    await as(adminA).mutation(api.users.reactivate, { id: inactiveA })
    const rows = await t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(rows.find((r) => r.actionType === 'reactivate')).toMatchObject({
      recordId: inactiveA, userId: adminA,
    })
    expect(await codeOf(as(inactiveA).query(api.cages.list, {}))).toBe('resolved')
  })

  test('promoteToSuperAdmin is audited', async () => {
    const { t, staffA } = await setup()
    await t.mutation(internal.users.promoteToSuperAdmin, { email: 'staff@a.com' })
    const rows = await t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(rows.find((r) => r.actionType === 'promote_super_admin')).toMatchObject({
      recordId: staffA, previousValues: { role: 'user' },
    })
  })
})
