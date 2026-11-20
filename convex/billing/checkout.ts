/**
 * Online invoice payment (PLAT-107, doc 22 §6).
 *
 *   /billing "Pay invoice" -> payInvoice (action)
 *     beginCheckout (owner of the invoice's organization, open invoice)
 *     -> Paystack initialize (reference ANW-<invoice>-<attempt>, retries: 0)
 *     -> authorization_url, the browser goes to Paystack
 *   Paystack -> POST /paystack/webhook (HMAC-SHA512 signed)    -> settle
 *   Paystack -> /billing?paystack=return&reference=… -> confirmReturn
 *     (owner of that checkout) -> GET /transaction/verify/:ref -> settle
 *
 * `settle` is the only writer of payments here: it finds the checkout by
 * reference (unknown references are ignored), refuses to settle when the
 * provider's amount or currency differs from what we asked for, and records
 * the payment through `applyPayment` with key `paystack:<reference>`, so the
 * webhook and the return-verify can both arrive, in either order, any number
 * of times, and the invoice is credited once.
 */
import { v } from 'convex/values'
import { action, httpAction, internalMutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { requireUser } from '../lib/authz'
import { memberContext, requirePermission } from '../lib/permissions'
import { userError } from '../lib/errors'
import { runEffect } from '../lib/effect'
import { siteUrl } from '../lib/email'
import { FetchLive } from '../lib/effectHttp'
import * as Effect from 'effect/Effect'
import { BillingProvider, type BillingProviderError, MANUAL_INSTRUCTIONS, activeBillingProvider } from './provider'
import {
  MAX_WEBHOOK_BYTES,
  PAYSTACK_REFERENCE_RE,
  parsePaystackWebhook,
  paystackBillingLayer,
  paystackReference,
  paystackSupports,
  verifyPaystackSignature,
} from './paystack'
import { applyPayment, recordPlatformEvent } from './ops'

/** Attempts kept per invoice (bounds the reference scan). */
const MAX_ATTEMPTS = 50
/** A pending hosted page is reused for this long instead of starting a new attempt. */
export const REUSE_PENDING_MS = 30 * 60 * 1000

const payment = v.object({
  providerRef: v.string(),
  status: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('pending')),
  currency: v.string(),
  amountMinor: v.number(),
  channel: v.optional(v.string()),
  paidAt: v.optional(v.number()),
})

const settleOutcome = v.union(
  v.literal('settled'),
  v.literal('duplicate'),
  v.literal('pending'),
  v.literal('failed'),
  v.literal('mismatch'),
  v.literal('unknown'),
)

function providerUserError(e: BillingProviderError) {
  return userError('UPSTREAM', e.message, { reason: 'BILLING_PROVIDER', provider: e.provider })
}

async function payingOwner(ctx: MutationCtx) {
  // Suspended organizations can still pay; read-only act-as sessions cannot.
  const user = await requireUser(ctx, { allowSuspended: true })
  const m = await memberContext(ctx, user)
  if (!m.companyId) throw userError('FORBIDDEN', 'Join an organization first')
  requirePermission(m, 'org.settings.manage')
  return { user, companyId: m.companyId }
}

