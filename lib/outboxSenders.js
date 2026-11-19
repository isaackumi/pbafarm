/**
 * How each outbox kind reaches the server (MOBILE-002). The Convex client and
 * argument builders load on demand so the shell that flushes the outbox stays
 * light. Every sender
 * resolves to { data, error } and forwards the payload's `clientMutationId`.
 */
import { enqueueEntry, isNetworkError, kindOf, newClientMutationId } from './offlineOutbox'

/**
 * Save one field form now, or keep it on the device when there is no signal.
 * The same `clientMutationId` is used for the try and the queued copy, so if
 * the server did write before the response was lost, sending the copy later
 * returns that write instead of making a second one.
 *
 * Resolves to { queued: true } | { data, warnings } | { error }.
 */
export async function saveOrQueue(
  { kind, payload, summary = '', userId },
  { send = sendOutboxItem, storage, online } = {},
) {
  const withKey = { ...payload, clientMutationId: payload?.clientMutationId || newClientMutationId() }
  const queue = () => {
    enqueueEntry({ kind, payload: withKey, summary }, userId, storage)
    return { queued: true }
  }
  const isOnline = online ?? (typeof navigator === 'undefined' || navigator.onLine !== false)
  if (!isOnline) return queue()
  let res
  try {
    res = await send(withKey, { kind })
  } catch (error) {
    res = { error }
  }
  if (!res?.error) return { data: res?.data, warnings: res?.warnings }
  if (isNetworkError(res.error)) return queue()
  return { error: res.error }
}

/** Run one Convex mutation as { data, error } (the outbox sender contract). */
async function mutate(pick, args) {
  try {
    const { getConvexHttpClient, api } = await import('./convexBridge')
    const data = await getConvexHttpClient().mutation(pick(api), await args())
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

const recordArgs = () => import('./recordArgs')

export async function sendOutboxItem(payload, item) {
  const kind = kindOf(item)
  if (kind === 'biweekly-batch') {
    return mutate((api) => api.biweeklyRecords.createBatch, async () => (await recordArgs()).batchArgs(payload))
  }
  if (kind === 'harvest') {
    // harvest.create returns { id, warnings }.
    const res = await mutate((api) => api.harvest.create, async () => (await recordArgs()).harvestCreateArgs(payload))
    if (res.error) return res
    return { data: res.data?.id ?? res.data, warnings: res.data?.warnings || [], error: null }
  }
  if (kind === 'water-quality') return mutate((api) => api.waterQuality.record, async () => payload)
  if (kind === 'inspection') return mutate((api) => api.equipment.logInspection, async () => payload)
  if (kind === 'feed-issue') return mutate((api) => api.feed.createIssue, async () => payload)
  if (kind === 'larval-log') return mutate((api) => api.nursery.saveLarvalLog, async () => payload)
  return mutate((api) => api.dailyRecords.createBatch, async () => (await recordArgs()).batchArgs(payload))
}
