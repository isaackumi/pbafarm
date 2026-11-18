import { v } from 'convex/values'
import type { FunctionReference } from 'convex/server'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'

/**
 * Dispatcher for the domain-event outbox (convex/lib/events.ts).
 *
 * `emitDomainEvent` writes a `pending` row in the emitting mutation. The
 * `dispatch domain events` cron (convex/crons.ts, every minute) drains pending
 * events oldest first in batches, so delivery latency is under a minute and
 * the number of scheduled functions does not grow with the number of events.
 * (doc 07 §2 sketched one `runAfter(0)` per event; batching was chosen to
 * bound scheduler volume and to keep emitting mutations free of scheduling.)
 *
 * Each consumer below runs as a nested mutation (its own subtransaction): if
 * one throws, its writes roll back, the error is recorded on the event, and
 * the other consumers still run. Consumers must be idempotent per event:
 * `dispatch` can be re-run for one event by an operator.
 *
 * To add a consumer (automation, analytics, ...): write an internal mutation
 * `({ eventId: v.id('domainEvents') }) => null` and append it to CONSUMERS.
 */
type Consumer = {
  name: string
  fn: FunctionReference<'mutation', 'internal', { eventId: Id<'domainEvents'> }, null>
}

export const CONSUMERS: Consumer[] = [
  // Outbound webhooks (INT-005).
  { name: 'webhooks', fn: internal.webhooks.fanOut },
]

/** Events per drain transaction; the drain re-schedules itself when full. */
export const DISPATCH_BATCH = 50

async function dispatchOne(ctx: MutationCtx, event: Doc<'domainEvents'>) {
  const errors: string[] = []
  for (const consumer of CONSUMERS) {
    try {
      await ctx.runMutation(consumer.fn, { eventId: event._id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`domain event ${event._id} consumer ${consumer.name} failed: ${message}`)
      errors.push(`${consumer.name}: ${message}`.slice(0, 300))
    }
  }
  await ctx.db.patch(event._id, {
    dispatchStatus: errors.length ? 'failed' : 'dispatched',
    dispatchError: errors.length ? errors.join('; ').slice(0, 1000) : undefined,
  })
}

/** Dispatch (or re-dispatch) one event. */
export const dispatch = internalMutation({
  args: { eventId: v.id('domainEvents') },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId)
    if (!event) return null
    await dispatchOne(ctx, event)
    return null
  },
})

/** Drain pending events, oldest first. Cron entry point. */
export const dispatchPending = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query('domainEvents')
      .withIndex('by_dispatchStatus_and_occurredAt', (q) => q.eq('dispatchStatus', 'pending'))
      .take(DISPATCH_BATCH)
    for (const event of pending) await dispatchOne(ctx, event)
    if (pending.length === DISPATCH_BATCH) {
      await ctx.scheduler.runAfter(0, internal.events.dispatchPending, {})
    }
    return pending.length
  },
})