/** Authorize, then reuse a live hosted page or open a new attempt for an invoice. */
export const beginCheckout = internalMutation({
  args: { invoiceId: v.id('billingInvoices') },
  returns: v.union(
    v.object({ kind: v.literal('manual'), instructions: v.string() }),
    v.object({ kind: v.literal('redirect'), url: v.string() }),
    v.object({
      kind: v.literal('initialize'),
      checkoutId: v.id('billingCheckouts'),
      companyId: v.id('companies'),
      invoiceNumber: v.string(),
      reference: v.string(),
      currency: v.string(),
      amountMinor: v.number(),
      email: v.string(),
    }),
  ),
  handler: async (ctx, { invoiceId }) => {
    const { user, companyId } = await payingOwner(ctx)
    const invoice = await ctx.db.get(invoiceId)
    // Another organization's invoice looks exactly like a missing one.
    if (!invoice || invoice.companyId !== companyId) throw userError('NOT_FOUND', 'Invoice not found')
    if (invoice.status !== 'open') throw userError('CONFLICT', 'This invoice is not open for payment')
    const balance = invoice.totalMinor - invoice.paidMinor
    if (balance <= 0) throw userError('CONFLICT', 'This invoice has nothing left to pay')

    const provider = activeBillingProvider()
    if (provider !== 'paystack') {
      return { kind: 'manual' as const, instructions: process.env.BILLING_PAYMENT_INSTRUCTIONS?.trim() || MANUAL_INSTRUCTIONS }
    }
    if (!paystackSupports(invoice.currency)) {
      throw userError('VALIDATION', `Online payment is not available in ${invoice.currency}. Use the payment instructions on this page.`)
    }

    const now = Date.now()
    const attempts = await ctx.db
      .query('billingCheckouts')
      .withIndex('by_invoiceId', (q) => q.eq('invoiceId', invoiceId))
      .order('desc')
      .take(MAX_ATTEMPTS)
    const live = attempts.find(
      (c) =>
        c.status === 'pending' &&
        c.authorizationUrl &&
        c.amountMinor === balance &&
        c.currency === invoice.currency &&
        now - c.createdAt < REUSE_PENDING_MS,
    )
    if (live?.authorizationUrl) return { kind: 'redirect' as const, url: live.authorizationUrl }
    if (attempts.length >= MAX_ATTEMPTS) {
      throw userError('RATE_LIMITED', 'Too many payment attempts on this invoice. Contact support.')
    }
    const attempt = (attempts[0]?.attempt ?? 0) + 1
    const reference = paystackReference(invoice.number, attempt)
    const checkoutId = await ctx.db.insert('billingCheckouts', {
      companyId,
      invoiceId,
      provider: 'paystack',
      reference,
      attempt,
      currency: invoice.currency,
      amountMinor: balance,
      status: 'initializing',
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })
    const email = user.email?.trim() || `billing+${companyId}@${(process.env.BILLING_FALLBACK_EMAIL_DOMAIN || 'getanowa.com').trim()}`
    return {
      kind: 'initialize' as const,
      checkoutId,
      companyId,
      invoiceNumber: invoice.number,
      reference,
      currency: invoice.currency,
      amountMinor: balance,
      email,
    }
  },
})

export const markInitialized = internalMutation({
  args: { checkoutId: v.id('billingCheckouts'), url: v.optional(v.string()), failureReason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { checkoutId, url, failureReason }) => {
    const row = await ctx.db.get(checkoutId)
    if (!row || row.status !== 'initializing') return null
    await ctx.db.patch(checkoutId, {
      ...(url ? { status: 'pending' as const, authorizationUrl: url } : { status: 'failed' as const, failureReason: failureReason?.slice(0, 300) }),
      updatedAt: Date.now(),
    })
    return null
  },
})

function paystackConfig() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim()
  if (!secretKey) throw userError('CONFLICT', 'Online payment is not configured on this deployment.')
  return { secretKey, baseUrl: process.env.PAYSTACK_API_BASE?.trim() || undefined }
}

