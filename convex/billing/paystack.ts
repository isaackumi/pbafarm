/**
 * Paystack adapter for the BillingProvider service (PLAT-107, D-019).
 *
 *   createCheckout  POST /transaction/initialize  -> hosted page (authorization_url)
 *   verifyPayment   GET  /transaction/verify/:ref -> status, amount, currency
 *   webhook         x-paystack-signature = hex HMAC-SHA512(raw body, secret key)
 *
 * No Convex functions here: `checkout.ts` runs these at the handler edge and
 * `http.ts` routes the webhook. Network goes through the `Fetch` service so
 * tests inject scripted fakes.
 *
 * Retries: initialize creates a pending transaction under our reference. A
 * timed-out or 5xx initialize may have landed, and a retry with the same
 * reference is refused by Paystack ("Duplicate Transaction Reference"), so
 * initialize is `retries: 0`; the next click uses a new attempt reference.
 * verify is a read and keeps the default transient retry.
 *
 * Amounts: Paystack takes the currency's subunit (pesewas, kobo, cents),
 * which is our `amountMinor` for every currency it supports.
 */
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import { Fetch, type FetchFn, type HttpError, type HttpPolicy, requestJsonAs } from '../lib/effectHttp'
import { BillingProvider, BillingProviderError, type BillingProviderApi, type CheckoutRequest, type VerifiedPayment } from './provider'

export const PAYSTACK_API = 'https://api.paystack.co'

/** Currencies a Paystack merchant can be enabled for (and whose subunit is our minor unit). */
export const PAYSTACK_CURRENCIES = ['GHS', 'NGN', 'KES', 'ZAR', 'USD'] as const

export function paystackSupports(currency: string): boolean {
  return (PAYSTACK_CURRENCIES as readonly string[]).includes(currency)
}

export const PAYSTACK_REFERENCE_RE = /^[A-Za-z0-9.=-]{6,100}$/

/**
 * Deterministic reference for one payment attempt on an invoice. Paystack
 * refuses a reused reference, so a second attempt gets `attempt + 1`.
 */
export function paystackReference(invoiceNumber: string, attempt: number): string {
  return `ANW-${invoiceNumber.replace(/[^A-Za-z0-9-]/g, '')}-${attempt}`
}

export type PaystackConfig = {
  readonly secretKey: string
  readonly baseUrl?: string
  /** Per-call policy overrides (tests shorten timeouts and backoff). */
  readonly initPolicy?: HttpPolicy
  readonly verifyPolicy?: HttpPolicy
}

const InitializeResponse = Schema.Struct({
  status: Schema.Boolean,
  message: Schema.optional(Schema.String),
  data: Schema.Struct({
    authorization_url: Schema.String,
    access_code: Schema.String,
    reference: Schema.String,
  }),
})

/** The transaction object of verify responses and charge.* webhook events. */
export const PaystackTransaction = Schema.Struct({
  status: Schema.String,
  reference: Schema.String,
  amount: Schema.Number,
  currency: Schema.String,
  channel: Schema.optional(Schema.NullOr(Schema.String)),
  paid_at: Schema.optional(Schema.NullOr(Schema.String)),
})
export type PaystackTransaction = Schema.Schema.Type<typeof PaystackTransaction>

const VerifyResponse = Schema.Struct({
  status: Schema.Boolean,
  message: Schema.optional(Schema.String),
  data: PaystackTransaction,
})

/** Paystack's own message from a 4xx body ({ status: false, message }). */
function vendorMessage(body: unknown): string | null {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 200)
  }
  return null
}

export function toProviderError(error: HttpError): BillingProviderError {
  switch (error._tag) {
    case 'HttpStatusError': {
      const vendor = vendorMessage(error.body)
      return new BillingProviderError({
        provider: 'paystack',
        message:
          error.status === 401
            ? 'Paystack refused the platform credentials. Ask the platform operator to check PAYSTACK_SECRET_KEY.'
            : `Paystack could not start the payment${vendor ? `: ${vendor}` : ''} (HTTP ${error.status}).`,
        retryable: error.status >= 500,
      })
    }
    case 'HttpTimeoutError':
    case 'HttpNetworkError':
      return new BillingProviderError({
        provider: 'paystack',
        message: 'Paystack did not respond. Try again in a minute.',
        retryable: true,
      })
    case 'HttpDecodeError':
      return new BillingProviderError({
        provider: 'paystack',
        message: 'Paystack sent an unexpected response.',
        retryable: false,
      })
  }
}

/** Paystack transaction status -> our payment status. */
export function mapPaystackStatus(status: string): VerifiedPayment['status'] {
  if (status === 'success') return 'succeeded'
  if (status === 'failed' || status === 'reversed') return 'failed'
  return 'pending' // abandoned, ongoing, pending, processing, queued
}

export function toVerifiedPayment(tx: PaystackTransaction): VerifiedPayment {
  const paidAt = tx.paid_at ? Date.parse(tx.paid_at) : NaN
  return {
    provider: 'paystack',
    providerRef: tx.reference,
    status: mapPaystackStatus(tx.status),
    currency: tx.currency.toUpperCase(),
    amountMinor: tx.amount,
    channel: tx.channel ?? undefined,
    paidAt: Number.isFinite(paidAt) ? paidAt : undefined,
  }
}

