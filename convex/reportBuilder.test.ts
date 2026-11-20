/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { defaultDefinition, type ReportDefinition } from './lib/reportCatalog'

const modules = import.meta.glob('./**/*.ts')
const TODAY = '2026-03-10'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const salesByCustomer: ReportDefinition = {
  ...defaultDefinition('sales'),
  dimensions: ['site', 'customer'],
  measures: ['revenue', 'sales'],
  range: { preset: 'month_to_date' },
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'Site B', active: true, updatedAt: now })
    const otherSite = await ctx.db.insert('farmLocations', { companyId: other, name: 'River', active: true, updatedAt: now })
    const member = async (email: string, roleKey: string, cid = companyId, sites?: any[]) => {
      const userId = await ctx.db.insert('users', {
        email, name: email.split('@')[0], role: roleKey === 'admin' ? 'admin' : 'user', companyId: cid,
      } as any)
      await ctx.db.insert('memberships', {
        userId, companyId: cid, roleKey, allLocations: !sites, locationIds: sites, status: 'active', updatedAt: now,
      } as any)
      return userId
    }
    const admin = await member('admin@a.com', 'admin')
    const manager = await member('manager@a.com', 'manager')
    const siteManager = await member('sitea@a.com', 'manager', companyId, [siteA])
    const viewer = await member('viewer@a.com', 'viewer')
    const field = await member('field@a.com', 'field_staff')
    const otherAdmin = await member('admin@r.com', 'admin', other)
    const sale = (cid: any, locationId: any, customerName: string, totalAmount: number, saleDate = '2026-03-05') =>
      ctx.db.insert('sales', {
        companyId: cid, locationId, customerName, saleDate, weightKg: 10, pricePerKg: totalAmount / 10, totalAmount,
        paymentStatus: 'paid', updatedAt: now,
      } as any)
    await sale(companyId, siteA, 'Ama', 100)
    await sale(companyId, siteA, 'Ama', 50)
    await sale(companyId, siteB, 'Kofi', 70)
    await sale(companyId, siteB, 'Old', 999, '2026-02-01') // outside month to date
    await sale(other, otherSite, 'Rival', 5000)
    return { companyId, other, siteA, siteB, otherSite, admin, manager, siteManager, viewer, field, otherAdmin }
  })
  const as = (id: any) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

describe('report builder (ANLY-001)', () => {
  test('preview is company-scoped, grouped and labelled', async () => {
    const { as, admin, otherAdmin } = await setup()
    const res = await as(admin).query(api.reportBuilder.preview, { definition: salesByCustomer })
    expect(res.from).toBe('2026-03-01')
    expect(res.rows).toEqual([
      { site: 'Site A', customer: 'Ama', revenue: 150, sales: 2 },
      { site: 'Site B', customer: 'Kofi', revenue: 70, sales: 1 },
    ])
    const other = await as(otherAdmin).query(api.reportBuilder.preview, { definition: salesByCustomer })
    expect(other.rows).toEqual([{ site: 'River', customer: 'Rival', revenue: 5000, sales: 1 }])
  })

  test('site-scoped members only see their sites; dataset permission is enforced', async () => {
    const { as, siteManager, field } = await setup()
    const res = await as(siteManager).query(api.reportBuilder.preview, { definition: salesByCustomer })
    expect(res.rows.map((r) => r.customer)).toEqual(['Ama'])
    await expect(as(field).query(api.reportBuilder.preview, { definition: salesByCustomer })).rejects.toThrow(
      /Insufficient permissions: finance.view/,
    )
  })

  test('filters on another company\u2019s site are rejected on save; viewers cannot save', async () => {
    const { as, admin, viewer, otherSite } = await setup()
    const save = (who: any, filters: ReportDefinition['filters']) =>
      as(who).mutation(api.reportBuilder.save, {
        name: 'Sales', visibility: 'company', definition: { ...salesByCustomer, filters },
      })
    await expect(save(admin, [{ dimension: 'site', values: [otherSite] }])).rejects.toThrow(/not in this organization/)
    await expect(save(viewer, [])).rejects.toThrow(/Insufficient permissions: reports.manage/)
  })

  test('private reports stay private; shared ones are listed; other companies get NOT_FOUND', async () => {
    const { as, admin, manager, viewer, otherAdmin } = await setup()
    const priv = await as(manager).mutation(api.reportBuilder.save, {
      name: 'Mine', visibility: 'private', definition: salesByCustomer,
    })
    const shared = await as(manager).mutation(api.reportBuilder.save, {
      name: 'Team', visibility: 'company', definition: salesByCustomer,
    })
    expect((await as(viewer).query(api.reportBuilder.list, {})).map((r) => r.name)).toEqual(['Team'])
    expect((await as(manager).query(api.reportBuilder.list, {})).map((r) => r.name).sort()).toEqual(['Mine', 'Team'])
    await expect(as(viewer).query(api.reportBuilder.runSaved, { reportId: priv })).rejects.toThrow(/Report not found/)
    await expect(as(otherAdmin).query(api.reportBuilder.runSaved, { reportId: shared })).rejects.toThrow(/Report not found/)
    expect((await as(viewer).query(api.reportBuilder.runSaved, { reportId: shared })).rows).toHaveLength(2)
    // Only the author or an org admin edits; an admin can, another manager cannot.
    const [team] = (await as(admin).query(api.reportBuilder.list, {})).filter((r) => r.name === 'Team')
    expect(team.canEdit).toBe(true)
    await expect(as(otherAdmin).mutation(api.reportBuilder.remove, { reportId: shared })).rejects.toThrow(/Report not found/)
    await as(admin).mutation(api.reportBuilder.remove, { reportId: shared })
    expect((await as(viewer).query(api.reportBuilder.list, {})).map((r) => r.name)).toEqual([])
  })
})

