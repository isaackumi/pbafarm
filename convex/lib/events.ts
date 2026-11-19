import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { apiActorOf } from './apiActor'

/**
 * Domain event outbox (AUTO-001, D-008, docs/architecture/07 §2).
 *
 * Call from a mutation, after the change the event describes. The row is
 * written in the same transaction, and consumers are scheduled with
 * `ctx.scheduler.runAfter(0, …)`, which only runs if the mutation commits:
 * an outbox without a polling relay.
 *
 * Consumers:
 *   - automation (convex/automation/engine.ts): scheduled only when the
 *     company has an enabled rule for this event type, so events nobody
 *     listens to cost one insert and one index read.
 *   - outbound webhooks (convex/webhooks.ts `fanOut`, INT-005): scheduled
 *     only when an active endpoint subscribes to the type; marks
 *     `processedBy` with 'webhooks'.
 *   - further consumers hook in the same way and mark `processedBy`.
 *
 * Keep payloads small (a few scalar fields, ids as strings): they are
 * evaluated by rule conditions and rendered into messages.
 */
export async function emitDomainEvent(
  ctx: MutationCtx,
  type: string,
  payload: Record<string, unknown>,
  opts?: { companyId?: Id<'companies'>; locationId?: Id<'farmLocations'> },
): Promise<Id<'domainEvents'> | null> {
  const companyId = opts?.companyId
  if (!companyId) return null
  // Changes made through the public API carry the key (INT-004); farm-bot
  // changes carry the chat channel (BOT-003).
  const actor = apiActorOf(ctx)
  const eventId = await ctx.db.insert('domainEvents', {
    companyId,
    locationId: opts?.locationId,
    type,
    payload: cleanPayload(
      actor
        ? actor.channel
          ? { ...payload, origin: 'bot', channel: actor.channel.provider }
          : { ...payload, origin: 'api', apiKeyId: actor.apiKeyId }
        : payload,
    ),
    createdAt: Date.now(),
  })

  const listening = await ctx.db
    .query('automationRules')
    .withIndex('by_company_and_eventType_and_enabled', (q) =>
      q.eq('companyId', companyId).eq('eventType', type).eq('enabled', true),
    )
    .first()
  if (listening) {
    await ctx.scheduler.runAfter(0, internal.automation.engine.dispatchEvent, { eventId })
  }

  // Outbound webhooks (INT-005): scheduled only when an active endpoint of
  // this company subscribes to the type, like automation above.
  const endpoints = await ctx.db
    .query('webhookEndpoints')
    .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'active'))
    .take(20)
  if (endpoints.some((e) => e.eventTypes.includes(type))) {
    await ctx.scheduler.runAfter(0, internal.webhooks.fanOut, { eventId })
  }
  return eventId
}

/** Drop undefined values (not valid Convex values) and keys Convex refuses. */
function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, value] of Object.entries(payload)) {
    if (value === undefined || !k || k.startsWith('$') || k.startsWith('_')) continue
    out[k] = value
  }
  return out
}
