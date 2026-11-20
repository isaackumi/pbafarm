/**
 * Billing provider boundary (PLAT-107, D-019 Effect conventions).
 *
 * The billing domain (plans, subscriptions, invoices, payments) is
 * provider-agnostic. Anything that would talk to a payment provider goes
 * through this `Context.Service`, one `Layer` per provider:
 *
 *   - `manual` (now): platform staff record bank / mobile money / cash
 *     payments in the console. No network; checkout returns no URL.
 *   - `paystack` (PLAT-107): hosted checkout for cards + mobile money
 *     (convex/billing/paystack.ts). On when `BILLING_PROVIDER=paystack` and
 *     `PAYSTACK_SECRET_KEY` are both set; otherwise manual stays the default.
 *   - `stripe`: TODO stub.
 *
 * Adapters use `requestJsonAs` from lib/effectHttp.ts through the `Fetch`
 * service; payment-creating calls use `retries: 0` unless the vendor
 * de-duplicates by idempotency key.
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

export type BillingProviderId = 'manual' | 'paystack' | 'stripe'

export class BillingProviderError extends Data.TaggedError('BillingProviderError')<{
  readonly provider: BillingProviderId
  readonly message: string
  readonly retryable: boolean
}> {}

export type CheckoutRequest = {
  readonly companyId: string
  readonly invoiceNumber: string
  readonly currency: string
  readonly amountMinor: number
  readonly customerEmail?: string
  /** Sent to the provider so a retried request cannot charge twice (Paystack: the transaction reference). */
  readonly idempotencyKey: string
  /** Where the hosted page sends the payer afterwards. */
  readonly callbackUrl?: string
  /** Echoed back by the provider (no secrets). */
  readonly metadata?: Record<string, string>
}

export type CheckoutSession = {
  readonly provider: BillingProviderId
  /** Hosted payment page, or null when payment is recorded by staff. */
  readonly url: string | null
  readonly providerRef: string | null
  readonly instructions: string
}

export type VerifiedPayment = {
  readonly provider: BillingProviderId
  readonly providerRef: string
  readonly status: 'succeeded' | 'failed' | 'pending'
  readonly currency: string
  readonly amountMinor: number
  /** Payment channel as the provider reports it (card, mobile_money, bank, ...). */
  readonly channel?: string
  readonly paidAt?: number
}

export type BillingProviderApi = {
  readonly id: BillingProviderId
  /** Start paying an invoice. */
  readonly createCheckout: (req: CheckoutRequest) => Effect.Effect<CheckoutSession, BillingProviderError>
  /** Confirm a payment reference with the provider (webhooks call this before recording). */
  readonly verifyPayment: (providerRef: string) => Effect.Effect<VerifiedPayment, BillingProviderError>
}

export class BillingProvider extends Context.Service<BillingProvider, BillingProviderApi>()('anowa/BillingProvider') {}

export const MANUAL_INSTRUCTIONS =
  'Pay by bank transfer or mobile money using the invoice number as the reference. ' +
  'Platform staff record the payment and your plan stays active.'

export function makeManualProvider(): BillingProviderApi {
  return {
    id: 'manual',
    createCheckout: () =>
      Effect.succeed({ provider: 'manual', url: null, providerRef: null, instructions: MANUAL_INSTRUCTIONS }),
    verifyPayment: (providerRef) =>
      Effect.fail(
        new BillingProviderError({
          provider: 'manual',
          message: `Manual payments are recorded by staff; there is nothing to verify for ${providerRef}.`,
          retryable: false,
        }),
      ),
  }
}

function notConfigured(provider: BillingProviderId): BillingProviderApi {
  const fail = () =>
    Effect.fail(
      new BillingProviderError({
        provider,
        message: `${provider} billing is not available yet. Use manual billing.`,
        retryable: false,
      }),
    )
  return { id: provider, createCheckout: fail, verifyPayment: fail }
}

export const manualBillingLayer = Layer.succeed(BillingProvider, makeManualProvider())

// TODO(PLAT-107): Stripe adapter (USD card): Checkout Session, PaymentIntent
// retrieve, webhook signature check (Stripe-Signature).
export const stripeBillingLayer = Layer.succeed(BillingProvider, notConfigured('stripe'))

/**
 * The provider that collects new payments on this deployment. Paystack only
 * when explicitly selected AND its secret is set, so a half-configured
 * deployment keeps manual billing.
 */
export function activeBillingProvider(env: Record<string, string | undefined> = process.env): BillingProviderId {
  const choice = env.BILLING_PROVIDER?.trim().toLowerCase()
  if (choice === 'paystack' && env.PAYSTACK_SECRET_KEY?.trim()) return 'paystack'
  return 'manual'
}

/** A provider that is selected but not implemented (stripe). */
export const unavailableProvider = notConfigured
