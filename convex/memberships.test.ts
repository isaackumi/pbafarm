/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { authErrorCode } from './lib/authErrors'
import { pickEmailAdapter } from './lib/email'

const modules = import.meta.glob('./**/*.ts')

// Mutations schedule emails; fake timers keep them from running after a test.
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

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
      companyId: companyA, name: 'Lake site', active: true, updatedAt: now,
    })
    const siteB = await ctx.db.insert('farmLocations', {
      companyId: companyB, name: 'River site', active: true, updatedAt: now,
    })
    const user = (email: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert('users', { email, role: 'user', ...extra } as any)
    const adminA = await user('admin@a.com', { role: 'admin', companyId: companyA, activeLocationId: siteA })
    const staffA = await user('staff@a.com', { companyId: companyA, activeLocationId: siteA })
    const goneA = await user('gone@a.com', { companyId: companyA, active: false })
    const adminB = await user('admin@b.com', { role: 'admin', companyId: companyB, activeLocationId: siteB })
    const loner = await user('loner@x.com')
    const platform = await user('owner@platform.com', { role: 'super_admin' })
    await ctx.db.insert('cages', {
      name: 'A1', status: 'active', companyId: companyA, locationId: siteA, updatedAt: now,
    })
    await ctx.db.insert('cages', {
      name: 'B1', status: 'active', companyId: companyB, locationId: siteB, updatedAt: now,
    })
    return { companyA, companyB, siteA, siteB, adminA, staffA, goneA, adminB, loner, platform }
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

function tokenOf(url: string) {
  return url.split('/invite/')[1]
}

/** The last email scheduled to `to` (text body). */
async function lastEmailTo(t: Awaited<ReturnType<typeof setup>>['t'], to: string) {
  const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
  const mine = jobs.filter((j) => (j.args[0] as { to?: string })?.to === to)
  return (mine[mine.length - 1]?.args[0] as { text: string }).text
}

async function verifyEmail(t: Awaited<ReturnType<typeof setup>>['t'], as: (id: string) => any, userId: string, email: string) {
  await as(userId).mutation(api.emailVerification.requestCode, {})
  const code = /code is (\d{6})/.exec(await lastEmailTo(t, email))![1]
  return as(userId).mutation(api.emailVerification.verify, { code })
}

describe('M2 memberships backfill', () => {
  test('dry run writes nothing; the real run gives every user one matching membership; a rerun is a no-op', async () => {
    const { t, adminA, staffA, goneA, adminB } = await setup()
    const dry = await t.mutation(internal.migrations.m2BackfillMemberships, {})
    expect(dry).toMatchObject({ dryRun: true, created: 4 })
    expect(await t.run((ctx) => ctx.db.query('memberships').collect())).toHaveLength(0)

    const run = await t.mutation(internal.migrations.m2BackfillMemberships, { dryRun: false })
    expect(run).toMatchObject({ dryRun: false, created: 4, isDone: true })
    const rows = await t.run((ctx) => ctx.db.query('memberships').collect())
    const byUser = Object.fromEntries(rows.map((m) => [m.userId, m]))
    expect(byUser[adminA]).toMatchObject({ roleKey: 'admin', status: 'active', allLocations: true, legacy: true })
    expect(byUser[staffA]).toMatchObject({ roleKey: 'manager', status: 'active' })
    expect(byUser[goneA]).toMatchObject({ roleKey: 'manager', status: 'suspended' })
    expect(byUser[adminB]).toMatchObject({ roleKey: 'admin' })

    const again = await t.mutation(internal.migrations.m2BackfillMemberships, { dryRun: false })
    expect(again).toMatchObject({ created: 0 })
    expect(await t.run((ctx) => ctx.db.query('memberships').collect())).toHaveLength(4)
    expect(await t.query(internal.migrations.m2VerifyMemberships, {})).toMatchObject({
      checked: 4, problems: [],
    })
  })

  test('the guard falls back to users.companyId before the backfill (dual-read)', async () => {
    const { as, staffA } = await setup()
    const cages = await as(staffA).query(api.cages.list, {})
    expect(cages.map((c: any) => c.name)).toEqual(['A1'])
  })

  test('M3 fills profile defaults only where unset', async () => {
    const { t, companyA } = await setup()
    await t.run((ctx) => ctx.db.patch(companyA, { timezone: 'Africa/Lagos' }))
    const r = await t.mutation(internal.migrations.m3CompanyProfileDefaults, { dryRun: false })
    expect(r.count).toBe(2)
    const a = await t.run((ctx) => ctx.db.get(companyA))
    expect(a).toMatchObject({ timezone: 'Africa/Lagos', unitSystem: 'metric', country: 'GH' })
  })
})

describe('invites with single-use expiring links', () => {
  test('a member of B invited to A accepts after verifying email, switches, and sees only the active org', async () => {
    const { t, as, adminA, adminB, companyA, companyB } = await setup()
    const inv = await as(adminA).mutation(api.users.invite, { email: 'admin@b.com', roleKey: 'field_staff' })
    expect(inv.inviteUrl).toMatch(/\/invite\/[0-9a-f]{64}$/)
    const token = tokenOf(inv.inviteUrl)
    expect(await lastEmailTo(t, 'admin@b.com')).toContain(inv.inviteUrl)
    // Only the hash is stored.
    const stored = await t.run((ctx) => ctx.db.query('userInvites').collect())
    expect(JSON.stringify(stored)).not.toContain(token)

    expect(await as(adminB).query(api.memberships.inviteInfo, { token })).toMatchObject({
      companyName: 'Lake Farm', state: 'pending', roleKey: 'field_staff',
    })
    // Unverified email cannot accept (V3).
    expect(await codeOf(as(adminB).mutation(api.memberships.acceptInvite, { token }))).toMatch(/EMAIL_NOT_VERIFIED/)
    expect(await verifyEmail(t, as, adminB, 'admin@b.com')).toEqual({ verified: true })

    const r = await as(adminB).mutation(api.memberships.acceptInvite, { token })
    expect(r).toEqual({ companyId: companyA, activated: false })
    // Still working in B; A is a second membership.
    const mine = await as(adminB).query(api.memberships.listMine, {})
    expect(mine.map((m: any) => [m.name, m.roleKey, m.isActive])).toEqual([
      ['Lake Farm', 'field_staff', false],
      ['River Farm', 'admin', true],
    ])
    expect((await as(adminB).query(api.cages.list, {})).map((c: any) => c.name)).toEqual(['B1'])

    await as(adminB).mutation(api.memberships.switchActive, { companyId: companyA })
    const me = await t.run((ctx) => ctx.db.get(adminB))
    expect(me).toMatchObject({ companyId: companyA, role: 'user' })
    expect((await as(adminB).query(api.cages.list, {})).map((c: any) => c.name)).toEqual(['A1'])

    await as(adminB).mutation(api.memberships.switchActive, { companyId: companyB })
    expect(await t.run((ctx) => ctx.db.get(adminB))).toMatchObject({ companyId: companyB, role: 'admin' })
    expect((await as(adminB).query(api.cages.list, {})).map((c: any) => c.name)).toEqual(['B1'])

    // Single use.
    expect(await codeOf(as(adminB).mutation(api.memberships.acceptInvite, { token }))).toMatch(/already been used/)
  })

  test('a company-less invitee is activated into the inviting org on accept', async () => {
    const { t, as, adminA, loner, companyA, siteA } = await setup()
    const inv = await as(adminA).mutation(api.users.invite, { email: 'loner@x.com' })
    await verifyEmail(t, as, loner, 'loner@x.com')
    const r = await as(loner).mutation(api.memberships.acceptInvite, { token: tokenOf(inv.inviteUrl) })
    expect(r.activated).toBe(true)
    expect(await t.run((ctx) => ctx.db.get(loner))).toMatchObject({
      companyId: companyA, role: 'user', activeLocationId: siteA,
    })
  })

  test('an expired invite fails', async () => {
    const { t, as, adminA, loner } = await setup()
    const inv = await as(adminA).mutation(api.users.invite, { email: 'loner@x.com' })
    await verifyEmail(t, as, loner, 'loner@x.com')
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const token = tokenOf(inv.inviteUrl)
    expect(await as(loner).query(api.memberships.inviteInfo, { token })).toMatchObject({ state: 'expired' })
    expect(await codeOf(as(loner).mutation(api.memberships.acceptInvite, { token }))).toMatch(/expired/)
  })

  test('another account cannot use the link, and a revoked link fails', async () => {
    const { t, as, adminA, adminB, loner } = await setup()
    const inv = await as(adminA).mutation(api.users.invite, { email: 'loner@x.com' })
    const token = tokenOf(inv.inviteUrl)
    await verifyEmail(t, as, adminB, 'admin@b.com')
    expect(await codeOf(as(adminB).mutation(api.memberships.acceptInvite, { token }))).toMatch(/This invite is for loner@x.com/)
    const [open] = await as(adminA).query(api.memberships.listInvites, {})
    await as(adminA).mutation(api.memberships.revokeInvite, { inviteId: open.id })
    await verifyEmail(t, as, loner, 'loner@x.com')
    expect(await codeOf(as(loner).mutation(api.memberships.acceptInvite, { token }))).toMatch(/already been used or withdrawn/)
  })

  test('a wrong token reveals nothing', async () => {
    const { as, loner } = await setup()
    expect(await as(loner).query(api.memberships.inviteInfo, { token: 'f'.repeat(64) })).toBeNull()
    expect(await as(loner).query(api.memberships.inviteInfo, { token: 'nope' })).toBeNull()
  })
})

describe('email verification', () => {
  test('a wrong code counts an attempt; five wrong codes lock the code', async () => {
    const { t, as, loner } = await setup()
    await as(loner).mutation(api.emailVerification.requestCode, {})
    for (let i = 0; i < 5; i++) {
      expect(await as(loner).mutation(api.emailVerification.verify, { code: 'xxxxxx' })).toEqual({ verified: false })
    }
    const code = /code is (\d{6})/.exec(await lastEmailTo(t, 'loner@x.com'))![1]
    expect(await codeOf(as(loner).mutation(api.emailVerification.verify, { code }))).toMatch(/Too many attempts/)
  })

  test('account emails use the platform default email channel, else the log', () => {
    expect(pickEmailAdapter({}).name).toBe('log')
    expect(pickEmailAdapter({ RESEND_API_KEY: 'k' }).name).toBe('log')
    expect(
      pickEmailAdapter({
        PLATFORM_EMAIL_PROVIDER: 'resend',
        PLATFORM_EMAIL_SENDER: 'PBA <a@b.c>',
        PLATFORM_RESEND_API_KEY: 'k',
      }).name,
    ).toBe('resend')
  })
})

describe('admin membership management', () => {
  test('suspending a member with no other org refuses their access and ends sessions', async () => {
    const { t, as, adminA, staffA } = await setup()
    await as(adminA).mutation(api.memberships.suspend, { userId: staffA })
    const staff = await t.run((ctx) => ctx.db.get(staffA))
    expect(staff?.companyId).toBeUndefined()
    expect(await codeOf(as(staffA).query(api.cages.list, {}))).toBe('NO_COMPANY')
    await as(adminA).mutation(api.memberships.reactivate, { userId: staffA })
    expect((await as(staffA).query(api.cages.list, {})).map((c: any) => c.name)).toEqual(['A1'])
  })

  test('a suspended membership on the active pointer is refused by the guard (NOT_A_MEMBER)', async () => {
    const { t, as, staffA, companyA } = await setup()
    await t.run((ctx) =>
      ctx.db.insert('memberships', {
        userId: staffA, companyId: companyA, roleKey: 'manager', allLocations: true,
        status: 'suspended', updatedAt: Date.now(),
      }),
    )
    expect(await codeOf(as(staffA).query(api.cages.list, {}))).toBe('NOT_A_MEMBER')
  })

  test('the last admin cannot be demoted or removed; roles mirror users.role', async () => {
    const { t, as, adminA, staffA } = await setup()
    await expect(as(adminA).mutation(api.memberships.setRole, { userId: adminA, roleKey: 'manager' })).rejects.toThrow(/at least one active admin/)
    await as(adminA).mutation(api.memberships.setRole, { userId: staffA, roleKey: 'admin' })
    expect(await t.run((ctx) => ctx.db.get(staffA))).toMatchObject({ role: 'admin' })
    await as(adminA).mutation(api.memberships.setRole, { userId: staffA, roleKey: 'viewer' })
    expect(await t.run((ctx) => ctx.db.get(staffA))).toMatchObject({ role: 'user' })
  })

  test('a non-owner admin cannot demote the owner through users.update (audit A C4)', async () => {
    const { t, as, adminA, staffA, companyA } = await setup()
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.patch(staffA, { role: 'admin' })
      await ctx.db.insert('memberships', { userId: adminA, companyId: companyA, roleKey: 'owner', allLocations: true, status: 'active', updatedAt: now })
      await ctx.db.insert('memberships', { userId: staffA, companyId: companyA, roleKey: 'admin', allLocations: true, status: 'active', updatedAt: now })
    })
    await expect(as(staffA).mutation(api.memberships.setRole, { userId: adminA, roleKey: 'manager' })).rejects.toThrow(/owner/i)
    await expect(as(staffA).mutation(api.users.update, { id: adminA, patch: { role: 'user' } })).rejects.toThrow(/owner/i)
    const owner = await t.run(async (ctx) => ({
      user: await ctx.db.get(adminA),
      membership: await ctx.db.query('memberships').withIndex('by_userId', (q) => q.eq('userId', adminA)).first(),
    }))
    expect(owner.membership?.roleKey).toBe('owner')
    expect(owner.user?.role).toBe('admin')
    // An owner may still change another admin's role through users.update.
    await as(adminA).mutation(api.users.update, { id: staffA, patch: { role: 'user' } })
    expect((await t.run((ctx) => ctx.db.get(staffA)))?.role).toBe('user')
  })

  test("an admin cannot manage another company's member, and members cannot switch into orgs they are not in", async () => {
    const { as, adminA, adminB, companyB, staffA } = await setup()
    await expect(as(adminA).mutation(api.memberships.suspend, { userId: adminB })).rejects.toThrow(/not found/)
    await expect(as(staffA).mutation(api.memberships.switchActive, { companyId: companyB })).rejects.toThrow(/not a member/)
    await expect(as(staffA).query(api.memberships.listMembers, {})).rejects.toThrow(/Insufficient/)
  })

  test('listMembers shows backfilled and not-yet-backfilled members', async () => {
    const { as, adminA } = await setup()
    const rows = await as(adminA).query(api.memberships.listMembers, {})
    expect(rows.map((r: any) => [r.email, r.roleKey, r.status]).sort()).toEqual([
      ['admin@a.com', 'admin', 'active'],
      ['gone@a.com', 'manager', 'suspended'],
      ['staff@a.com', 'manager', 'active'],
    ])
  })
})

