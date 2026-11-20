import { describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import { type FetchFn, fetchLayer } from '../lib/effectHttp'
import { BillingProvider, type BillingProviderError, type CheckoutRequest, activeBillingProvider } from './provider'
import {
  hmacSha512Hex,
  mapPaystackStatus,
  parsePaystackWebhook,
  paystackBillingLayer,
  paystackReference,
  verifyPaystackSignature,
} from './paystack'

type Step = { status: number; body?: unknown } | { throws: unknown } | { hang: true }

/** Fake fetch that plays `steps` in order and records calls. */
function scripted(steps: Step[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, init })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if ('throws' in step) return Promise.reject(step.throws)
    if ('hang' in step) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    const text = step.body === undefined ? '' : typeof step.body === 'string' ? step.body : JSON.stringify(step.body)
    return Promise.resolve(new Response(text, { status: step.status }))
  }
  return { fetch, calls }
}

const fast = { timeoutMs: 50, retryBaseDelayMs: 1 }
const config = { secretKey: 'sk_test_x', initPolicy: fast, verifyPolicy: fast }

const req: CheckoutRequest = {
  companyId: 'co1',
  invoiceNumber: 'INV-202611-0001',
  currency: 'GHS',
  amountMinor: 25_000,
  customerEmail: 'owner@farm.test',
  idempotencyKey: paystackReference('INV-202611-0001', 1),
  callbackUrl: 'https://app.getanowa.com/billing?paystack=return',
}

function checkout(fetch: FetchFn, r: CheckoutRequest = req) {
  const program = Effect.gen(function* () {
    const billing = yield* BillingProvider
    return yield* billing.createCheckout(r)
  }).pipe(Effect.provide(paystackBillingLayer(config)), Effect.provide(fetchLayer(fetch)))
  return Effect.runPromise(Effect.result(program))
}

function verify(fetch: FetchFn, ref = req.idempotencyKey) {
  const program = Effect.gen(function* () {
    const billing = yield* BillingProvider
    return yield* billing.verifyPayment(ref)
  }).pipe(Effect.provide(paystackBillingLayer(config)), Effect.provide(fetchLayer(fetch)))
  return Effect.runPromise(Effect.result(program))
}

const initOk = {
  status: 200,
  body: {
    status: true,
    message: 'Authorization URL created',
    data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'abc', reference: req.idempotencyKey },
  },
}

const verifyOk = (over: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    status: true,
    data: { status: 'success', reference: req.idempotencyKey, amount: 25_000, currency: 'GHS', channel: 'mobile_money', paid_at: '2026-11-20T10:00:00.000Z', ...over },
  },
})

function failureOf(r: Awaited<ReturnType<typeof checkout>>): BillingProviderError {
  if (r._tag !== 'Failure') throw new Error('expected a failure')
  return r.failure
}