/** Start paying an open invoice: a hosted Paystack page, or the manual instructions. */
export const payInvoice = action({
  args: { invoiceId: v.id('billingInvoices') },
  returns: v.union(
    v.object({ kind: v.literal('manual'), instructions: v.string() }),
    v.object({ kind: v.literal('redirect'), url: v.string() }),
  ),
  handler: async (ctx, { invoiceId }): Promise<{ kind: 'manual'; instructions: string } | { kind: 'redirect'; url: string }> => {
    const begun = await ctx.runMutation(internal.billing.checkout.beginCheckout, { invoiceId })
    if (begun.kind !== 'initialize') return begun
    const program = Effect.gen(function* () {
      const billing = yield* BillingProvider
      return yield* billing.createCheckout({
        companyId: begun.companyId,
        invoiceNumber: begun.invoiceNumber,
        currency: begun.currency,
        amountMinor: begun.amountMinor,
        customerEmail: begun.email,
        idempotencyKey: begun.reference,
        callbackUrl: `${siteUrl()}/billing?paystack=return`,
        metadata: { checkoutId: begun.checkoutId },
      })
    }).pipe(Effect.provide(paystackBillingLayer(paystackConfig())), Effect.provide(FetchLive))
    try {
      const session = await runEffect(program, { toUserError: providerUserError })
      if (!session.url) throw userError('UPSTREAM', 'Paystack did not return a payment page.')
      await ctx.runMutation(internal.billing.checkout.markInitialized, { checkoutId: begun.checkoutId, url: session.url })
      return { kind: 'redirect' as const, url: session.url }
    } catch (e) {
      await ctx.runMutation(internal.billing.checkout.markInitialized, {
        checkoutId: begun.checkoutId,
        failureReason: e instanceof Error ? e.message : 'initialize failed',
      })
      throw e
    }
  },
})

/** The caller may confirm this reference only if it is their organization's checkout. */
export const ownCheckout = internalMutation({
  args: { reference: v.string() },
  returns: v.union(v.null(), v.object({ status: v.string() })),
  handler: async (ctx, { reference }) => {
    const { companyId } = await payingOwner(ctx)
    const row = await ctx.db
      .query('billingCheckouts')
      .withIndex('by_reference', (q) => q.eq('reference', reference))
      .first()
    if (!row || row.companyId !== companyId) return null
    return { status: row.status }
  },
})

/**
 * Back from Paystack (callback URL): verify the reference with Paystack and
 * settle. The webhook usually got there first; this is then a no-op.
 */
export const confirmReturn = action({
  args: { reference: v.string() },
  returns: settleOutcome,
  handler: async (ctx, { reference }): Promise<SettleOutcome> => {
    if (!PAYSTACK_REFERENCE_RE.test(reference)) return 'unknown'
    const own = await ctx.runMutation(internal.billing.checkout.ownCheckout, { reference })
    if (!own) return 'unknown'
    if (own.status === 'succeeded') return 'duplicate'
    if (own.status === 'mismatch' || own.status === 'failed') return own.status
    const program = Effect.gen(function* () {
      const billing = yield* BillingProvider
      return yield* billing.verifyPayment(reference)
    }).pipe(Effect.provide(paystackBillingLayer(paystackConfig())), Effect.provide(FetchLive))
    const verified = await runEffect(program, { toUserError: providerUserError })
    const result: { outcome: SettleOutcome } = await ctx.runMutation(internal.billing.checkout.settle, {
      payment: {
        providerRef: verified.providerRef,
        status: verified.status,
        currency: verified.currency,
        amountMinor: verified.amountMinor,
        channel: verified.channel,
        paidAt: verified.paidAt,
      },
      source: 'verify',
    })
    return result.outcome
  },
})

export type SettleOutcome = 'settled' | 'duplicate' | 'pending' | 'failed' | 'mismatch' | 'unknown'

function methodFor(channel: string | undefined): Doc<'billingPayments'>['method'] {
  if (channel === 'mobile_money') return 'mobile_money'
  if (channel === 'bank' || channel === 'bank_transfer' || channel === 'dedicated_nuban') return 'bank'
  return 'card'
}