describe('registering a second organization', () => {
  test('a member of A can register B2; approval makes them its owner without moving them', async () => {
    const { t, as, staffA, platform, companyA } = await setup()
    const id = await as(staffA).mutation(api.companies.register, { name: 'Pond Co', code: 'POND' })
    expect(await as(staffA).query(api.companies.myRegistration, {})).toMatchObject({ status: 'pending' })
    await expect(as(staffA).mutation(api.companies.register, { name: 'Again', code: 'AGAIN' })).rejects.toThrow(/waiting/)
    await as(platform).mutation(api.companies.approve, { companyId: id })
    // The platform action is filed under the approved organization (ORG-006).
    const audit = await t.run((ctx) =>
      ctx.db.query('auditLogs').withIndex('by_company', (q) => q.eq('companyId', id)).collect(),
    )
    expect(audit.find((a) => a.actionType === 'approve')).toMatchObject({ userId: platform })
    expect(await t.run((ctx) => ctx.db.get(staffA))).toMatchObject({ companyId: companyA, role: 'user' })
    const mine = await as(staffA).query(api.memberships.listMine, {})
    expect(mine.find((m: any) => m.name === 'Pond Co')).toMatchObject({ roleKey: 'owner', isActive: false })
    await as(staffA).mutation(api.memberships.switchActive, { companyId: id })
    expect(await t.run((ctx) => ctx.db.get(staffA))).toMatchObject({ companyId: id, role: 'admin' })
    // approval created a default site for the new org
    expect((await t.run((ctx) => ctx.db.get(staffA)))?.activeLocationId).toBeDefined()
  })

  test('organization profile is validated and defaults to Ghana', async () => {
    const { as, adminA, staffA } = await setup()
    const c = await as(adminA).query(api.companies.getCurrentCompany, {})
    expect(c?.profile).toEqual({ country: 'GH', timezone: 'Africa/Accra', unitSystem: 'metric', defaultLocale: 'en-GH' })
    await expect(as(adminA).mutation(api.companies.updateProfile, { timezone: 'Mars/Base' })).rejects.toThrow(/Unknown time zone/)
    await expect(as(staffA).mutation(api.companies.updateProfile, { timezone: 'UTC' })).rejects.toThrow(/Insufficient/)
    const p = await as(adminA).mutation(api.companies.updateProfile, { timezone: 'Africa/Nairobi', country: 'ke' })
    expect(p).toMatchObject({ timezone: 'Africa/Nairobi', country: 'KE' })
  })
})
