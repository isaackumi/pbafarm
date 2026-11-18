/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const DAY = '2026-11-18'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${DAY}T10:00:00Z`))
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
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: now })
    const companyId = await company('Lake Farm', 'LAKE')
    const otherId = await company('Other Farm', 'OTHR')
    const siteId = await ctx.db.insert('farmLocations', { companyId, name: 'Main', active: true, updatedAt: now } as any)
    const adminId = await ctx.db.insert('users', {
      email: 'a@x.com', phone: '+233200000001', role: 'admin', companyId, activeLocationId: siteId,
    })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId, activeLocationId: siteId })
    const otherAdminId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherId })
    const cage = (name: string, cid: any, extra: Record<string, unknown> = {}) =>
      ctx.db.insert('cages', {
        name, status: 'active', companyId: cid, locationId: cid === companyId ? siteId : undefined,
        currentCount: 1000, initialCount: 1000, updatedAt: now, ...extra,
      } as any)
    const b1 = await cage('B1', companyId)
    const b2 = await cage('B2', companyId)
    await cage('X1', otherId)
    await ctx.db.insert('dailyRecords', {
      cageId: b1, date: DAY, feedAmount: 10, feedPrice: 1, feedCost: 10, mortality: 0, companyId,
    } as any)
    const feedId = await ctx.db.insert('feedTypes', {
      name: 'Grower 4mm', currentStock: 120, minimumStock: 500, pricePerKg: 10, active: true, companyId, updatedAt: now,
    } as any)
    return { companyId, otherId, siteId, adminId, staffId, otherAdminId, b1, b2, feedId }
  })
  const as = (id: any) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

const notesFor = (t: any, userId: any) =>
  t.run((ctx: any) => ctx.db.query('notifications').withIndex('by_user', (q: any) => q.eq('userId', userId)).collect())

const runsOf = (t: any, companyId: any) =>
  t.run((ctx: any) =>
    ctx.db.query('automationRuns').withIndex('by_company_and_createdAt', (q: any) => q.eq('companyId', companyId)).collect(),
  )

const drain = (t: any) => t.finishAllScheduledFunctions(vi.runAllTimers)

describe('built-in reminders on the engine (M17)', () => {
  test('migration is a dry run by default, then seeds three enabled rules once', async () => {
    const { t, companyId } = await setup()
    const dry = await t.mutation(internal.automation.migrations.seedBuiltInRules, {})
    expect(dry.dryRun).toBe(true)
    expect(dry.companies.map((c: any) => c.created)).toEqual([[], []])
    expect(await t.run((ctx) => ctx.db.query('automationRules').collect())).toHaveLength(0)

    await t.mutation(internal.automation.migrations.seedBuiltInRules, { dryRun: false })
    const again = await t.mutation(internal.automation.migrations.seedBuiltInRules, { dryRun: false })
    expect(again.companies.every((c: any) => c.alreadyOnEngine)).toBe(true)
    const rules = await t.run((ctx) =>
      ctx.db.query('automationRules').withIndex('by_company', (q) => q.eq('companyId', companyId)).collect(),
    )
    expect(rules.map((r) => r.templateKey).sort()).toEqual(['low_feed_stock', 'low_item_stock', 'missed_daily_entry'])
    expect(rules.every((r) => r.enabled && r.builtIn)).toBe(true)
    // Next run at 16:00 company time (UTC by default), as the legacy cron.
    expect(new Date(rules[0].nextRunAt!).toISOString()).toBe(`${DAY}T16:00:00.000Z`)
  })

  test('the engine sends what the legacy digest sent, and the legacy cron steps aside', async () => {
    const { t, companyId, adminId, staffId, otherAdminId, b2 } = await setup()
    await t.mutation(internal.automation.migrations.seedBuiltInRules, { dryRun: false })

    // Legacy cron now skips this company...
    const legacy = await t.mutation(internal.reminders.companyDigest, { companyId, date: DAY })
    expect(legacy).toMatchObject({ sent: 0, onEngine: true })

    // ...and the 16:00 tick sends the same notifications.
    vi.setSystemTime(new Date(`${DAY}T16:02:00Z`))
    await t.mutation(internal.automation.engine.tick, {})
    await drain(t)

    const staff = await notesFor(t, staffId)
    expect(staff).toHaveLength(1)
    expect(staff[0]).toMatchObject({
      title: 'Daily entry missing for 1 cage',
      link: `/daily-entry?cages=${b2}`,
      type: 'warning',
      dedupeKey: `missed-entry:${DAY}:${staffId}`,
    })
    expect(staff[0].message).toBe(`No feed or mortality logged on ${DAY} for B2 (1 of 2 done).`)
    const admin = await notesFor(t, adminId)
    expect(admin.map((n: any) => n.title).sort()).toEqual(['Daily entry missing for 1 cage', 'Low feed stock: 1 feed type'])
    expect(admin.find((n: any) => n.title.startsWith('Low')).message).toBe('Grower 4mm 120 kg left (minimum 500 kg)')
    // The other company gets its own reminder, never ours.
    const other = await notesFor(t, otherAdminId)
    expect(other.map((n: any) => n.message).join(' ')).toContain('X1')
    expect(other.map((n: any) => n.message).join(' ')).not.toContain('B2')

    const runs = await runsOf(t, companyId)
    expect(runs.map((r: any) => r.status).sort()).toEqual(['skipped', 'succeeded', 'succeeded'])
    expect(runs.find((r: any) => r.status === 'skipped').ruleName).toBe('Low item stock')
    expect(runs.find((r: any) => r.status === 'skipped').note).toBe('Nothing to report')

    // Rules advanced to tomorrow; a second tick does nothing.
    await t.mutation(internal.automation.engine.tick, {})
    await drain(t)
    expect(await runsOf(t, companyId)).toHaveLength(3)
  })

  test('no duplicate when the legacy digest already ran that day', async () => {
    const { t, staffId } = await setup()
    await t.mutation(internal.reminders.dailyDigest, { date: DAY })
    await drain(t)
    expect(await notesFor(t, staffId)).toHaveLength(1)
    await t.mutation(internal.automation.migrations.seedBuiltInRules, { dryRun: false })
    vi.setSystemTime(new Date(`${DAY}T16:02:00Z`))
    await t.mutation(internal.automation.engine.tick, {})
    await drain(t)
    expect(await notesFor(t, staffId)).toHaveLength(1)
  })

  test('companies without built-in rules keep the legacy digest', async () => {
    const { t, staffId } = await setup()
    await t.mutation(internal.reminders.dailyDigest, { date: DAY })
    await drain(t)
    expect((await notesFor(t, staffId))[0].title).toBe('Daily entry missing for 1 cage')
  })

  test('schedules follow the company time zone', async () => {
    const { t, as, adminId, companyId } = await setup()
    await as(adminId).mutation(api.automation.rules.enableBuiltIns, {})
    // The organization profile owns the zone (ORG-005); changing it re-times rules.
    await as(adminId).mutation(api.companies.updateProfile, { timezone: 'Africa/Nairobi' })
    const rule = await t.run((ctx) =>
      ctx.db.query('automationRules').withIndex('by_company', (q) => q.eq('companyId', companyId)).first(),
    )
    expect(new Date(rule!.nextRunAt!).toISOString()).toBe(`${DAY}T13:00:00.000Z`)
    expect((await as(adminId).query(api.automation.rules.overview, {})).timezone).toBe('Africa/Nairobi')
  })

  test('missed entry uses each site\'s local date, like the legacy digest', async () => {
    const { t, as, adminId, staffId, companyId } = await setup()
    // A second site 8 hours ahead: at 16:02 UTC its date is already the 19th,
    // so its cage counts as missing even though it logged on the 18th.
    await t.run(async (ctx) => {
      const far = await ctx.db.insert('farmLocations', {
        companyId, name: 'Far', active: true, timezone: 'Asia/Singapore', updatedAt: Date.now(),
      } as any)
      const f1 = await ctx.db.insert('cages', {
        name: 'F1', status: 'active', companyId, locationId: far, updatedAt: Date.now(),
      } as any)
      await ctx.db.insert('dailyRecords', {
        cageId: f1, date: DAY, feedAmount: 1, feedPrice: 1, feedCost: 1, mortality: 0, companyId,
      } as any)
    })
    await as(adminId).mutation(api.automation.rules.enableBuiltIns, {})
    vi.setSystemTime(new Date(`${DAY}T16:02:00Z`))
    await t.mutation(internal.automation.engine.tick, {})
    await drain(t)
    const staff = await notesFor(t, staffId)
    expect(staff[0].title).toBe('Daily entry missing for 2 cages')
    expect(staff[0].message).toBe(`No feed or mortality logged on ${DAY} for B2, F1 (1 of 3 done).`)
  })
})

const dailyLine = (cageId: any, feedTypeId: any, extra: Record<string, unknown> = {}) => ({
  cageId, date: DAY, feedAmount: 5, feedTypeId, feedPrice: 10, feedCost: 50, mortality: 0, ...extra,
})

describe('event rules', () => {
  test('high mortality: the rule replaces the inline alert and fires once per event', async () => {
    const { t, as, adminId, staffId, companyId, b2, feedId } = await setup()
    await as(adminId).mutation(api.automation.rules.createFromTemplate, { templateKey: 'high_mortality' })
    await as(staffId).mutation(api.dailyRecords.create, dailyLine(b2, feedId, { mortality: 20 }))
    await drain(t)

    const admin = await notesFor(t, adminId)
    expect(admin).toHaveLength(1)
    expect(admin[0].title).toBe('Mortality alert: B2')
    expect(admin[0].message).toContain('daily 2% (alert at 0.5%)')
    const events = await t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'daily.recorded', companyId, processedBy: ['automation'] })
    const runs = await runsOf(t, companyId)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'succeeded', triggerKind: 'event', notified: 1, attempts: 1 })

    // Re-dispatching the same event does nothing.
    await t.mutation(internal.automation.engine.dispatchEvent, { eventId: events[0]._id })
    await drain(t)
    expect(await runsOf(t, companyId)).toHaveLength(1)
  })

  test('without the rule the inline mortality alert is unchanged', async () => {
    const { t, as, adminId, staffId, b2, feedId } = await setup()
    await as(staffId).mutation(api.dailyRecords.create, dailyLine(b2, feedId, { mortality: 20 }))
    await drain(t)
    const admin = await notesFor(t, adminId)
    expect(admin).toHaveLength(1)
    expect(admin[0].title).toBe('Mortality alert')
    // The event is still written (outbox), nothing is scheduled for it.
    const events = await t.run((ctx) => ctx.db.query('domainEvents').collect())
    expect(events[0].processedBy).toBeUndefined()
  })

  test('conditions that do not hold create no run', async () => {
    const { t, as, adminId, staffId, companyId, b2, feedId } = await setup()
    await as(adminId).mutation(api.automation.rules.createFromTemplate, { templateKey: 'low_dissolved_oxygen' })
    await as(staffId).mutation(api.dailyRecords.create, dailyLine(b2, feedId, { dissolvedOxygen: 6.5 }))
    await drain(t)
    expect(await runsOf(t, companyId)).toHaveLength(0)
  })

  test('SMS: transient failure is retried with back-off, then succeeds', async () => {
    const { t, as, adminId, staffId, companyId, b2, feedId } = await setup()
    vi.stubEnv('PLATFORM_SMS_PROVIDER', 'twilio')
    vi.stubEnv('PLATFORM_TWILIO_ACCOUNT_SID', 'AC1')
    vi.stubEnv('PLATFORM_TWILIO_AUTH_TOKEN', 'tok')
    vi.stubEnv('PLATFORM_SMS_SENDER', '+15550001111')
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return calls === 1
        ? new Response('{"message":"Too many requests"}', { status: 429 })
        : new Response('{"sid":"SM1","status":"queued"}', { status: 201 })
    })
    const ruleId = await as(adminId).mutation(api.automation.rules.createFromTemplate, { templateKey: 'low_dissolved_oxygen' })
    const rule = await t.run((ctx) => ctx.db.get(ruleId))
    await as(adminId).mutation(api.automation.rules.save, {
      ruleId,
      name: rule!.name,
      enabled: true,
      trigger: rule!.trigger,
      conditions: rule!.conditions,
      actions: [{ ...(rule!.actions[0] as any), channels: ['in_app', 'sms'] }],
    })
    await as(staffId).mutation(api.dailyRecords.create, dailyLine(b2, feedId, { dissolvedOxygen: 2.5 }))
    await drain(t)

    const [run] = await runsOf(t, companyId)
    expect(calls).toBe(2)
    expect(run.status).toBe('succeeded')
    expect(run.attempts).toBe(2)
    expect(run.deliveries).toHaveLength(1)
    expect(run.deliveries[0]).toMatchObject({ channel: 'sms', to: '+233200000001', status: 'sent', attempts: 2, providerMessageId: 'SM1' })
    expect(run.deliveries[0].body).toBe('Low DO: B2: Dissolved oxygen 2.5 mg/L on 2026-11-18.')
    // In-app was written once, not per attempt.
    expect(await notesFor(t, adminId)).toHaveLength(1)
  })

  test('SMS: permanent failure is not retried; admin re-run resends it', async () => {
    const { t, as, adminId, staffId, companyId, b2, feedId } = await setup()
    vi.stubEnv('PLATFORM_SMS_PROVIDER', 'twilio')
    vi.stubEnv('PLATFORM_TWILIO_ACCOUNT_SID', 'AC1')
    vi.stubEnv('PLATFORM_TWILIO_AUTH_TOKEN', 'tok')
    vi.stubEnv('PLATFORM_SMS_SENDER', '+15550001111')
    let ok = false
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return ok
        ? new Response('{"sid":"SM2"}', { status: 201 })
        : new Response('{"message":"Invalid To number"}', { status: 400 })
    })
    await as(adminId).mutation(api.automation.rules.save, {
      name: 'DO by SMS',
      enabled: true,
      trigger: { kind: 'event', eventType: 'daily.recorded' },
      conditions: [{ field: 'payload.dissolvedOxygen', op: 'lt', value: 4 }],
      actions: [{ kind: 'notify', channels: ['sms'], recipients: { roles: ['admin'] }, title: 'Low DO', message: '{{payload.cageName}}' }],
    })
    await as(staffId).mutation(api.dailyRecords.create, dailyLine(b2, feedId, { dissolvedOxygen: 2.5 }))
    await drain(t)
    let [run] = await runsOf(t, companyId)
    expect(calls).toBe(1)
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/sms to \+233200000001: .*Invalid To number/)

    await expect(as(staffId).mutation(api.automation.rules.rerun, { runId: run._id })).rejects.toThrow(/Insufficient permissions/)
    ok = true
    await as(adminId).mutation(api.automation.rules.rerun, { runId: run._id })
    await drain(t)
    ;[run] = await runsOf(t, companyId)
    expect(run.status).toBe('succeeded')
    expect(run.deliveries[0]).toMatchObject({ status: 'sent', providerMessageId: 'SM2' })
  })

  test('preferences: channel off and quiet hours skip external sends', async () => {
    const { t, as, adminId, staffId, companyId, b2, feedId } = await setup()
    await t.run((ctx) => ctx.db.patch(staffId, { phone: '+233200000002' }))
    await as(staffId).mutation(api.notificationPreferences.update, {
      inApp: true, sms: true, whatsapp: true, email: true, quietHours: { start: '09:00', end: '11:00' },
    })
    await as(adminId).mutation(api.notificationPreferences.update, {
      inApp: false, sms: false, whatsapp: true, email: true,
    })
    expect(await as(adminId).query(api.notificationPreferences.mine, {})).toMatchObject({ inApp: false, sms: false, hasPhone: true })
    await as(adminId).mutation(api.automation.rules.save, {
      name: 'DO to all',
      enabled: true,
      trigger: { kind: 'event', eventType: 'daily.recorded' },
      conditions: [{ field: 'payload.dissolvedOxygen', op: 'lt', value: 4 }],
      actions: [{ kind: 'notify', channels: ['in_app', 'sms'], recipients: { everyone: true }, title: 'Low DO', message: 'x' }],
    })
    await as(staffId).mutation(api.dailyRecords.create, dailyLine(b2, feedId, { dissolvedOxygen: 2.5 }))
    await drain(t)
    const [run] = await runsOf(t, companyId)
    // Admin: no in-app, no SMS. Staff: in-app, SMS skipped for quiet hours (10:00 UTC).
    expect(await notesFor(t, adminId)).toHaveLength(0)
    expect(await notesFor(t, staffId)).toHaveLength(1)
    expect(run.deliveries).toEqual([
      expect.objectContaining({ userId: staffId, status: 'skipped', error: 'Quiet hours' }),
    ])
    expect(run.status).toBe('succeeded')
  })

  test('create_task action assigns tasks that show in My tasks', async () => {
    const { t, as, adminId, staffId, b2, feedId } = await setup()
    await as(adminId).mutation(api.automation.rules.save, {
      name: 'Check net after mortality',
      enabled: true,
      trigger: { kind: 'event', eventType: 'daily.recorded' },
      conditions: [{ field: 'payload.mortality', op: 'gt', value: 10 }],
      actions: [
        { kind: 'create_task', recipients: { userIds: [staffId] }, title: 'Inspect net on {{payload.cageName}}', dueInHours: 24 },
      ],
    })
    await as(staffId).mutation(api.dailyRecords.create, dailyLine(b2, feedId, { mortality: 15 }))
    await drain(t)
    const mine = await as(staffId).query(api.tasks.mine, {})
    expect(mine.open).toHaveLength(1)
    expect(mine.open[0]).toMatchObject({ title: 'Inspect net on B2', dueDate: '2026-11-19', cageId: b2, cageName: 'B2', status: 'open' })
    expect(await as(staffId).query(api.tasks.openCount, {})).toBe(1)
    await expect(as(adminId).query(api.tasks.mine, {})).resolves.toMatchObject({ open: [] })
    await as(staffId).mutation(api.tasks.setStatus, { taskId: mine.open[0]._id, status: 'done' })
    expect((await as(staffId).query(api.tasks.mine, { includeClosed: true })).closed).toHaveLength(1)
  })
})

describe('rule administration', () => {
  test('admins only, own company only, and recipients must be members', async () => {
    const { t, as, adminId, staffId, otherAdminId } = await setup()
    await expect(as(staffId).query(api.automation.rules.overview, {})).rejects.toThrow(/Insufficient permissions/)
    const ruleId = await as(adminId).mutation(api.automation.rules.createFromTemplate, { templateKey: 'withdrawal_ending' })
    await expect(as(otherAdminId).mutation(api.automation.rules.setEnabled, { ruleId, enabled: false })).rejects.toThrow(
      /Rule not found/,
    )
    await expect(as(otherAdminId).mutation(api.automation.rules.remove, { ruleId })).rejects.toThrow(/Rule not found/)
    await expect(
      as(adminId).mutation(api.automation.rules.save, {
        name: 'Leak',
        enabled: true,
        trigger: { kind: 'event', eventType: 'daily.recorded' },
        conditions: [],
        actions: [{ kind: 'notify', channels: ['in_app'], recipients: { userIds: [otherAdminId] }, title: 'x', message: 'y' }],
      }),
    ).rejects.toThrow(/members of your company/)
    await expect(
      as(adminId).mutation(api.automation.rules.save, {
        name: 'Bad',
        enabled: true,
        trigger: { kind: 'schedule', localTime: '25:00', check: 'missed_daily_entry' },
        conditions: [],
        actions: [{ kind: 'notify', channels: ['in_app'], recipients: { everyone: true }, title: 'x', message: 'y' }],
      }),
    ).rejects.toThrow(/HH:MM/)
    const overview = await as(adminId).query(api.automation.rules.overview, {})
    expect(overview.rules).toHaveLength(1)
    expect(overview.templates.find((x: any) => x.key === 'withdrawal_ending')?.inUse).toBe(true)
    expect((await as(otherAdminId).query(api.automation.rules.overview, {})).rules).toHaveLength(0)
    // Disabling removes it from the schedule.
    await as(adminId).mutation(api.automation.rules.setEnabled, { ruleId, enabled: false })
    expect((await t.run((ctx) => ctx.db.get(ruleId)))!.nextRunAt).toBeUndefined()
  })

  test('run now: schedule check with params (withdrawal ending)', async () => {
    const { t, as, adminId, companyId, b2 } = await setup()
    await t.run((ctx) =>
      ctx.db.insert('healthTreatments', {
        cageId: b2, date: '2026-11-01', treatment: 'Oxytetracycline', withdrawalUntil: '2026-11-20', companyId, updatedAt: Date.now(),
      } as any),
    )
    const ruleId = await as(adminId).mutation(api.automation.rules.createFromTemplate, { templateKey: 'withdrawal_ending' })
    await as(adminId).mutation(api.automation.rules.runNow, { ruleId })
    await drain(t)
    const admin = await notesFor(t, adminId)
    expect(admin).toHaveLength(1)
    expect(admin[0].title).toBe('Withdrawal ending for 1 treatment')
    expect(admin[0].message).toBe('Within 3 days: B2: Oxytetracycline until 2026-11-20.')
    const runs = await as(adminId).query(api.automation.rules.runs, { ruleId })
    expect(runs[0]).toMatchObject({ triggerKind: 'manual', status: 'succeeded' })
  })

  test('runForMyCompanyNow uses the engine once the company moved', async () => {
    const { t, as, adminId, staffId } = await setup()
    await as(adminId).mutation(api.automation.rules.enableBuiltIns, {})
    const res = await as(adminId).mutation(api.reminders.runForMyCompanyNow, {})
    expect(res).toMatchObject({ onEngine: true, runs: 3 })
    await drain(t)
    expect((await notesFor(t, staffId))[0].title).toBe('Daily entry missing for 1 cage')
  })
})

describe('domain events from the production engine', () => {
  test('one event per operation type, dispatched to listening rules', async () => {
    const { t, as, adminId, companyId } = await setup()
    await as(adminId).mutation(api.automation.rules.save, {
      name: 'Harvest note',
      enabled: true,
      trigger: { kind: 'event', eventType: 'stock.harvest' },
      conditions: [],
      actions: [{ kind: 'notify', channels: ['in_app'], recipients: { roles: ['admin'] }, title: 'Harvest', message: '{{payload.unitNames}}' }],
    })
    const { emitDomainEvent } = await import('./lib/events')
    await t.run(async (ctx) => {
      await emitDomainEvent(ctx as any, 'stock.harvest', { unitNames: 'B2', qtyDelta: -100 }, { companyId })
      await emitDomainEvent(ctx as any, 'stock.mortality', { unitNames: 'B2' }, { companyId })
    })
    await drain(t)
    const admin = await notesFor(t, adminId)
    expect(admin.map((n: any) => n.message)).toEqual(['B2'])
  })

  test('production engine operations write one stock.* event per type', async () => {
    const { t, companyId, adminId, b2, siteId } = await setup()
    const engine = await import('./lib/productionEngine')
    await t.run(async (ctx) => {
      await ctx.db.patch(b2, { status: 'empty', currentCount: 0 })
      const opts = { companyId, userId: adminId }
      const batchId = await engine.openBatch(ctx, opts, { batchNumber: 'TL-1', origin: 'stocking', openedOn: '2026-11-01' })
      await engine.stockIn(ctx, opts, { sourceTable: 'stockingHistory', sourceId: 'S1' }, {
        unitId: b2, batchId, qty: 1000, abwG: 20, date: '2026-11-01',
      })
    })
    const events = await t.run((ctx) =>
      ctx.db.query('domainEvents').withIndex('by_company_and_createdAt', (q) => q.eq('companyId', companyId)).collect(),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'stock.stock_in',
      locationId: siteId,
      payload: expect.objectContaining({ eventCount: 1, qtyDelta: 1000, unitNames: 'B2', cageId: b2, eventDate: '2026-11-01' }),
    })
  })
})
