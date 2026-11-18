/**
 * How each outbox kind reaches the server (MOBILE-002). Services load on
 * demand so the shell that flushes the outbox stays light. Every sender
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

export async function sendOutboxItem(payload, item) {
  const kind = kindOf(item)
  if (kind === 'biweekly-batch') {
    const { biweeklyRecordService } = await import('./databaseService')
    return biweeklyRecordService.createBatch(payload)
  }
  if (kind === 'harvest') {
    const { harvestRecordService } = await import('./databaseService')
    return harvestRecordService.createHarvestRecord(payload)
  }
  if (kind === 'feed-issue') {
    const { getConvexHttpClient, api } = await import('./convexBridge')
    try {
      const data = await getConvexHttpClient().mutation(api.feed.createIssue, payload)
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  }
  if (kind === 'larval-log') {
    const { getConvexHttpClient, api } = await import('./convexBridge')
    try {
      const data = await getConvexHttpClient().mutation(api.nursery.saveLarvalLog, payload)
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  }
  const { dailyRecordService } = await import('./databaseService')
  return dailyRecordService.createBatch(payload)
}