describe('scheduled report emails (ANLY-007)', () => {
  const drain = (t: any) => t.finishAllScheduledFunctions(vi.runAllTimers)

  function stubEmail(responses: Array<() => Response>) {
    vi.stubEnv('PLATFORM_EMAIL_PROVIDER', 'resend')
    vi.stubEnv('PLATFORM_EMAIL_SENDER', 'Farm <no-reply@farm.test>')
    vi.stubEnv('PLATFORM_RESEND_API_KEY', 're_test')
    const bodies: any[] = []
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body))
      const next = responses.length > 1 ? responses.shift()! : responses[0]
      return next()
    })
    return bodies
  }

  async function withSchedule(s: Awaited<ReturnType<typeof setup>>, recipientIds: any[]) {
    const reportId = await s.as(s.admin).mutation(api.reportBuilder.save, {
      name: 'Daily sales', visibility: 'company', definition: salesByCustomer,
    })
    const scheduleId = await s.as(s.admin).mutation(api.reportSchedules.create, {
      reportId, frequency: 'daily', localTime: '07:00', timezone: 'Africa/Accra', recipientIds, enabled: true,
    })
    return { reportId, scheduleId }
  }

  const deliveriesOf = (t: any) => t.run((ctx: any) => ctx.db.query('reportDeliveries').collect())

  test('recipients must be eligible members of the company', async () => {
    const s = await setup()
    const reportId = await s.as(s.admin).mutation(api.reportBuilder.save, {
      name: 'Sales', visibility: 'company', definition: salesByCustomer,
    })
    const create = (recipientIds: any[], who = s.admin) =>
      s.as(who).mutation(api.reportSchedules.create, {
        reportId, frequency: 'daily', localTime: '07:00', timezone: 'Africa/Accra', recipientIds, enabled: true,
      })
    await expect(create([s.otherAdmin])).rejects.toThrow(/not an active member/)
    await expect(create([s.field])).rejects.toThrow(/cannot read this data/)
    await expect(create([s.siteManager])).rejects.toThrow(/access to all sites/)
    await expect(create([s.viewer], s.viewer)).rejects.toThrow(/Insufficient permissions: reports.manage/)
    await expect(
      s.as(s.otherAdmin).mutation(api.reportSchedules.create, {
        reportId, frequency: 'daily', localTime: '07:00', timezone: 'UTC', recipientIds: [s.otherAdmin], enabled: true,
      }),
    ).rejects.toThrow(/Report not found/)
    await expect(
      s.as(s.admin).mutation(api.reportSchedules.create, {
        reportId, frequency: 'daily', localTime: '07:00', timezone: 'Mars/Olympus', recipientIds: [s.viewer], enabled: true,
      }),
    ).rejects.toThrow(/valid time zone/)
    const id = await create([s.viewer, s.manager])
    const [row] = await s.as(s.viewer).query(api.reportSchedules.list, {})
    expect(row).toMatchObject({ _id: id, reportName: 'Sales', recipients: [{ name: 'viewer' }, { name: 'manager' }] })
    expect(new Date(row.nextRunAt!).toISOString()).toBe('2026-03-11T07:00:00.000Z')
    expect(await s.as(s.otherAdmin).query(api.reportSchedules.list, {})).toEqual([])
  })

  test('tick queues one delivery per slot and emails the CSV; preferences are respected', async () => {
    const s = await setup()
    const bodies = stubEmail([() => new Response('{"id":"em_1"}', { status: 200 })])
    await s.as(s.manager).mutation(api.notificationPreferences.update, {
      inApp: true, sms: true, whatsapp: true, email: false,
    })
    const { scheduleId } = await withSchedule(s, [s.viewer, s.manager])
    vi.setSystemTime(new Date('2026-03-11T07:05:00Z'))
    expect(await s.t.mutation(internal.reportSchedules.tick, {})).toEqual({ queued: 1, more: false })
    // Second tick in the same slot: nothing new (the schedule moved on to tomorrow).
    expect(await s.t.mutation(internal.reportSchedules.tick, {})).toEqual({ queued: 0, more: false })
    await drain(s.t)

    const [d] = await deliveriesOf(s.t)
    expect(d).toMatchObject({ status: 'succeeded', slot: '2026-03-11', rowCount: 2, attempts: 1 })
    expect(d.recipients.map((r: any) => [r.to, r.status, r.error])).toEqual([
      ['viewer@a.com', 'sent', undefined],
      ['manager@a.com', 'skipped', 'Email turned off in notification preferences'],
    ])
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ to: ['viewer@a.com'], subject: 'Report: Daily sales (1 to 11 Mar)' })
    expect(bodies[0].html).toContain('Daily sales,')
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(atob(bodies[0].attachments[0].content), (c) => c.charCodeAt(0)))
    expect(csv).toBe('\uFEFFSite,Customer,Revenue,Sales\r\nSite A,Ama,150,2\r\nSite B,Kofi,70,1\r\n')
    expect(bodies[0].attachments[0].filename).toBe('daily-sales-2026-03-11.csv')
    const schedule = await s.t.run((ctx) => ctx.db.get(scheduleId))
    expect(schedule).toMatchObject({ lastStatus: 'succeeded' })
    expect(new Date(schedule!.nextRunAt!).toISOString()).toBe('2026-03-12T07:00:00.000Z')
  })

  test('rate-limit and 5xx are retried; 4xx is not', async () => {
    const s = await setup()
    const bodies = stubEmail([
      () => new Response('{"message":"rate limited"}', { status: 429 }),
      () => new Response('{"id":"em_2"}', { status: 200 }),
    ])
    const { scheduleId } = await withSchedule(s, [s.viewer])
    await s.as(s.admin).mutation(api.reportSchedules.sendNow, { scheduleId })
    await drain(s.t)
    let [d] = await deliveriesOf(s.t)
    expect(d).toMatchObject({ trigger: 'manual', status: 'succeeded', attempts: 2 })
    expect(d.recipients[0]).toMatchObject({ status: 'sent', providerMessageId: 'em_2', attempts: 2 })
    expect(bodies.length).toBeGreaterThanOrEqual(2)
    // Send now has a cooldown.
    await expect(s.as(s.admin).mutation(api.reportSchedules.sendNow, { scheduleId })).rejects.toThrow(/just sent/)

    await s.t.run(async (ctx) => {
      for (const x of await ctx.db.query('reportDeliveries').collect()) await ctx.db.delete(x._id)
    })
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return new Response('{"message":"invalid from"}', { status: 422 })
    })
    await s.as(s.admin).mutation(api.reportSchedules.sendNow, { scheduleId })
    await drain(s.t)
    ;[d] = await deliveriesOf(s.t)
    expect(calls).toBe(1)
    expect(d).toMatchObject({ status: 'failed', attempts: 1 })
    expect(d.recipients[0]).toMatchObject({ status: 'failed', retryable: false })
    // The delivery log is for report managers of the company only.
    const log = await s.as(s.admin).query(api.reportSchedules.deliveries, { paginationOpts: { numItems: 10, cursor: null } })
    expect(log.page).toHaveLength(1)
    const otherLog = await s.as(s.otherAdmin).query(api.reportSchedules.deliveries, { paginationOpts: { numItems: 10, cursor: null } })
    expect(otherLog.page).toHaveLength(0)
    await expect(
      s.as(s.viewer).query(api.reportSchedules.deliveries, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow(/reports.manage/)
  })

  test('a recipient who lost access is skipped; another company cannot touch the schedule', async () => {
    const s = await setup()
    stubEmail([() => new Response('{"id":"em_3"}', { status: 200 })])
    const { scheduleId } = await withSchedule(s, [s.viewer])
    await expect(s.as(s.otherAdmin).mutation(api.reportSchedules.sendNow, { scheduleId })).rejects.toThrow(/Schedule not found/)
    await expect(s.as(s.otherAdmin).mutation(api.reportSchedules.remove, { scheduleId })).rejects.toThrow(/Schedule not found/)
    await s.t.run(async (ctx) => {
      const m = await ctx.db
        .query('memberships')
        .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', s.companyId).eq('userId', s.viewer))
        .unique()
      await ctx.db.patch(m!._id, { status: 'suspended' })
    })
    await s.as(s.admin).mutation(api.reportSchedules.sendNow, { scheduleId })
    await drain(s.t)
    const [d] = await deliveriesOf(s.t)
    expect(d).toMatchObject({ status: 'skipped' })
    expect(d.recipients[0]).toMatchObject({ status: 'skipped', error: 'Not an active member' })
  })
})
