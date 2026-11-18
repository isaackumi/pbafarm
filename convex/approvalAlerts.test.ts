/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const HOUR = 3_600_000

let fetchCalls: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
  fetchCalls = []
  // No test may reach a real provider: anything unscripted fails loudly.
  vi.stubGlobal('fetch', async (url: string) => {
    fetchCalls.push(String(url))
    throw new Error(`unexpected fetch ${url}`)
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const north = await ctx.db.insert('farmLocations', { companyId, name: 'North', active: true, updatedAt: now })
    const south = await ctx.db.insert('farmLocations', { companyId, name: 'South', active: true, updatedAt: now })
    // Legacy admin (no membership row): approver at every site.
    const adminId = await ctx.db.insert('users', { name: 'Ama', email: 'a@x.com', phone: '+233200000001', role: 'admin', companyId })
    // Manager template: can request, cannot approve.
    const managerId = await ctx.db.insert('users', { name: 'Kofi', email: 'm@x.com', role: 'user', companyId })
    const member = async (name: string, roleKey: string, locationIds?: any[]) => {
      const id = await ctx.db.insert('users', { name, email: `${name}@x.com`, role: roleKey === 'admin' ? 'admin' : 'user', companyId })
      await ctx.db.insert('memberships', {
        userId: id, companyId, roleKey, allLocations: !locationIds, locationIds, status: 'active', updatedAt: now,
      })
      return id
    }
    const staffId = await member('Esi', 'field_staff')
    const southAdminId = await member('Yaw', 'admin', [south])
    const cageId = await ctx.db.insert('cages', {
      name: 'N1', status: 'empty', currentCount: 0, capacity: 100000, locationId: north, companyId, updatedAt: now,
    })
    return { companyId, north, south, adminId, managerId, staffId, southAdminId, cageId }
  })
  const as = (id: any) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

const notesFor = (t: any, userId: any) =>
  t.run((ctx: any) => ctx.db.query('notifications').withIndex('by_user', (q: any) => q.eq('userId', userId)).collect())

const dispatches = (t: any) => t.run((ctx: any) => ctx.db.query('notificationDispatches').collect())

const requestStocking = (as: any, staffId: any, cageId: any) =>
  as(staffId).mutation(api.stocking.createStocking, {
    cageId, stockingDate: '2026-11-18', fishCount: 5000, initialAbw: 10, initialBiomass: 50,
  })