describe('Paystack adapter (PLAT-107)', () => {
  it('initialize: hosted page URL, minor units, deterministic reference, bearer secret', async () => {
    const { fetch, calls } = scripted([initOk])
    const r = await checkout(fetch)
    expect(r._tag).toBe('Success')
    if (r._tag === 'Success') {
      expect(r.success).toMatchObject({ provider: 'paystack', url: 'https://checkout.paystack.com/abc', providerRef: 'ANW-INV-202611-0001-1' })
    }
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.paystack.co/transaction/initialize')
    expect(calls[0].init?.method).toBe('POST')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_x')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body).toMatchObject({
      email: 'owner@farm.test',
      amount: 25_000,
      currency: 'GHS',
      reference: 'ANW-INV-202611-0001-1',
      callback_url: 'https://app.getanowa.com/billing?paystack=return',
    })
  })

  it('initialize: a 4xx is not retried and carries Paystack’s message', async () => {
    const { fetch, calls } = scripted([{ status: 400, body: { status: false, message: 'Duplicate Transaction Reference' } }])
    const e = failureOf(await checkout(fetch))
    expect(calls).toHaveLength(1)
    expect(e.retryable).toBe(false)
    expect(e.message).toContain('Duplicate Transaction Reference')
  })

  it('initialize: 401 points at the platform key, not the payer', async () => {
    const { fetch } = scripted([{ status: 401, body: { status: false, message: 'Invalid key' } }])
    expect(failureOf(await checkout(fetch)).message).toContain('PAYSTACK_SECRET_KEY')
  })

  it('initialize: 5xx and timeouts are not retried (the attempt may have landed; retries: 0)', async () => {
    const five = scripted([{ status: 503 }, initOk])
    const e5 = failureOf(await checkout(five.fetch))
    expect(five.calls).toHaveLength(1)
    expect(e5.retryable).toBe(true)

    const slow = scripted([{ hang: true }, initOk])
    const et = failureOf(await checkout(slow.fetch))
    expect(slow.calls).toHaveLength(1)
    expect(et.message).toContain('did not respond')
  })

  it('initialize: an unexpected body is a decode failure, not a URL', async () => {
    const { fetch } = scripted([{ status: 200, body: { status: true, data: { access_code: 'x' } } }])
    expect(failureOf(await checkout(fetch)).message).toContain('unexpected response')
  })

  it('initialize: a hosted page outside paystack.com is refused (no open redirect)', async () => {
    for (const url of ['https://evil.test/pay', 'http://checkout.paystack.com/x', 'https://paystack.com.evil.test/x', 'javascript:alert(1)']) {
      const { fetch } = scripted([{ status: 200, body: { status: true, data: { authorization_url: url, access_code: 'a', reference: req.idempotencyKey } } }])
      expect((await checkout(fetch))._tag).toBe('Failure')
    }
  })

  it('initialize: unsupported currency and missing email fail before any request', async () => {
    const { fetch, calls } = scripted([initOk])
    expect(failureOf(await checkout(fetch, { ...req, currency: 'XOF' })).message).toContain('XOF')
    expect(failureOf(await checkout(fetch, { ...req, customerEmail: undefined })).message).toContain('email')
    expect(calls).toHaveLength(0)
  })

  it('verify: success maps status, amount, channel; 5xx is retried (a read)', async () => {
    const { fetch, calls } = scripted([{ status: 502 }, verifyOk()])
    const r = await verify(fetch)
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('https://api.paystack.co/transaction/verify/ANW-INV-202611-0001-1')
    expect(r._tag).toBe('Success')
    if (r._tag === 'Success') {
      expect(r.success).toMatchObject({ status: 'succeeded', amountMinor: 25_000, currency: 'GHS', channel: 'mobile_money' })
      expect(r.success.paidAt).toBe(Date.parse('2026-11-20T10:00:00.000Z'))
    }
  })

  it('verify: a timeout is retried, a 404 is not, a malformed reference never reaches Paystack', async () => {
    const slow = scripted([{ hang: true }, verifyOk()])
    expect((await verify(slow.fetch))._tag).toBe('Success')
    expect(slow.calls).toHaveLength(2)

    const missing = scripted([{ status: 404, body: { status: false, message: 'Transaction reference not found' } }])
    expect((await verify(missing.fetch))._tag).toBe('Failure')
    expect(missing.calls).toHaveLength(1)

    const bad = scripted([verifyOk()])
    expect((await verify(bad.fetch, '../../x'))._tag).toBe('Failure')
    expect(bad.calls).toHaveLength(0)
  })

  it('verify: a response for another reference is refused; decode failures surface', async () => {
    const other = scripted([verifyOk({ reference: 'ANW-OTHER-1' })])
    expect((await verify(other.fetch))._tag).toBe('Failure')
    const junk = scripted([{ status: 200, body: { status: true, data: { amount: 'lots' } } }])
    expect((await verify(junk.fetch))._tag).toBe('Failure')
  })

  it('status mapping', () => {
    expect(mapPaystackStatus('success')).toBe('succeeded')
    expect(mapPaystackStatus('failed')).toBe('failed')
    expect(mapPaystackStatus('reversed')).toBe('failed')
    expect(mapPaystackStatus('abandoned')).toBe('pending')
    expect(mapPaystackStatus('ongoing')).toBe('pending')
  })

  it('provider selection: manual unless BILLING_PROVIDER=paystack and the secret are both set', () => {
    expect(activeBillingProvider({})).toBe('manual')
    expect(activeBillingProvider({ PAYSTACK_SECRET_KEY: 'sk' })).toBe('manual')
    expect(activeBillingProvider({ BILLING_PROVIDER: 'paystack' })).toBe('manual')
    expect(activeBillingProvider({ BILLING_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: ' ' })).toBe('manual')
    expect(activeBillingProvider({ BILLING_PROVIDER: 'Paystack', PAYSTACK_SECRET_KEY: 'sk' })).toBe('paystack')
  })
})

describe('Paystack webhook signature and parsing', () => {
  const body = new TextEncoder().encode(JSON.stringify({ event: 'charge.success', data: verifyOk().body.data }))

  it('accepts the HMAC-SHA512 of the raw body with the secret; refuses anything else', async () => {
    const sig = await hmacSha512Hex('sk_test_x', body)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
    expect(await verifyPaystackSignature(body, sig, 'sk_test_x')).toBe(true)
    expect(await verifyPaystackSignature(body, sig.toUpperCase(), 'sk_test_x')).toBe(true)
    expect(await verifyPaystackSignature(body, sig, 'sk_other')).toBe(false)
    expect(await verifyPaystackSignature(new TextEncoder().encode('{"event":"charge.success"}'), sig, 'sk_test_x')).toBe(false)
    expect(await verifyPaystackSignature(body, null, 'sk_test_x')).toBe(false)
    expect(await verifyPaystackSignature(body, 'abc', 'sk_test_x')).toBe(false)
    expect(await verifyPaystackSignature(body, sig, undefined)).toBe(false)
  })

  it('charge.success becomes a payment; other events are ignored; junk is null', () => {
    const parsed = parsePaystackWebhook(JSON.parse(new TextDecoder().decode(body)))
    expect(parsed).toMatchObject({ kind: 'charge', payment: { providerRef: 'ANW-INV-202611-0001-1', status: 'succeeded', amountMinor: 25_000 } })
    expect(parsePaystackWebhook({ event: 'transfer.success', data: {} })).toEqual({ kind: 'ignored', event: 'transfer.success' })
    expect(parsePaystackWebhook({ nope: true })).toBeNull()
    expect(parsePaystackWebhook({ event: 'charge.success', data: { reference: 'x' } })).toBeNull()
  })
})
