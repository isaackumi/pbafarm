/**
 * Domain events: one transactional outbox for automation and webhooks
 * (docs/architecture/07 §2, §6; 09 §7).
 *
 * HOW TO EMIT
 *
 *   import { emitDomainEvent } from './lib/events'
 *
 *   await emitDomainEvent(ctx, 'stock.harvested', {
 *     companyId,
 *     subject: { table: 'harvestRecords', id: harvestId },
 *     locationId: cage.locationId,
 *     actorUserId: user._id,
 *     businessDate: args.harvestDate,
 *     data: { cageId: cage._id, cageName: cage.name, totalWeightKg: args.totalWeight },
 *   })
 *
 * Call it inside the mutation that makes the change, after the change is
 * written. It inserts a `domainEvents` row (status `pending`) in the same
 * transaction, so a rolled-back change never emits. The `dispatch domain
 * events` cron drains pending rows every minute (convex/events.ts). `actorUserId`,
 * `actorApiKeyId` and `origin` default from the ctx (API requests set an actor,
 * see ./apiActor.ts).
 *
 * RULES
 *   - One event per business operation, not per row (a 40-line daily batch is
 *     one `daily.batch.recorded`). This bounds scheduled-function volume.
 *   - `data` is flat: ≤ 40 keys, values string | number | boolean | null.
 *     Put ids as strings and the names a message would show (cage name).
 *     It is sent to customer webhooks: never put secrets or personal data
 *     beyond what the organization already sees in the app.
 *   - Add new types to `DOMAIN_EVENT_TYPES` below (with a label) so the
 *     webhook UI can offer them; unknown types are refused at emit time.
 *
 * HOW TO CONSUME
 *   Add a consumer to `CONSUMERS` in convex/events.ts: an internal mutation
 *   taking `{ eventId }`. Each consumer runs as its own subtransaction, so one
 *   failing consumer does not block the others (the error is recorded on the
 *   event). Consumers must be idempotent per event (dispatch can be re-run).
 */
import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { apiActorOf } from './apiActor'

/** Event catalog. Key = type, value = label shown in the webhook UI. */
export const DOMAIN_EVENT_TYPES = {
  'daily.batch.recorded': 'Daily records saved',
  'sampling.recorded': 'Sampling recorded',
  'stock.harvested': 'Harvest recorded',
  'stocking.approved': 'Stocking approved',
  'transfer.approved': 'Fish transfer approved',
  'inventory.stock.low': 'Feed stock fell to its minimum',
} as const

export type DomainEventType = keyof typeof DOMAIN_EVENT_TYPES

export function isDomainEventType(type: string): type is DomainEventType {
  return Object.prototype.hasOwnProperty.call(DOMAIN_EVENT_TYPES, type)
}

export const MAX_EVENT_DATA_KEYS = 40
const MAX_EVENT_STRING = 500

export type DomainEventValue = string | number | boolean | null

export type EmitDomainEventInput = {
  companyId: Id<'companies'>
  subject?: { table: string; id: string }
  locationId?: Id<'farmLocations'>
  actorUserId?: Id<'users'>
  origin?: 'user' | 'automation' | 'system' | 'api'
  businessDate?: string
  data?: Record<string, DomainEventValue | undefined>
}

/** Drop undefined, cap keys and string length; refuse non-scalars. */
export function cleanEventData(
  data: Record<string, DomainEventValue | undefined> | undefined,
): Record<string, DomainEventValue> {
  const out: Record<string, DomainEventValue> = {}
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === undefined) continue
    if (key.startsWith('$') || key.startsWith('_')) {
      throw new Error(`Event data key "${key}" cannot start with $ or _`)
    }
    if (Object.keys(out).length >= MAX_EVENT_DATA_KEYS) {
      throw new Error(`Event data can hold at most ${MAX_EVENT_DATA_KEYS} keys`)
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`Event data "${key}" must be a string, number, boolean or null`)
    }
    out[key] = typeof value === 'string' ? value.slice(0, MAX_EVENT_STRING) : value
  }
  return out
}

/** Append a domain event and schedule its dispatch. Returns the event id. */
export async function emitDomainEvent(
  ctx: MutationCtx,
  type: DomainEventType,
  input: EmitDomainEventInput,
): Promise<Id<'domainEvents'>> {
  if (!isDomainEventType(type)) throw new Error(`Unknown domain event type "${type}"`)
  const actor = apiActorOf(ctx)
  const eventId = await ctx.db.insert('domainEvents', {
    companyId: input.companyId,
    type,
    subjectTable: input.subject?.table,
    subjectId: input.subject?.id,
    locationId: input.locationId,
    actorUserId: input.actorUserId ?? actor?.user._id,
    actorApiKeyId: actor?.apiKeyId,
    origin: input.origin ?? (actor ? 'api' : 'user'),
    businessDate: input.businessDate,
    data: cleanEventData(input.data),
    dispatchStatus: 'pending',
    occurredAt: Date.now(),
  })
  return eventId
}

/** The public shape of an event (webhook payloads, API). */
export function eventEnvelope(event: {
  _id: Id<'domainEvents'>
  type: string
  occurredAt: number
  companyId: Id<'companies'>
  subjectTable?: string
  subjectId?: string
  locationId?: Id<'farmLocations'>
  origin: string
  businessDate?: string
  data: Record<string, DomainEventValue>
}) {
  return {
    id: event._id,
    type: event.type,
    occurredAt: new Date(event.occurredAt).toISOString(),
    companyId: event.companyId,
    subject: event.subjectTable ? { table: event.subjectTable, id: event.subjectId ?? null } : null,
    siteId: event.locationId ?? null,
    origin: event.origin,
    businessDate: event.businessDate ?? null,
    data: event.data,
  }
}
