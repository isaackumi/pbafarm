/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { DAY_MS, DEFAULT_PLANS } from './billing/model'
import { hmacSha512Hex } from './billing/paystack'

const modules = import.meta.glob('./**/*.ts')
const SECRET = 'sk_test_plat107'

/** PLAT-107: Paystack checkout, webhook settlement and tenant isolation. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const starter = DEFAULT_PLANS[0]
    const planId = await ctx.db.insert('plans', { ...starter, active: true, createdAt: now, updatedAt: now })
    const company = async (name: string, code: string) => {
      const companyId = await ctx.db.insert('companies', {
        name,
        code,
        status: 'approved',
        createdAt: now,
        suspendedAt: now,
        suspensionReason: 'Unpaid after the grace period',
        suspensionSource: 'billing',
      })
      const owner = await ctx.db.insert('users', { email: `owner@${code.toLowerCase()}.test`, name: 'Owner', role: 'admin', companyId })
      await ctx.db.insert('memberships', { userId: owner, companyId, roleKey: 'owner', status: 'active', allLocations: true, updatedAt: now })
      const session = await ctx.db.insert('authSessions', { userId: owner, expirationTime: now + DAY_MS })
      const subId = await ctx.db.insert('subscriptions', {
        companyId,
        planId,
        status: 'suspended',
        currency: 'GHS',
        currentPeriodStart: now - 40 * DAY_MS,
        currentPeriodEnd: now - 10 * DAY_MS,
        suspendedAt: now,
        provider: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      const invoiceId = await ctx.db.insert('billingInvoices', {
        companyId,
        subscriptionId: subId,
        number: `INV-202611-${code === 'LAKE' ? '0001' : '0002'}`,
        currency: 'GHS',
        lines: [{ description: 'Starter plan (month)', quantity: 1, unitAmountMinor: 25_000 }],
        totalMinor: 25_000,
        paidMinor: 0,
        status: 'open',
        issuedAt: now,
        dueAt: now + 7 * DAY_MS,
        provider: 'manual',
      })
      return { companyId, owner, session, subId, invoiceId }
    }
    return { a: await company('Lake Farm', 'LAKE'), b: await company('River Farm', 'RIVER') }
  })
  return {
    t,
    ...ids,
    asA: t.withIdentity({ subject: `${ids.a.owner}|${ids.a.session}` }),
    asB: t.withIdentity({ subject: `${ids.b.owner}|${ids.b.session}` }),
  }
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    // Errors that cross an action boundary arrive JSON-encoded (once more per hop).
    let raw = (e as { data?: unknown }).data
    while (typeof raw === 'string') raw = JSON.parse(raw)
    return (raw ?? { message: String((e as Error).message) }) as { code?: string; message: string }
  }
  throw new Error('expected a rejection')
}

/** Scripted Paystack: records calls and answers initialize/verify. */
function fakePaystack(verify: (ref: string) => Record<string, unknown> = () => ({})) {
  const calls: { url: string; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url.endsWith('/transaction/initialize')) {
      const ref = JSON.parse(String(init?.body)).reference
      return new Response(
        JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.com/${ref}`, access_code: ref, reference: ref } }),
        { status: 200 },
      )
    }
    const ref = decodeURIComponent(url.split('/transaction/verify/')[1] ?? '')
    return new Response(
      JSON.stringify({ status: true, data: { status: 'success', reference: ref, amount: 25_000, currency: 'GHS', channel: 'card', ...verify(ref) } }),
      { status: 200 },
    )
  })
  return calls
}

function enablePaystack() {
  vi.stubEnv('BILLING_PROVIDER', 'paystack')
  vi.stubEnv('PAYSTACK_SECRET_KEY', SECRET)
  vi.stubEnv('SITE_URL', 'https://app.getanowa.com')
}

async function webhook(t: Awaited<ReturnType<typeof setup>>['t'], data: Record<string, unknown>, opts: { secret?: string; event?: string } = {}) {
  const raw = JSON.stringify({ event: opts.event ?? 'charge.success', data })
  const sig = await hmacSha512Hex(opts.secret ?? SECRET, new TextEncoder().encode(raw))
  return await t.fetch('/paystack/webhook', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-paystack-signature': sig } })
}

const success = (reference: string, over: Record<string, unknown> = {}) => ({
  status: 'success',
  reference,
  amount: 25_000,
  currency: 'GHS',
  channel: 'mobile_money',
  paid_at: '2026-11-20T10:00:00.000Z',
  ...over,
})

async function state(s: Awaited<ReturnType<typeof setup>>, which: 'a' | 'b' = 'a') {
  const x = s[which]
  return await s.t.run(async (ctx) => ({
    invoice: (await ctx.db.get(x.invoiceId))!,
    sub: (await ctx.db.get(x.subId))!,
    company: (await ctx.db.get(x.companyId))!,
    payments: await ctx.db.query('billingPayments').withIndex('by_invoiceId', (q) => q.eq('invoiceId', x.invoiceId)).take(10),
    checkouts: await ctx.db.query('billingCheckouts').withIndex('by_invoiceId', (q) => q.eq('invoiceId', x.invoiceId)).take(10),
    events: (await ctx.db.query('platformEvents').withIndex('by_companyId_and_at', (q) => q.eq('companyId', x.companyId)).take(20)).map((e) => e.action),
  }))
}

describe('Paystack billing (PLAT-107)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('without PAYSTACK_SECRET_KEY the manual provider stays: no online button, no network, no checkout row', async () => {
    const s = await setup()
    const calls = fakePaystack()
    vi.stubEnv('BILLING_PROVIDER', 'paystack')
    expect((await s.asA.query(api.billing.tenant.myBilling, {}))!.onlinePayment).toBeNull()
    const r = await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })
    expect(r.kind).toBe('manual')
    expect(calls).toHaveLength(0)
    expect((await state(s)).checkouts).toHaveLength(0)
    // The webhook route is closed too.
    expect((await webhook(s.t, success('ANW-INV-202611-0001-1'))).status).toBe(404)
  })

  test('owner pays: initialize with the invoice balance → webhook settles, renews and lifts the billing suspension', async () => {
    const s = await setup()
    enablePaystack()
    const calls = fakePaystack()
    expect((await s.asA.query(api.billing.tenant.myBilling, {}))!.onlinePayment).toBe('paystack')
    const r = await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })
    expect(r).toEqual({ kind: 'redirect', url: 'https://checkout.paystack.com/ANW-INV-202611-0001-1' })
    expect(calls[0].body).toMatchObject({
      amount: 25_000,
      currency: 'GHS',
      reference: 'ANW-INV-202611-0001-1',
      email: 'owner@lake.test',
      callback_url: 'https://app.getanowa.com/billing?paystack=return',
    })
    // A second click within the window reuses the hosted page (no new transaction).
    expect(await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })).toEqual(r)
    expect(calls).toHaveLength(1)

    const res = await webhook(s.t, success('ANW-INV-202611-0001-1'))
    expect(res.status).toBe(200)
    const after = await state(s)
    expect(after.invoice.status).toBe('paid')
    expect(after.sub.status).toBe('active')
    expect(after.company.suspendedAt).toBeUndefined()
    expect(after.payments).toHaveLength(1)
    expect(after.payments[0]).toMatchObject({ provider: 'paystack', method: 'mobile_money', amountMinor: 25_000, idempotencyKey: 'paystack:ANW-INV-202611-0001-1' })
    expect(after.checkouts[0].status).toBe('succeeded')
    expect(after.events).toContain('payment.recorded')

    // Returning to /billing afterwards is a no-op.
    expect(await s.asA.action(api.billing.checkout.confirmReturn, { reference: 'ANW-INV-202611-0001-1' })).toBe('duplicate')
  })

  test('webhook: a bad or missing signature is refused before anything is written', async () => {
    const s = await setup()
    enablePaystack()
    fakePaystack()
    await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })
    expect((await webhook(s.t, success('ANW-INV-202611-0001-1'), { secret: 'sk_attacker' })).status).toBe(401)
    const unsigned = await s.t.fetch('/paystack/webhook', { method: 'POST', body: JSON.stringify({ event: 'charge.success', data: success('ANW-INV-202611-0001-1') }) })
    expect(unsigned.status).toBe(401)
    const after = await state(s)
    expect(after.invoice.status).toBe('open')
    expect(after.payments).toHaveLength(0)
  })

  test('webhook replay is idempotent: one payment, one audit row', async () => {
    const s = await setup()
    enablePaystack()
    fakePaystack()
    await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })
    for (let i = 0; i < 3; i++) expect((await webhook(s.t, success('ANW-INV-202611-0001-1'))).status).toBe(200)
    const after = await state(s)
    expect(after.payments).toHaveLength(1)
    expect(after.invoice.paidMinor).toBe(25_000)
    expect(after.events.filter((e) => e === 'payment.recorded')).toHaveLength(1)
  })

  test('amount or currency mismatch does not settle; it is flagged for staff', async () => {
    const s = await setup()
    enablePaystack()
    fakePaystack()
    await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })
    expect((await webhook(s.t, success('ANW-INV-202611-0001-1', { amount: 100 }))).status).toBe(200)
    let after = await state(s)
    expect(after.invoice.status).toBe('open')
    expect(after.payments).toHaveLength(0)
    expect(after.company.suspendedAt).toBeDefined()
    expect(after.checkouts[0]).toMatchObject({ status: 'mismatch', reportedAmountMinor: 100 })
    expect(after.events).toContain('payment.mismatch')
    // A later "correct" event for the same flagged reference does not settle it either.
    await webhook(s.t, success('ANW-INV-202611-0001-1'))
    after = await state(s)
    expect(after.payments).toHaveLength(0)

    const s2 = await setup()
    await s2.asA.action(api.billing.checkout.payInvoice, { invoiceId: s2.a.invoiceId })
    await webhook(s2.t, success('ANW-INV-202611-0001-1', { currency: 'USD' }))
    expect((await state(s2)).invoice.status).toBe('open')
  })

  test('unknown references and non-charge events are acknowledged and ignored', async () => {
    const s = await setup()
    enablePaystack()
    expect((await webhook(s.t, success('ANW-INV-209901-9999-1'))).status).toBe(200)
    expect((await webhook(s.t, { reference: 'x' }, { event: 'transfer.success' })).status).toBe(200)
    const bad = await s.t.fetch('/paystack/webhook', {
      method: 'POST',
      body: 'not json',
      headers: { 'x-paystack-signature': await hmacSha512Hex(SECRET, new TextEncoder().encode('not json')) },
    })
    expect(bad.status).toBe(200)
    const counts = await s.t.run(async (ctx) => ({
      payments: (await ctx.db.query('billingPayments').take(5)).length,
      checkouts: (await ctx.db.query('billingCheckouts').take(5)).length,
    }))
    expect(counts).toEqual({ payments: 0, checkouts: 0 })
  })

  test('cross-tenant: an owner cannot initialize, confirm or see another organization’s invoice', async () => {
    const s = await setup()
    enablePaystack()
    const calls = fakePaystack()
    const crossErr = await errorOf(s.asB.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId }))
    expect(crossErr.code).toBe('NOT_FOUND')
    expect(calls).toHaveLength(0)
    expect((await state(s)).checkouts).toHaveLength(0)

    await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })
    const before = calls.length
    // B returning with A's reference learns nothing and triggers no verify.
    expect(await s.asB.action(api.billing.checkout.confirmReturn, { reference: 'ANW-INV-202611-0001-1' })).toBe('unknown')
    expect(calls).toHaveLength(before)
    expect((await state(s)).invoice.status).toBe('open')
    // Unauthenticated callers are refused.
    await expect(s.t.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })).rejects.toThrow()
  })

  test('callback verify settles when the webhook has not arrived; pending stays open', async () => {
    const s = await setup()
    enablePaystack()
    let status = 'ongoing'
    fakePaystack(() => ({ status }))
    await s.asA.action(api.billing.checkout.payInvoice, { invoiceId: s.a.invoiceId })
    expect(await s.asA.action(api.billing.checkout.confirmReturn, { reference: 'ANW-INV-202611-0001-1' })).toBe('pending')
    expect((await state(s)).invoice.status).toBe('open')
    status = 'success'
    expect(await s.asA.action(api.billing.checkout.confirmReturn, { reference: 'ANW-INV-202611-0001-1' })).toBe('settled')
    const after = await state(s)
    expect(after.invoice.status).toBe('paid')
    expect(after.payments[0].method).toBe('card')
  })

  test('feature flags: the Starter plan does not include outgoing webhooks or the public API', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.a.companyId, { suspendedAt: undefined, suspensionReason: undefined, suspensionSource: undefined })
      await ctx.db.patch(s.a.subId, { status: 'active', suspendedAt: undefined, currentPeriodEnd: Date.now() + 20 * DAY_MS })
    })
    const err = await errorOf(
      s.asA.mutation(internal.webhooks.createEndpointRow, { url: 'https://example.com/hook', eventTypes: ['daily_record.created'] }),
    )
    expect(err.code).toBe('FORBIDDEN')
    expect(err.message).toContain('Outgoing webhooks')
    const apiErr = await errorOf(
      s.asA.mutation(internal.apiKeys.insertKey, { name: 'k', scopes: ['read:cages'], prefix: 'p', hash: 'h' }),
    )
    expect(apiErr.code).toBe('FORBIDDEN')
    expect(apiErr.message).toContain('public API')
  })
})

