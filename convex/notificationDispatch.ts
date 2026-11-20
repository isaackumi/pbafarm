import { v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { runEffect } from './lib/effect'
import { deliverMessage } from './messaging/deliver'
import { sendAll } from './automation/deliver'
import { EVENT_RETENTION_DAYS, RETRY_BACKOFF_MIN } from './automation/engine'
import type { RunDelivery } from './automation/validators'
import { notificationEmailReader, renderNotificationEmail } from './lib/notificationEmail'

/**
 * Sends the SMS/WhatsApp/email of a system notification (AUTO-003), queued
 * by convex/lib/notify.ts `notifyUsers`. Same pipeline as automation runs:
 *
 *   start (mutation): mark running, return pending deliveries
 *   send (action):    sendAll (Effect) → deliverMessage → company route
 *   finish (mutation): record outcomes; retry only failures the provider
 *                      marked retryable (never timeouts: the vendor may have
 *                      accepted the message), with back-off; else settle.
 */

type Plan = {
  companyId: Id<'companies'>
  pending: {
    index: number
    input: { channel: RunDelivery['channel']; to: string; subject: string; body: string; html?: string }
  }[]
}

export const start = internalMutation({
  args: { dispatchId: v.id('notificationDispatches') },
  returns: v.union(
    v.object({
      companyId: v.id('companies'),
      pending: v.array(
        v.object({
          index: v.number(),
          input: v.object({
            channel: v.union(v.literal('email'), v.literal('sms'), v.literal('whatsapp')),
            to: v.string(),
            subject: v.string(),
            body: v.string(),
            html: v.optional(v.string()),
          }),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, { dispatchId }): Promise<Plan | null> => {
    const d = await ctx.db.get(dispatchId)
    if (!d || !['queued', 'retrying'].includes(d.status)) return null
    const reader = await notificationEmailReader(ctx, d.companyId)
    const pending: Plan['pending'] = []
    for (const [index, x] of d.deliveries.entries()) {
      if (x.status !== 'pending') continue
      if (x.channel !== 'email') {
        pending.push({ index, input: { channel: x.channel, to: x.to, subject: x.subject, body: x.body } })
        continue
      }
      // HTML email (E4/E5/E6); the text part is the plain alternative.
      const mail = renderNotificationEmail({
        locale: await reader.locale(x.userId),
        orgName: reader.orgName,
        source: d.source,
        email: d.email,
        delivery: x,
      })
      pending.push({ index, input: { channel: 'email', to: x.to, subject: mail.subject, body: mail.text, html: mail.html } })
    }
    if (!pending.length) {
      await settle(ctx, d)
      return null
    }
    await ctx.db.patch(dispatchId, { status: 'running', attempts: d.attempts + 1, nextAttemptAt: undefined })
    return { companyId: d.companyId, pending }
  },
})

function summarize(failed: RunDelivery[]) {
  const first = failed[0]
  const more = failed.length > 1 ? ` (+${failed.length - 1} more)` : ''
  return `${first.channel} to ${first.to}: ${first.error ?? 'failed'}${more}`.slice(0, 500)
}

async function settle(ctx: MutationCtx, d: Doc<'notificationDispatches'>) {
  const failed = d.deliveries.filter((x) => x.status === 'failed')
  const sent = d.deliveries.filter((x) => x.status === 'sent').length
  await ctx.db.patch(d._id, {
    status: !failed.length ? (sent ? 'succeeded' : 'skipped') : sent ? 'partial' : 'failed',
    error: failed.length ? summarize(failed) : undefined,
    finishedAt: Date.now(),
    nextAttemptAt: undefined,
  })
}

export const finish = internalMutation({
  args: {
    dispatchId: v.id('notificationDispatches'),
    outcomes: v.array(
      v.object({
        index: v.number(),
        ok: v.boolean(),
        providerMessageId: v.optional(v.string()),
        error: v.optional(v.string()),
        retryable: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { dispatchId, outcomes }) => {
    const d = await ctx.db.get(dispatchId)
    if (!d) return null
    const deliveries = [...d.deliveries]
    for (const o of outcomes) {
      const x = deliveries[o.index]
      if (!x || x.status !== 'pending') continue
      deliveries[o.index] = o.ok
        ? { ...x, status: 'sent', attempts: x.attempts + 1, providerMessageId: o.providerMessageId, error: undefined, retryable: undefined }
        : { ...x, status: 'failed', attempts: x.attempts + 1, error: o.error?.slice(0, 300), retryable: o.retryable === true }
    }
    const retry = deliveries.some((x) => x.status === 'failed' && x.retryable)
    if (retry && d.attempts < d.maxAttempts) {
      const delayMin = RETRY_BACKOFF_MIN[Math.min(d.attempts - 1, RETRY_BACKOFF_MIN.length - 1)] ?? 1
      const at = Date.now() + delayMin * 60_000
      await ctx.db.patch(dispatchId, {
        deliveries: deliveries.map((x) => (x.status === 'failed' && x.retryable ? { ...x, status: 'pending' as const } : x)),
        status: 'retrying',
        nextAttemptAt: at,
        error: summarize(deliveries.filter((x) => x.status === 'failed')),
      })
      await ctx.scheduler.runAt(at, internal.notificationDispatch.send, { dispatchId })
      return null
    }
    await ctx.db.patch(dispatchId, { deliveries })
    await settle(ctx, { ...d, deliveries })
    return null
  },
})

/** The attempt crashed before sending (transient database error or bug). */
export const fail = internalMutation({
  args: { dispatchId: v.id('notificationDispatches'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { dispatchId, error }) => {
    const d = await ctx.db.get(dispatchId)
    if (!d) return null
    await ctx.db.patch(dispatchId, { status: 'failed', error: error.slice(0, 500), finishedAt: Date.now() })
    return null
  },
})

export const send = internalAction({
  args: { dispatchId: v.id('notificationDispatches') },
  returns: v.null(),
  handler: async (ctx, { dispatchId }) => {
    let plan: Plan | null
    try {
      plan = await ctx.runMutation(internal.notificationDispatch.start, { dispatchId })
    } catch (e) {
      await ctx.runMutation(internal.notificationDispatch.fail, {
        dispatchId,
        error: e instanceof Error ? e.message : String(e),
      })
      return null
    }
    if (!plan) return null
    const companyId = plan.companyId
    const outcomes = await runEffect(sendAll((input) => deliverMessage(ctx, companyId, input), plan.pending))
    await ctx.runMutation(internal.notificationDispatch.finish, { dispatchId, outcomes })
    return null
  },
})

/** Kept as long as domain events (30 days). */
export const prune = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - EVENT_RETENTION_DAYS * 86_400_000
    const old = await ctx.db
      .query('notificationDispatches')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    for (const d of old) await ctx.db.delete(d._id)
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.notificationDispatch.prune, {})
    return old.length
  },
})