/** The browser is only ever sent to Paystack's own https pages. */
export function isPaystackCheckoutUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'paystack.com' || u.hostname.endsWith('.paystack.com'))
  } catch {
    return false
  }
}

export function makePaystackProvider(config: PaystackConfig, fetch: FetchFn): BillingProviderApi {
  const base = (config.baseUrl ?? PAYSTACK_API).replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${config.secretKey}` }
  const run = <A, E>(eff: Effect.Effect<A, E, Fetch>) => Effect.provideService(eff, Fetch, fetch)

  const createCheckout = (req: CheckoutRequest) =>
    run(
      Effect.gen(function* () {
        if (!paystackSupports(req.currency)) {
          return yield* Effect.fail(
            new BillingProviderError({ provider: 'paystack', message: `Online payment is not available in ${req.currency}.`, retryable: false }),
          )
        }
        if (!Number.isInteger(req.amountMinor) || req.amountMinor <= 0) {
          return yield* Effect.fail(new BillingProviderError({ provider: 'paystack', message: 'Nothing to pay on this invoice.', retryable: false }))
        }
        if (!req.customerEmail) {
          return yield* Effect.fail(new BillingProviderError({ provider: 'paystack', message: 'An email address is required to pay online.', retryable: false }))
        }
        const res = yield* requestJsonAs(
          InitializeResponse,
          {
            url: `${base}/transaction/initialize`,
            method: 'POST',
            headers,
            body: {
              email: req.customerEmail,
              amount: req.amountMinor,
              currency: req.currency,
              reference: req.idempotencyKey,
              ...(req.callbackUrl ? { callback_url: req.callbackUrl } : {}),
              metadata: { ...(req.metadata ?? {}), companyId: req.companyId, invoiceNumber: req.invoiceNumber },
            },
            redirect: 'manual',
          },
          { retries: 0, ...config.initPolicy },
        ).pipe(Effect.mapError(toProviderError))
        if (!res.status || res.data.reference !== req.idempotencyKey || !isPaystackCheckoutUrl(res.data.authorization_url)) {
          return yield* Effect.fail(new BillingProviderError({ provider: 'paystack', message: 'Paystack did not accept the payment.', retryable: false }))
        }
        return {
          provider: 'paystack' as const,
          url: res.data.authorization_url,
          providerRef: res.data.reference,
          instructions: 'Continue on Paystack to pay by card or mobile money.',
        }
      }),
    )

  const verifyPayment = (providerRef: string) =>
    run(
      Effect.gen(function* () {
        if (!PAYSTACK_REFERENCE_RE.test(providerRef)) {
          return yield* Effect.fail(new BillingProviderError({ provider: 'paystack', message: 'Invalid payment reference.', retryable: false }))
        }
        const res = yield* requestJsonAs(
          VerifyResponse,
          { url: `${base}/transaction/verify/${encodeURIComponent(providerRef)}`, method: 'GET', headers, redirect: 'manual' },
          { ...config.verifyPolicy },
        ).pipe(Effect.mapError(toProviderError))
        if (res.data.reference !== providerRef) {
          return yield* Effect.fail(new BillingProviderError({ provider: 'paystack', message: 'Paystack returned a different reference.', retryable: false }))
        }
        return toVerifiedPayment(res.data)
      }),
    )

  return { id: 'paystack', createCheckout, verifyPayment }
}

/** The Paystack layer; needs `Fetch` (FetchLive in production, fetchLayer(fake) in tests). */
export const paystackBillingLayer = (config: PaystackConfig) =>
  Layer.effect(
    BillingProvider,
    Effect.gen(function* () {
      const fetch = yield* Fetch
      return makePaystackProvider(config, fetch)
    }),
  )

// ── Webhook ────────────────────────────────────────────────────────────────

/** Webhook bodies larger than this are refused before verification. */
export const MAX_WEBHOOK_BYTES = 64 * 1024

const encoder = new TextEncoder()

/** Constant-time comparison (length leaks, content does not). */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export async function hmacSha512Hex(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, body as BufferSource)
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Check `x-paystack-signature` over the raw request bytes. */
export async function verifyPaystackSignature(rawBody: Uint8Array, header: string | null, secret: string | undefined): Promise<boolean> {
  if (!secret || !header) return false
  const given = header.trim().toLowerCase()
  if (!/^[0-9a-f]{128}$/.test(given)) return false
  return safeEqual(await hmacSha512Hex(secret, rawBody), given)
}

const WebhookEvent = Schema.Struct({ event: Schema.String, data: Schema.Unknown })

export type PaystackWebhook =
  | { kind: 'charge'; payment: VerifiedPayment }
  | { kind: 'ignored'; event: string }

/**
 * A verified webhook body as a payment update. Only charge.success and
 * charge.failed carry a settlement; everything else is acknowledged and ignored.
 */
export function parsePaystackWebhook(json: unknown): PaystackWebhook | null {
  const ev = Schema.decodeUnknownOption(WebhookEvent)(json)
  if (ev._tag === 'None') return null
  const { event, data } = ev.value
  if (event !== 'charge.success' && event !== 'charge.failed') return { kind: 'ignored', event: event.slice(0, 64) }
  const tx = Schema.decodeUnknownOption(PaystackTransaction)(data)
  if (tx._tag === 'None' || !PAYSTACK_REFERENCE_RE.test(tx.value.reference)) return null
  return { kind: 'charge', payment: toVerifiedPayment(tx.value) }
}
