/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { logOutbound, maskAddress, periodOf } from './messaging/outbox'

const modules = import.meta.glob('./**/*.ts')

/** Paper 57b Outbox and usage meters. Two companies; an admin and a field staff member of A. */
async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', name: 'Kwame Asante', role: 'admin', companyId: companyA })
    const staffA = await ctx.db.insert('users', { email: 'yaw@a.com', name: 'Yaw Boateng', role: 'user', companyId: companyA })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', name: 'Esi B', role: 'admin', companyId: companyB })
    const member = (userId: Id<'users'>, companyId: Id<'companies'>, roleKey: string) =>
      ctx.db.insert('memberships', { userId, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now })
    await member(adminA, companyA, 'owner')
    await member(staffA, companyA, 'field_staff')
    await member(adminB, companyB, 'owner')
    return { companyA, companyB, adminA, staffA, adminB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

type S = Awaited<ReturnType<typeof setup>>

async function messageOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    return (err as Error).message
  }
  return 'resolved'
}

const PAGE = { numItems: 25, cursor: null }

/** Five rows in A (2 sent, 1 queued, 2 failed) and one sent row in B. */
async function seed(s: S) {
  await s.t.run(async (ctx) => {
    const a = s.companyA
    await logOutbound(ctx, { companyId: a, channel: 'sms', status: 'sent', source: 'automation', to: '+233244123456', recipientUserId: s.staffA, body: 'DO low at C-07 (3.1 mg/L). Check aerator.' })
    await logOutbound(ctx, { companyId: a, channel: 'telegram', status: 'sent', source: 'bot_reminder', to: '987654321', recipientUserId: s.adminA, body: 'Daily entry missing for 3 cages' })
    await logOutbound(ctx, { companyId: a, channel: 'whatsapp', status: 'queued', source: 'notification', to: '+233201112233', recipientName: 'Golden Tilapia Co.', body: 'Invoice INV-2026-0145', key: 'nd:x:0', nextAttemptAt: Date.now() + 60_000 })
    await logOutbound(ctx, { companyId: a, channel: 'sms', status: 'failed', source: 'notification', to: '+233244999888', recipientUserId: s.staffA, body: 'Approval needed: transfer 1,200 fish C-03 to C-09', error: 'Invalid number' })
    await logOutbound(ctx, { companyId: a, channel: 'email', status: 'failed', source: 'report', to: 'kwame@lake.com', recipientUserId: s.adminA, body: 'Weekly Anowa report', error: 'Bounced' })
    await logOutbound(ctx, { companyId: s.companyB, channel: 'sms', status: 'sent', source: 'automation', to: '+233244000111', recipientUserId: s.adminB, body: 'River secret alert' })
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('outbox list', () => {
  test('filters All / Queued / Failed, newest first, with masked recipients only', async () => {
    const s = await setup()
    await seed(s)
    const admin = s.as(s.adminA)
    const all = await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' })
    expect(all.page).toHaveLength(5)
    expect(all.page[0].channel).toBe('email')
    expect(all.page.map((r) => r.status).sort()).toEqual(['failed', 'failed', 'queued', 'sent', 'sent'])

    const queued = await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'queued' })
    expect(queued.page.map((r) => r.recipientName)).toEqual(['Golden Tilapia Co.'])
    expect(queued.page[0].nextAttemptAt).toBeGreaterThan(0)

    const failed = await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'failed' })
    expect(failed.page).toHaveLength(2)
    expect(failed.page.every((r) => r.status === 'failed')).toBe(true)

    const json = JSON.stringify(all.page)
    expect(json).not.toContain('244123456')
    expect(json).not.toContain('kwame@lake.com')
    expect(json).not.toContain('987654321')
    const yaw = all.page.find((r) => r.channel === 'sms' && r.status === 'sent')!
    expect(yaw.recipientName).toBe('Yaw Boateng')
    expect(yaw.roleKey).toBe('field_staff')
    expect(yaw.toMasked).toBe(maskAddress('sms', '+233244123456'))
  })

  test('paginates with a cursor', async () => {
    const s = await setup()
    await seed(s)
    const admin = s.as(s.adminA)
    const first = await admin.query(api.messaging.outbox.list, { paginationOpts: { numItems: 2, cursor: null }, filter: 'all' })
    expect(first.page).toHaveLength(2)
    expect(first.isDone).toBe(false)
    const second = await admin.query(api.messaging.outbox.list, { paginationOpts: { numItems: 2, cursor: first.continueCursor }, filter: 'all' })
    const third = await admin.query(api.messaging.outbox.list, { paginationOpts: { numItems: 2, cursor: second.continueCursor }, filter: 'all' })
    const ids = [...first.page, ...second.page, ...third.page].map((r) => r.id)
    expect(new Set(ids).size).toBe(5)
    expect(third.isDone).toBe(true)
  })

  test('tenant isolation: each organization sees only its own messages', async () => {
    const s = await setup()
    await seed(s)
    const b = await s.as(s.adminB).query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' })
    expect(b.page).toHaveLength(1)
    expect(b.page[0].body).toBe('River secret alert')
    const a = await s.as(s.adminA).query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' })
    expect(JSON.stringify(a.page)).not.toContain('River secret alert')
    const found = await s.as(s.adminA).query(api.messaging.outbox.search, { text: 'River', filter: 'all' })
    expect(found).toHaveLength(0)

    // B cannot retry A's failed message.
    const failedA = (await s.as(s.adminA).query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'failed' })).page[0]
    expect(await messageOf(s.as(s.adminB).mutation(api.messaging.outbox.retry, { messageId: failedA.id }))).toContain('not found')
  })

  test('members without integrations.manage are refused', async () => {
    const s = await setup()
    await seed(s)
    const staff = s.as(s.staffA)
    const DENIED = 'Insufficient permissions'
    expect(await messageOf(staff.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' }))).toContain(DENIED)
    expect(await messageOf(staff.query(api.messaging.outbox.search, { text: 'aerator', filter: 'all' }))).toContain(DENIED)
    expect(await messageOf(staff.query(api.messaging.outbox.usage, { period: '2026-11' }))).toContain(DENIED)
    const any = await s.t.run(async (ctx) => (await ctx.db.query('outboundMessages').first())!._id)
    expect(await messageOf(staff.mutation(api.messaging.outbox.retry, { messageId: any }))).toContain(DENIED)
    expect(await messageOf(s.t.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' }))).not.toBe('resolved')
  })

  test('search finds by recipient name and message', async () => {
    const s = await setup()
    await seed(s)
    const admin = s.as(s.adminA)
    const hits = await admin.query(api.messaging.outbox.search, { text: 'aerator', filter: 'all' })
    expect(hits.map((r) => r.recipientName)).toEqual(['Yaw Boateng'])
    const failedOnly = await admin.query(api.messaging.outbox.search, { text: 'Yaw', filter: 'failed' })
    expect(failedOnly).toHaveLength(1)
    expect(failedOnly[0].status).toBe('failed')
  })
})

describe('usage meters', () => {
  test('counts sent messages per channel and WhatsApp conversations per 24 h', async () => {
    const s = await setup()
    await seed(s)
    await s.t.run(async (ctx) => {
      const a = s.companyA
      // Two WhatsApp messages to the same person: one conversation.
      await logOutbound(ctx, { companyId: a, channel: 'whatsapp', status: 'sent', source: 'notification', to: '+233200000001', recipientUserId: s.staffA, body: 'one' })
      await logOutbound(ctx, { companyId: a, channel: 'whatsapp', status: 'sent', source: 'notification', to: '+233200000001', recipientUserId: s.staffA, body: 'two' })
      await logOutbound(ctx, { companyId: a, channel: 'whatsapp', status: 'sent', source: 'notification', to: '+233200000002', recipientUserId: s.adminA, body: 'three' })
      // A queued row becoming sent counts once, even when synced twice.
      await logOutbound(ctx, { companyId: a, channel: 'sms', status: 'queued', source: 'automation', to: '+233244555666', key: 'ar:r:0' })
      await logOutbound(ctx, { companyId: a, channel: 'sms', status: 'sent', source: 'automation', to: '+233244555666', key: 'ar:r:0' })
      await logOutbound(ctx, { companyId: a, channel: 'sms', status: 'sent', source: 'automation', to: '+233244555666', key: 'ar:r:0' })
    })
    const u = await s.as(s.adminA).query(api.messaging.outbox.usage, { period: periodOf(Date.now()) })
    expect(u.sms).toEqual({ used: 2, budget: 5000 })
    expect(u.whatsapp).toEqual({ used: 2, budget: 1000 })
    expect(u.email).toEqual({ used: 0, budget: 10000 })
    const other = await s.as(s.adminA).query(api.messaging.outbox.usage, { period: '2020-01' })
    expect(other.sms.used).toBe(0)
    const b = await s.as(s.adminB).query(api.messaging.outbox.usage, { period: periodOf(Date.now()) })
    expect(b.sms.used).toBe(1)
    expect(await messageOf(s.as(s.adminA).query(api.messaging.outbox.usage, { period: 'nope' }))).toContain('Invalid period')
  })

  test('budgets come from the company settings', async () => {
    const s = await setup()
    await s.as(s.adminA).mutation(api.messaging.channels.updatePreferences, { monthlyBudget: { sms: 2500 } })
    const u = await s.as(s.adminA).query(api.messaging.outbox.usage, { period: '2026-11' })
    expect(u.sms.budget).toBe(2500)
    expect(u.whatsapp.budget).toBe(1000)
    expect(
      await messageOf(s.as(s.adminA).mutation(api.messaging.channels.updatePreferences, { monthlyBudget: { sms: 0 } })),
    ).toContain('whole number')
  })

  test('Telegram: people linked out of active members, bot status from env', async () => {
    const s = await setup()
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token')
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'secret')
    vi.stubEnv('TELEGRAM_BOT_USERNAME', '@askAnowa_bot')
    await s.t.run(async (ctx) => {
      const now = Date.now()
      const bind = (userId: Id<'users'>, companyId: Id<'companies'>, extra: Record<string, unknown> = {}) =>
        ctx.db.insert('channelBindings', { provider: 'telegram', address: `${Math.random()}`, userId, companyId, verifiedAt: now, ...extra })
      await bind(s.staffA, s.companyA)
      await bind(s.staffA, s.companyA)
      await bind(s.adminA, s.companyA, { revokedAt: now })
      await bind(s.adminB, s.companyB)
      await ctx.db.insert('channelBindings', { provider: 'whatsapp', address: '+233200000009', userId: s.adminA, companyId: s.companyA, verifiedAt: now })
    })
    const u = await s.as(s.adminA).query(api.messaging.outbox.usage, { period: '2026-11' })
    expect(u.telegram).toEqual({ configured: true, botUsername: 'askAnowa_bot', linked: 1, members: 2 })
  })
})

describe('send paths', () => {
  test('a notification dispatch is logged queued, retried, failed, then retried from the Outbox', async () => {
    // Scheduled sends stay pending; the test drives start/finish itself.
    vi.useFakeTimers()
    const s = await setup()
    const dispatchId = await s.t.run(async (ctx) =>
      ctx.db.insert('notificationDispatches', {
        companyId: s.companyA,
        source: 'approval.requested',
        title: 'Approval needed',
        status: 'queued',
        attempts: 0,
        maxAttempts: 2,
        deliveries: [
          { channel: 'sms', userId: s.staffA, to: '+233244123456', subject: 'Approval', body: 'Approval needed: transfer', status: 'pending', attempts: 0 },
          { channel: 'email', userId: s.adminA, to: 'kwame@lake.com', subject: 'Approval needed', body: 'x', status: 'skipped', attempts: 0, error: 'Quiet hours' },
        ],
        createdAt: Date.now(),
      }),
    )
    const plan = await s.t.mutation(internal.notificationDispatch.start, { dispatchId })
    expect(plan?.pending).toHaveLength(1)
    const admin = s.as(s.adminA)
    let rows = (await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'queued' })).page
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toBe('Approval needed: transfer')

    // Retryable failure: back to queued with the next attempt time.
    await s.t.mutation(internal.notificationDispatch.finish, { dispatchId, outcomes: [{ index: 0, ok: false, error: 'HTTP 503', retryable: true }] })
    rows = (await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'queued' })).page
    expect(rows[0].nextAttemptAt).toBeGreaterThan(Date.now())

    // Last attempt fails for good.
    await s.t.mutation(internal.notificationDispatch.start, { dispatchId })
    await s.t.mutation(internal.notificationDispatch.finish, { dispatchId, outcomes: [{ index: 0, ok: false, error: 'HTTP 503', retryable: true }] })
    rows = (await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'failed' })).page
    expect(rows).toHaveLength(1)
    expect(rows[0].canRetry).toBe(true)
    expect((await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' })).page).toHaveLength(1)

    await admin.mutation(api.messaging.outbox.retry, { messageId: rows[0].id })
    const d = await s.t.run(async (ctx) => ctx.db.get(dispatchId))
    expect(d?.status).toBe('retrying')
    expect(d?.deliveries[0].status).toBe('pending')
    expect((await admin.query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'queued' })).page).toHaveLength(1)
    // Retrying twice is refused (the row is queued now).
    expect(await messageOf(admin.mutation(api.messaging.outbox.retry, { messageId: rows[0].id }))).toContain('Only a failed message')

    // The resend succeeds and counts once in usage.
    await s.t.mutation(internal.notificationDispatch.start, { dispatchId })
    await s.t.mutation(internal.notificationDispatch.finish, { dispatchId, outcomes: [{ index: 0, ok: true, providerMessageId: 'p1' }] })
    const u = await admin.query(api.messaging.outbox.usage, { period: periodOf(Date.now()) })
    expect(u.sms.used).toBe(1)
  })

  test('sign-in code rows never keep the message text', async () => {
    const s = await setup()
    await s.t.mutation(internal.messaging.outbox.record, {
      companyId: s.companyA,
      channel: 'sms',
      ok: true,
      source: 'code',
      to: '+233244123456',
      recipientUserId: s.staffA,
      body: 'Your Anowa sign-in code is 123456',
    })
    const all = await s.t.run(async (ctx) => ctx.db.query('outboundMessages').collect())
    expect(JSON.stringify(all)).not.toContain('123456')
    const row = (await s.as(s.adminA).query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' })).page[0]
    expect(row.source).toBe('code')
    expect(row.body).toBeNull()
    expect(row.canRetry).toBe(false)
  })

  test('a bot record for a binding of another organization is ignored', async () => {
    const s = await setup()
    const bindingB = await s.t.run(async (ctx) =>
      ctx.db.insert('channelBindings', { provider: 'telegram', address: '555', userId: s.adminB, companyId: s.companyB, verifiedAt: Date.now() }),
    )
    await s.t.mutation(internal.messaging.outbox.record, {
      companyId: s.companyA, channel: 'telegram', ok: true, source: 'bot_reminder', to: '555', bindingId: bindingB, body: 'x',
    })
    expect(await s.t.run(async (ctx) => ctx.db.query('outboundMessages').collect())).toHaveLength(0)
  })

  test("another organization's user is never named in the log", async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await logOutbound(ctx, { companyId: s.companyA, channel: 'sms', status: 'sent', source: 'automation', to: '+233244123456', recipientUserId: s.adminB, body: 'x' })
    })
    const row = (await s.as(s.adminA).query(api.messaging.outbox.list, { paginationOpts: PAGE, filter: 'all' })).page[0]
    expect(row.recipientName).toBeNull()
    expect(row.roleKey).toBeNull()
    expect(JSON.stringify(row)).not.toContain('Esi')
  })

  test('prune deletes rows older than 90 days', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const id = await logOutbound(ctx, { companyId: s.companyA, channel: 'sms', status: 'sent', source: 'automation', to: '+233244123456' })
      await ctx.db.patch(id, { createdAt: Date.now() - 91 * 86_400_000 })
      await logOutbound(ctx, { companyId: s.companyA, channel: 'sms', status: 'sent', source: 'automation', to: '+233244123457' })
    })
    expect(await s.t.mutation(internal.messaging.outbox.prune, {})).toBe(1)
  })
})