/** Record a provider-reported payment against our checkout, once. */
export const settle = internalMutation({
  args: { payment, source: v.union(v.literal('webhook'), v.literal('verify')) },
  returns: v.object({ outcome: settleOutcome }),
  handler: async (ctx, { payment: p, source }): Promise<{ outcome: SettleOutcome }> => {
    const row = await ctx.db
      .query('billingCheckouts')
      .withIndex('by_reference', (q) => q.eq('reference', p.providerRef))
      .first()
    if (!row || row.provider !== 'paystack') return { outcome: 'unknown' }
    if (row.status === 'succeeded') return { outcome: 'duplicate' }
    if (row.status === 'mismatch') return { outcome: 'mismatch' }
    const now = Date.now()
    if (p.status === 'pending') return { outcome: 'pending' }
    if (p.status === 'failed') {
      await ctx.db.patch(row._id, { status: 'failed', failureReason: 'Declined or reversed at Paystack', updatedAt: now })
      return { outcome: 'failed' }
    }
    if (p.amountMinor !== row.amountMinor || p.currency !== row.currency) {
      await ctx.db.patch(row._id, {
        status: 'mismatch',
        reportedAmountMinor: p.amountMinor,
        reportedCurrency: p.currency,
        updatedAt: now,
      })
      await recordPlatformEvent(ctx, {
        action: 'payment.mismatch',
        companyId: row.companyId,
        targetTable: 'billingCheckouts',
        targetId: row._id,
        details: {
          provider: 'paystack',
          reference: row.reference,
          expected: { currency: row.currency, amountMinor: row.amountMinor },
          reported: { currency: p.currency, amountMinor: p.amountMinor },
          source,
        },
      })
      return { outcome: 'mismatch' }
    }
    const result = await applyPayment(ctx, {
      companyId: row.companyId,
      invoiceId: row.invoiceId,
      currency: p.currency,
      amountMinor: p.amountMinor,
      method: methodFor(p.channel),
      provider: 'paystack',
      providerRef: row.reference,
      idempotencyKey: `paystack:${row.reference}`,
      receivedAt: p.paidAt ?? now,
      note: `Paystack ${p.channel ?? 'payment'} (${source})`,
    })
    await ctx.db.patch(row._id, { status: 'succeeded', paymentId: result.paymentId, updatedAt: now })
    if (!result.duplicate) {
      await recordPlatformEvent(ctx, {
        action: 'payment.recorded',
        companyId: row.companyId,
        targetTable: 'billingPayments',
        targetId: result.paymentId,
        details: {
          provider: 'paystack',
          reference: row.reference,
          currency: p.currency,
          amountMinor: p.amountMinor,
          method: methodFor(p.channel),
          invoicePaid: result.invoicePaid,
          reactivated: result.reactivated,
          source,
        },
      })
    }
    return { outcome: result.duplicate ? 'duplicate' : 'settled' }
  },
})

// ── Webhook: POST /paystack/webhook ─────────────────────────────────────────

async function rawBody(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_WEBHOOK_BYTES) return null
  const buf = new Uint8Array(await request.arrayBuffer())
  return buf.byteLength > MAX_WEBHOOK_BYTES ? null : buf
}

/**
 * Paystack events. The signature is checked on the raw bytes before parsing
 * and before any database access; unsigned or mis-signed requests get 401.
 * Valid events are always answered 200 (Paystack retries non-2xx), including
 * references we never issued.
 */
export const paystackWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim()
  if (!secret) return new Response(null, { status: 404 })
  const body = await rawBody(request)
  if (!body) return new Response(null, { status: 413 })
  if (!(await verifyPaystackSignature(body, request.headers.get('x-paystack-signature'), secret))) {
    return new Response(null, { status: 401 })
  }
  let json: unknown = null
  try {
    json = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return new Response('ok', { status: 200 })
  }
  const parsed = parsePaystackWebhook(json)
  if (parsed?.kind === 'charge') {
    const p = parsed.payment
    await ctx.runMutation(internal.billing.checkout.settle, {
      payment: {
        providerRef: p.providerRef,
        status: p.status,
        currency: p.currency,
        amountMinor: p.amountMinor,
        channel: p.channel,
        paidAt: p.paidAt,
      },
      source: 'webhook',
    })
  }
  return new Response('ok', { status: 200 })
})