describe('approval notifications (AUTO-004)', () => {
  test('a pending stocking notifies approvers in scope only, on the configured channels', async () => {
    const { t, as, adminId, managerId, staffId, southAdminId, cageId } = await setup()
    await requestStocking(as, staffId, cageId)

    const [note] = await notesFor(t, adminId)
    expect(note).toMatchObject({ title: 'Stocking needs approval', link: '/approvals', read: false })
    expect(note.message).toMatch(/^Esi: .*5,000 fish.*N1/)
    // No approve permission, other site, or the requester: nothing.
    expect(await notesFor(t, managerId)).toHaveLength(0)
    expect(await notesFor(t, southAdminId)).toHaveLength(0)
    expect(await notesFor(t, staffId)).toHaveLength(0)

    // Email (default channel) is queued for the admin; with no route it fails without a network call.
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    const [d] = await dispatches(t)
    expect(d.source).toBe('approval.requested')
    expect(d.deliveries).toEqual([expect.objectContaining({ channel: 'email', to: 'a@x.com', status: 'failed' })])
    expect(d.status).toBe('failed')
    expect(fetchCalls).toEqual([])

    const events = await t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(events.map((e) => e.type)).toContain('approval.requested')
  })

  test('escalates after the delay when still pending; not once decided; requester hears the decision', async () => {
    const { t, as, adminId, staffId, cageId } = await setup()
    await as(adminId).mutation(api.approvalAlerts.updateSettings, {
      enabled: true, channels: ['in_app'], escalateAfterHours: 2, escalationChannels: ['in_app'],
    })
    await requestStocking(as, staffId, cageId)
    vi.advanceTimersByTime(2 * HOUR + 1000)
    await t.finishInProgressScheduledFunctions()
    let notes = await notesFor(t, adminId)
    expect(notes.map((n: any) => n.title).sort()).toEqual(['Stocking needs approval', 'Stocking still waiting for approval'])
    expect(notes.find((n: any) => n.type === 'warning').message).toMatch(/has waited more than 2 h\.$/)

    // Second request, approved before the deadline: no escalation.
    const cage2 = await t.run(async (ctx) => {
      const c = (await ctx.db.get(cageId))!
      return ctx.db.insert('cages', { name: 'N2', status: 'empty', currentCount: 0, capacity: 100000, locationId: c.locationId, companyId: c.companyId, updatedAt: Date.now() })
    })
    const id2 = await requestStocking(as, staffId, cage2)
    await as(adminId).mutation(api.stocking.approveStocking, { id: id2 })
    vi.advanceTimersByTime(2 * HOUR + 1000)
    await t.finishInProgressScheduledFunctions()
    notes = await notesFor(t, adminId)
    expect(notes.filter((n: any) => n.title === 'Stocking still waiting for approval')).toHaveLength(1)

    const mine = await notesFor(t, staffId)
    expect(mine).toEqual([expect.objectContaining({ title: 'Stocking approved', link: '/stocking' })])
  })

  test('escalation off (0 h) schedules nothing; alerts off sends nothing', async () => {
    const { t, as, adminId, staffId, cageId } = await setup()
    await as(adminId).mutation(api.approvalAlerts.updateSettings, {
      enabled: true, channels: ['in_app'], escalateAfterHours: 0, escalationChannels: ['in_app'],
    })
    await requestStocking(as, staffId, cageId)
    expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0)

    await as(adminId).mutation(api.approvalAlerts.updateSettings, {
      enabled: false, channels: ['in_app'], escalateAfterHours: 24, escalationChannels: ['in_app'],
    })
    const cage2 = await t.run(async (ctx) => {
      const c = (await ctx.db.get(cageId))!
      return ctx.db.insert('cages', { name: 'N2', status: 'empty', currentCount: 0, capacity: 100000, locationId: c.locationId, companyId: c.companyId, updatedAt: Date.now() })
    })
    await requestStocking(as, staffId, cage2)
    await expect(as(staffId).mutation(api.approvalAlerts.updateSettings, {
      enabled: true, channels: ['in_app'], escalateAfterHours: 1, escalationChannels: [],
    })).rejects.toThrow(/Insufficient permissions/)
    expect(await notesFor(t, adminId)).toHaveLength(1)
  })

  test('a join request notifies members who manage members', async () => {
    const { t, as, adminId, managerId, companyId } = await setup()
    const { requesterId } = await t.run(async (ctx) => {
      await ctx.db.insert('userInvites', { email: 'new@x.com', role: 'user', companyId, status: 'pending', createdAt: Date.now() })
      const requesterId = await ctx.db.insert('users', { name: 'Nana', email: 'new@x.com' })
      return { requesterId }
    })
    await as(requesterId).mutation(api.users.claimInvite, {})
    const [note] = await notesFor(t, adminId)
    expect(note).toMatchObject({ title: 'Join request needs approval', link: '/users' })
    expect(note.message).toBe('Nana: Nana asked to join as user.')
    expect(await notesFor(t, managerId)).toHaveLength(0)
  })
})

