/**
 * Billing provider boundary (PLAT-107, D-019 Effect conventions).
 *
 * The billing domain (plans, subscriptions, invoices, payments) is
 * provider-agnostic. Anything that would talk to a payment provider goes
 * through this `Context.Service`, one `Layer` per provider:
 *
 *   - `manual` (now): platform staff record bank / mobile money / cash
 *     payments in the console. No network; checkout returns no URL.
 *   - `paystack`, `stripe`: TODO stubs. Provider choice is pending research
 *     (docs/architecture/22-platform-console-billing.md §6); a real adapter
 *     uses `requestJsonAs` from lib/effectHttp.ts through the `Fetch` service,
 *     and payment-creating calls use `retries: 0` unless the vendor
 *     de-duplicates by idempotency key.
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
  /** Sent to the provider so a retried request cannot charge twice. */
  readonly idempotencyKey: string
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
  readonly status: 'succeeded' | 'failed'
  readonly currency: string
  readonly amountMinor: number
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

// TODO(PLAT-107): Paystack adapter (GHS/XOF mobile money + card): initialize
// transaction, verify by reference, webhook signature check (HMAC-SHA512).
export const paystackBillingLayer = Layer.succeed(BillingProvider, notConfigured('paystack'))

// TODO(PLAT-107): Stripe adapter (USD card): Checkout Session, PaymentIntent
// retrieve, webhook signature check (Stripe-Signature).
export const stripeBillingLayer = Layer.succeed(BillingProvider, notConfigured('stripe'))

export function billingLayerFor(provider: BillingProviderId) {
  switch (provider) {
    case 'manual':
      return manualBillingLayer
    case 'paystack':
      return paystackBillingLayer
    case 'stripe':
      return stripeBillingLayer
  }
}

/** The checkout for an invoice through its provider's layer. */
export function checkoutFor(provider: BillingProviderId, req: CheckoutRequest) {
  return Effect.gen(function* () {
    const billing = yield* BillingProvider
    return yield* billing.createCheckout(req)
  }).pipe(Effect.provide(billingLayerFor(provider)))
}
