/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { DAY_MS } from './billing/model'

const modules = import.meta.glob('./**/*.ts')

/** PLAT-1xx: platform console, tenant suspension, plans and billing lifecycle. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'A1', active: true, updatedAt: now })
    const root = await ctx.db.insert('users', { email: 'root@platform.com', name: 'Root', role: 'super_admin' })
    const rootNoMfa = await ctx.db.insert('users', { email: 'root2@platform.com', role: 'super_admin' })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', name: 'Ama', role: 'admin', companyId: companyA })
    await ctx.db.insert('memberships', { userId: adminA, companyId: companyA, roleKey: 'owner', status: 'active', allLocations: true, updatedAt: now })
    const session = (userId: Id<'users'>) => ctx.db.insert('authSessions', { userId, expirationTime: now + 86_400_000 })
    const sRoot = await session(root)
    await ctx.db.insert('mfaSessions', { userId: root, sessionId: sRoot, purpose: 'verify', attempts: 0, verifiedAt: now, method: 'totp' })
    return { companyA, companyB, siteA, root, adminA, sRoot, sRootNoMfa: await session(rootNoMfa), rootNoMfa, sAdminA: await session(adminA) }
  })
  return {
    t,
    ...ids,
    asRoot: t.withIdentity({ subject: `${ids.root}|${ids.sRoot}` }),
    asRootNoMfa: t.withIdentity({ subject: `${ids.rootNoMfa}|${ids.sRootNoMfa}` }),
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

async function subscribe(s: Awaited<ReturnType<typeof setup>>, companyId: Id<'companies'>, planCode = 'starter') {
  await s.asRoot.mutation(api.platform.billing.seedDefaultPlans, {})
  const plan = (await s.asRoot.query(api.platform.billing.listPlans, {})).find((p) => p.code === planCode)!
  return await s.asRoot.mutation(api.platform.tenants.changePlan, { companyId, planId: plan.id, status: 'active' })
}

describe('platform console (PLAT-101..112)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('every console function refuses tenant users and super_admins without a verified second factor', async () => {
    const s = await setup()
    const planId = await s.asRoot.mutation(api.platform.billing.seedDefaultPlans, {})
    const queries = [
      [api.platform.overview.kpis, {}],
      [api.platform.tenants.list, {}],
      [api.platform.tenants.detail, { companyId: s.companyA }],
      [api.platform.billing.listPlans, {}],
      [api.platform.billing.listSubscriptions, {}],
      [api.platform.billing.listInvoices, {}],
      [api.platform.billing.listPayments, {}],
      [api.platform.billing.dunning, {}],
      [api.platform.usage.byTenant, {}],
      [api.platform.audit.list, {}],
      [api.platform.admins.list, {}],
    ] as const
    const plan = { name: 'X', prices: [{ currency: 'GHS', amountMinor: 1 }], interval: 'month' as const, limits: {}, features: {}, trialDays: 0, isDefault: false, active: true, sortOrder: 1 }
    const mutations = [
      [api.platform.tenants.suspend, { companyId: s.companyA, reason: 'abuse report' }],
      [api.platform.tenants.reactivate, { companyId: s.companyA }],
      [api.platform.tenants.changePlan, { companyId: s.companyA, planId }],
      [api.platform.tenants.extendTrial, { companyId: s.companyA, days: 7 }],
      [api.platform.tenants.grantCredits, { companyId: s.companyA, kind: 'ai', amount: 10, reason: 'goodwill' }],
      [api.platform.tenants.setOverrides, { companyId: s.companyA, limitOverrides: null, featureOverrides: null }],
      [api.platform.tenants.addNote, { companyId: s.companyA, body: 'hi' }],
      [api.platform.tenants.requestExport, { companyId: s.companyA }],
      [api.platform.billing.createPlan, { code: 'x', ...plan }],
      [api.platform.billing.updatePlan, { planId, ...plan }],
      [api.platform.billing.seedDefaultPlans, {}],
      [api.platform.billing.createInvoiceForTenant, { companyId: s.companyA, currency: 'GHS', lines: [{ description: 'x', quantity: 1, unitAmountMinor: 1 }], dueInDays: 7, renewsSubscription: false }],
      [api.platform.billing.recordPayment, { companyId: s.companyA, currency: 'GHS', amountMinor: 100, method: 'bank', idempotencyKey: 'k1' }],
      [api.platform.admins.promote, { email: 'admin@a.com' }],
      [api.platform.admins.demote, { userId: s.root }],
    ] as const
    for (const [fn, args] of queries) {
      expect(await errorOf(s.asAdminA.query(fn as never, args as never))).toMatchObject({ code: 'FORBIDDEN' })
      expect((await errorOf(s.asRootNoMfa.query(fn as never, args as never))).message).toContain('MFA_REQUIRED')
    }
    for (const [fn, args] of mutations) {
      expect(await errorOf(s.asAdminA.mutation(fn as never, args as never))).toMatchObject({ code: 'FORBIDDEN' })
      expect((await errorOf(s.asRootNoMfa.mutation(fn as never, args as never))).message).toContain('MFA_REQUIRED')
    }
    expect(await s.t.run((ctx) => ctx.db.query('billingPayments').collect())).toEqual([])
    expect(await s.t.run((ctx) => ctx.db.query('tenantNotes').collect())).toEqual([])
  })

  test('suspension blocks the tenant, leaves /billing readable, is audited, and reactivation restores access', async () => {
    const s = await setup()
    expect(await s.asAdminA.query(api.farmLocations.list, {})).toHaveLength(1)
    await s.asRoot.mutation(api.platform.tenants.suspend, { companyId: s.companyA, reason: 'Chargeback dispute' })

    expect((await errorOf(s.asAdminA.query(api.farmLocations.list, {}))).message).toContain('TENANT_SUSPENDED')
    // The session was revoked too; a fresh one is still refused.
    const fresh = await s.t.run((ctx) => ctx.db.insert('authSessions', { userId: s.adminA, expirationTime: Date.now() + DAY_MS }))
    const asFresh = s.t.withIdentity({ subject: `${s.adminA}|${fresh}` })
    expect((await errorOf(asFresh.mutation(api.farmLocations.create, { name: 'A2' }))).message).toContain('TENANT_SUSPENDED')
    expect(await asFresh.query(api.users.current, {})).toMatchObject({ companySuspended: true })
    expect(await asFresh.query(api.billing.tenant.myBilling, {})).toMatchObject({ suspended: true, suspensionReason: 'Chargeback dispute' })

    const events = await s.t.run((ctx) => ctx.db.query('platformEvents').collect())
    expect(events.map((e) => e.action)).toContain('tenant.suspended')
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').withIndex('by_company', (q) => q.eq('companyId', s.companyA)).collect())
    expect(audit.map((a) => a.actionType)).toContain('platform.tenant.suspended')

    await s.asRoot.mutation(api.platform.tenants.reactivate, { companyId: s.companyA })
    expect(await asFresh.query(api.farmLocations.list, {})).toHaveLength(1)
    expect((await s.asRoot.query(api.platform.tenants.detail, { companyId: s.companyA }))?.company.state).toBe('active')
  })

  test('plan limits refuse sites, units and members past the plan with an upgrade message', async () => {
    const s = await setup()
    await subscribe(s, s.companyA) // starter: 1 site, 5 members, 20 units
    const e = await errorOf(s.asAdminA.mutation(api.farmLocations.create, { name: 'A2' }))
    expect(e).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'PLAN_LIMIT', limit: 'sites', max: 1, used: 1 } })
    expect(e.message).toMatch(/upgrade/i)
    // An inactive site does not count.
    await s.asAdminA.mutation(api.farmLocations.create, { name: 'Archive', active: false })

    await s.asRoot.mutation(api.platform.tenants.setOverrides, {
      companyId: s.companyA,
      limitOverrides: { sites: 2, units: 1, users: 1 },
      featureOverrides: null,
    })
    await s.asAdminA.mutation(api.farmLocations.create, { name: 'A2' })
    await s.asAdminA.mutation(api.cages.create, { name: 'Cage 1', locationId: s.siteA })
    expect(await errorOf(s.asAdminA.mutation(api.cages.create, { name: 'Cage 2', locationId: s.siteA }))).toMatchObject({
      details: { reason: 'PLAN_LIMIT', limit: 'units' },
    })
    expect(await errorOf(s.asAdminA.mutation(api.users.invite, { email: 'new@a.com' }))).toMatchObject({
      details: { reason: 'PLAN_LIMIT', limit: 'users' },
    })
    // Another organization without a subscription is not limited.
    const b = await s.t.run((ctx) => ctx.db.query('subscriptions').withIndex('by_companyId', (q) => q.eq('companyId', s.companyB)).first())
    expect(b).toBeNull()
  })

  test('daily cron: trial ends → past_due with an invoice → suspended after grace → paid invoice reactivates', async () => {
    const s = await setup()
    await s.asRoot.mutation(api.platform.billing.seedDefaultPlans, {})
    const starter = (await s.asRoot.query(api.platform.billing.listPlans, {})).find((p) => p.code === 'starter')!
    await s.asRoot.mutation(api.platform.tenants.changePlan, { companyId: s.companyA, planId: starter.id, status: 'trialing' })
    const t0 = Date.now()

    expect(await s.t.mutation(internal.billing.lifecycle.runDaily, { now: t0 + 13 * DAY_MS })).toMatchObject({ pastDue: 0, suspended: 0 })
    expect(await s.t.mutation(internal.billing.lifecycle.runDaily, { now: t0 + 15 * DAY_MS })).toMatchObject({ pastDue: 1, suspended: 0 })
    let detail = (await s.asRoot.query(api.platform.tenants.detail, { companyId: s.companyA }))!
    expect(detail.subscription).toMatchObject({ status: 'past_due', graceEndsAt: t0 + 15 * DAY_MS + 7 * DAY_MS })
    expect(detail.invoices).toHaveLength(1)
    expect(detail.invoices[0]).toMatchObject({ status: 'open', totalMinor: 25_000, currency: 'GHS' })
    // Owner notified in-app.
    const notes = await s.t.run((ctx) => ctx.db.query('notifications').collect())
    expect(notes.some((n) => n.userId === s.adminA && /trial has ended/.test(n.title))).toBe(true)
    // Running again the same day changes nothing.
    expect(await s.t.mutation(internal.billing.lifecycle.runDaily, { now: t0 + 15 * DAY_MS })).toMatchObject({ pastDue: 0, suspended: 0 })

    expect(await s.t.mutation(internal.billing.lifecycle.runDaily, { now: t0 + 23 * DAY_MS })).toMatchObject({ suspended: 1 })
    detail = (await s.asRoot.query(api.platform.tenants.detail, { companyId: s.companyA }))!
    expect(detail.subscription?.status).toBe('suspended')
    expect(detail.company).toMatchObject({ state: 'suspended', suspensionSource: 'billing' })
    expect((await errorOf(s.asAdminA.query(api.farmLocations.list, {}))).message).toContain('TENANT_SUSPENDED')

    const paid = await s.asRoot.mutation(api.platform.billing.recordPayment, {
      companyId: s.companyA,
      invoiceId: detail.invoices[0].id,
      currency: 'GHS',
      amountMinor: 25_000,
      method: 'mobile_money',
      providerRef: 'MOMO-123',
      idempotencyKey: 'pay-1',
    })
    expect(paid).toMatchObject({ duplicate: false, invoicePaid: true, reactivated: true })
    detail = (await s.asRoot.query(api.platform.tenants.detail, { companyId: s.companyA }))!
    expect(detail.subscription?.status).toBe('active')
    expect(detail.company.state).toBe('active')
    expect(await s.asAdminA.query(api.farmLocations.list, {})).toHaveLength(1)
  })

  test('a platform suspension is not lifted by a payment', async () => {
    const s = await setup()
    await subscribe(s, s.companyA)
    const inv = await s.asRoot.mutation(api.platform.billing.createInvoiceForTenant, {
      companyId: s.companyA,
      currency: 'GHS',
      lines: [{ description: 'Renewal', quantity: 1, unitAmountMinor: 500 }],
      dueInDays: 7,
      renewsSubscription: true,
    })
    await s.asRoot.mutation(api.platform.tenants.suspend, { companyId: s.companyA, reason: 'Terms violation' })
    const r = await s.asRoot.mutation(api.platform.billing.recordPayment, {
      companyId: s.companyA,
      invoiceId: inv.id,
      currency: 'GHS',
      amountMinor: 500,
      method: 'bank',
      idempotencyKey: 'bank-1',
    })
    expect(r).toMatchObject({ invoicePaid: true, reactivated: false })
    expect((await s.asRoot.query(api.platform.tenants.detail, { companyId: s.companyA }))?.company.state).toBe('suspended')
  })

  test('recording a payment is idempotent by key', async () => {
    const s = await setup()
    await subscribe(s, s.companyA)
    const args = { companyId: s.companyA, currency: 'GHS', amountMinor: 1000, method: 'bank' as const, idempotencyKey: 'form-abc' }
    const first = await s.asRoot.mutation(api.platform.billing.recordPayment, args)
    const again = await s.asRoot.mutation(api.platform.billing.recordPayment, args)
    expect(again).toMatchObject({ paymentId: first.paymentId, duplicate: true })
    expect(await s.t.run((ctx) => ctx.db.query('billingPayments').collect())).toHaveLength(1)
    const events = await s.t.run((ctx) => ctx.db.query('platformEvents').collect())
    expect(events.filter((e) => e.action === 'payment.recorded')).toHaveLength(1)
    expect(await errorOf(s.asRoot.mutation(api.platform.billing.recordPayment, { ...args, amountMinor: 2000 }))).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'IDEMPOTENCY_MISMATCH' },
    })
  })

  test('approval starts a trial; backfill is a dry run by default', async () => {
    const s = await setup()
    const dry = await s.t.mutation(internal.billing.lifecycle.backfillSubscriptions, {})
    expect(dry).toMatchObject({ dryRun: true, wouldCreate: 2, created: 0 })
    expect(await s.t.run((ctx) => ctx.db.query('subscriptions').collect())).toEqual([])
    expect(await s.t.run((ctx) => ctx.db.query('plans').collect())).toEqual([])

    const live = await s.t.mutation(internal.billing.lifecycle.backfillSubscriptions, { dryRun: false })
    expect(live).toMatchObject({ dryRun: false, created: 2, planCode: 'starter' })
    expect(await s.t.mutation(internal.billing.lifecycle.backfillSubscriptions, { dryRun: false })).toMatchObject({ created: 0 })

    const pending = await s.t.run(async (ctx) => {
      const owner = await ctx.db.insert('users', { email: 'new@farm.com' })
      return await ctx.db.insert('companies', { name: 'New Farm', code: 'NEW', status: 'pending', submittedByUserId: owner, createdAt: Date.now() })
    })
    await s.asRoot.mutation(api.companies.approve, { companyId: pending })
    const sub = await s.t.run((ctx) => ctx.db.query('subscriptions').withIndex('by_companyId', (q) => q.eq('companyId', pending)).first())
    expect(sub).toMatchObject({ status: 'trialing', trialEndsAt: Date.now() + 14 * DAY_MS })
  })

  test('platform admins: promote by email, never demote yourself or the last admin', async () => {
    const s = await setup()
    expect(await errorOf(s.asRoot.mutation(api.platform.admins.demote, { userId: s.root }))).toMatchObject({ code: 'CONFLICT' })
    await s.asRoot.mutation(api.platform.admins.promote, { email: 'admin@a.com' })
    const list = await s.asRoot.query(api.platform.admins.list, {})
    expect(list.admins.map((a) => a.email).sort()).toEqual(['admin@a.com', 'root2@platform.com', 'root@platform.com'])
    await s.asRoot.mutation(api.platform.admins.demote, { userId: s.adminA })
    expect(await s.t.run((ctx) => ctx.db.get(s.adminA))).toMatchObject({ role: 'admin' })
    const audit = await s.asRoot.query(api.platform.audit.list, { action: 'admin.' })
    expect(audit.rows.map((r) => r.action)).toEqual(['admin.demoted', 'admin.promoted'])
  })

  test('overview and tenants list shapes', async () => {
    const s = await setup()
    await subscribe(s, s.companyA, 'growth')
    await s.t.mutation(internal.platform.usage.rollupCompanyDay, { companyId: s.companyA, date: new Date().toISOString().slice(0, 10) })
    const k = await s.asRoot.query(api.platform.overview.kpis, {})
    expect(k.tenants).toMatchObject({ active: 2, total: 2 })
    expect(k.subscriptions).toMatchObject({ active: 1, none: 1 })
    expect(k.mrr).toEqual([{ currency: 'GHS', amountMinor: 75_000 }])
    expect(k.arr).toEqual([{ currency: 'GHS', amountMinor: 900_000 }])
    const list = await s.asRoot.query(api.platform.tenants.list, { search: 'lake' })
    expect(list.total).toBe(1)
    expect(list.rows[0]).toMatchObject({ name: 'Lake Farm', planCode: 'growth', subscriptionStatus: 'active', sites: 1, members: 1 })
    expect(list.rows[0].health).toBeGreaterThan(0)
    expect((await s.asRoot.query(api.platform.tenants.list, { subscriptionStatus: 'none' })).rows.map((r) => r.name)).toEqual(['River Farm'])
  })
})