describe('system notification delivery (AUTO-003)', () => {
  const smsEnv = () => {
    vi.stubEnv('PLATFORM_SMS_PROVIDER', 'twilio')
    vi.stubEnv('PLATFORM_TWILIO_ACCOUNT_SID', 'AC1')
    vi.stubEnv('PLATFORM_TWILIO_AUTH_TOKEN', 'tok')
    vi.stubEnv('PLATFORM_SMS_SENDER', '+15550001111')
  }

  test('SMS: a transient failure is retried with back-off, then sent', async () => {
    const { t, as, adminId, staffId, cageId } = await setup()
    smsEnv()
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return calls === 1
        ? new Response('{"message":"Too many requests"}', { status: 429 })
        : new Response('{"sid":"SM1","status":"queued"}', { status: 201 })
    })
    await as(adminId).mutation(api.approvalAlerts.updateSettings, {
      enabled: true, channels: ['in_app', 'sms'], escalateAfterHours: 0, escalationChannels: ['in_app'],
    })
    await requestStocking(as, staffId, cageId)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const [d] = await dispatches(t)
    expect(calls).toBe(2)
    expect(d).toMatchObject({ status: 'succeeded', attempts: 2 })
    expect(d.deliveries[0]).toMatchObject({ channel: 'sms', to: '+233200000001', status: 'sent', providerMessageId: 'SM1' })
    expect(d.deliveries[0].body).toMatch(/^Stocking needs approval: Esi: Stocking 5,000 fish into N1/)
  })

  test('SMS: a 4xx is not retried; quiet hours and opted-out channels skip the send', async () => {
    const { t, as, adminId, staffId, cageId } = await setup()
    smsEnv()
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return new Response('{"message":"Invalid To number"}', { status: 400 })
    })
    await as(adminId).mutation(api.approvalAlerts.updateSettings, {
      enabled: true, channels: ['in_app', 'sms', 'email'], escalateAfterHours: 0, escalationChannels: ['in_app'],
    })
    await as(adminId).mutation(api.notificationPreferences.update, { inApp: true, sms: true, whatsapp: true, email: false })
    await requestStocking(as, staffId, cageId)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    let [d] = await dispatches(t)
    expect(calls).toBe(1)
    expect(d.status).toBe('failed')
    expect(d.deliveries).toHaveLength(1)
    expect(d.error).toMatch(/sms to \+233200000001: .*Invalid To number/)

    await as(adminId).mutation(api.notificationPreferences.update, {
      inApp: true, sms: true, whatsapp: true, email: false, quietHours: { start: '09:00', end: '11:00' },
    })
    await as(adminId).mutation(api.approvalAlerts.updateSettings, {
      enabled: true, channels: ['sms'], escalateAfterHours: 24, escalationChannels: ['sms'],
    })
    const stocking = (await t.run((ctx) => ctx.db.query('stockingHistory').first()))!
    await t.mutation(internal.approvalAlerts.escalate, { kind: 'stocking', recordId: stocking._id, afterHours: 24 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const all = await dispatches(t)
    d = all.find((x: any) => x.source === 'approval.escalated')
    expect(d.status).toBe('skipped')
    expect(d.deliveries[0]).toMatchObject({ status: 'skipped', error: 'Quiet hours' })
    expect(calls).toBe(1)
  })
})

describe('notifications list (AUTO-003)', () => {
  test('newest first, bounded, paginated and unread-only', async () => {
    const { t, as, adminId } = await setup()
    for (let i = 0; i < 5; i++) {
      await t.mutation(internal.notifications.create, { userId: adminId, title: `N${i}`, message: 'm' })
      vi.advanceTimersByTime(1000)
    }
    const list = await as(adminId).query(api.notifications.listForCurrentUser, { limit: 3 })
    expect(list.map((n: any) => n.title)).toEqual(['N4', 'N3', 'N2'])
    await as(adminId).mutation(api.notifications.markRead, { id: list[0].id })
    const page = await as(adminId).query(api.notifications.listPage, {
      paginationOpts: { numItems: 2, cursor: null }, unreadOnly: true,
    })
    expect(page.page.map((n: any) => n.title)).toEqual(['N3', 'N2'])
    expect(page.isDone).toBe(false)
    expect(await as(adminId).query(api.notifications.getUnreadCount, {})).toBe(4)
  })
})
