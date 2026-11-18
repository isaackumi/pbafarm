/**
 * Tiny offline outbox for field entries.
 *
 * When a phone has no signal, a batch is kept in localStorage and sent when the
 * connection comes back. Each item remembers its last server error so a rejected
 * batch (duplicate, out of stock) is shown instead of silently retried forever.
 *
 * The queue is per user (`pbafarm:outbox:<userId>:daily-batch`) and every item
 * records who created it (`createdBy`), so a second person signing in on the
 * same phone never sends the first person's entries under their own name.
 *
 * Every function takes an optional `storage` (a Storage-like object) last, for
 * tests; the default is `window.localStorage`.
 *
 * Since MOBILE-002 the queue holds every field form, not only daily batches:
 * each item has a `kind` (OUTBOX_KINDS; items saved before this have none and
 * are daily batches) and its payload carries a `clientMutationId`. The server
 * stores the first result per id, so sending an item again after a lost
 * response returns that result instead of writing twice. The storage key
 * keeps its old name so queues saved before the upgrade are still sent.
 */
import { errorMessage } from './errorMessage'

/** The single global queue used before entries were scoped per user. */
export const LEGACY_OUTBOX_KEY = 'pbafarm:outbox:daily-batch'

export const ANOTHER_ACCOUNT_ERROR =
  'Saved by another account on this device. Not sent.'

/** What can wait in the outbox, with the label people see. */
export const OUTBOX_KINDS = {
  'daily-batch': 'Daily entry',
  'biweekly-batch': 'Bi-weekly sampling',
  'feed-issue': 'Feed issue',
  harvest: 'Harvest',
}

export const DEFAULT_KIND = 'daily-batch'

export function kindOf(item) {
  return item?.kind && OUTBOX_KINDS[item.kind] ? item.kind : DEFAULT_KIND
}

/** A fresh replay key for one save (shared by the online try and the queue). */
export function newClientMutationId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

export function outboxKey(userId) {
  return `pbafarm:outbox:${userId}:daily-batch`
}

function defaultStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readKey(key, storage) {
  if (!storage) return []
  try {
    const raw = storage.getItem(key)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeKey(key, list, storage) {
  if (!storage) return
  try {
    if (list.length) storage.setItem(key, JSON.stringify(list))
    else storage.removeItem(key)
  } catch {
    // storage full or blocked: nothing else we can do offline
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new Event('pbafarm:outbox'))
    } catch {
      // no Event constructor (tests)
    }
  }
}

function read(userId, storage) {
  if (!userId) return []
  return readKey(outboxKey(userId), storage)
}

function write(userId, list, storage) {
  if (!userId) return
  writeKey(outboxKey(userId), list, storage)
}

/** True when this item may be sent by `userId`. */
export function isOwnedBy(item, userId) {
  return Boolean(userId) && item?.createdBy === userId
}

export function listOutbox(userId, storage = defaultStorage()) {
  return read(userId, storage)
}

export function outboxCount(userId, storage = defaultStorage()) {
  return read(userId, storage).length
}

/**
 * Queue one save of `kind`. The payload keeps its `clientMutationId` (or gets
 * one), so an item that already reached the server is not written again.
 */
export function enqueueEntry({ kind = DEFAULT_KIND, payload, summary = '' }, userId, storage = defaultStorage()) {
  if (!userId) throw new Error('Sign in again before saving entries on this device.')
  if (!OUTBOX_KINDS[kind]) throw new Error(`Unknown outbox kind: ${kind}`)
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    payload: {
      ...payload,
      clientMutationId: payload?.clientMutationId || newClientMutationId(),
    },
    summary,
    createdBy: userId,
    queuedAt: Date.now(),
    lastError: null,
  }
  write(userId, [...read(userId, storage), item], storage)
  return item
}

/** Daily batch shorthand (the original API). */
export function enqueue(payload, summary = '', userId, storage = defaultStorage()) {
  return enqueueEntry({ kind: DEFAULT_KIND, payload, summary }, userId, storage)
}

export function removeFromOutbox(id, userId, storage = defaultStorage()) {
  write(
    userId,
    read(userId, storage).filter((i) => i.id !== id),
    storage,
  )
}

/** Drop every queued item of this user (sign-out "Discard"). */
export function clearOutbox(userId, storage = defaultStorage()) {
  if (!userId || !storage) return
  writeKey(outboxKey(userId), [], storage)
}

/**
 * Move the old global queue into this user's queue.
 *
 * Items written before user scoping have no `createdBy`; they are adopted by
 * the user signed in now (the only person who could have queued them on this
 * device without a second sign-in). Items stamped with another user stay in
 * the legacy key and are never sent by this user.
 *
 * Returns the number of items moved.
 */
export function migrateLegacyOutbox(userId, storage = defaultStorage()) {
  if (!userId || !storage) return 0
  const legacy = readKey(LEGACY_OUTBOX_KEY, storage)
  if (!legacy.length) return 0
  const mine = []
  const others = []
  for (const item of legacy) {
    if (!item || typeof item !== 'object') continue
    if (item.createdBy == null || item.createdBy === userId) {
      mine.push({ ...item, createdBy: userId, migratedFromLegacy: true })
    } else {
      others.push(item)
    }
  }
  if (mine.length) {
    const current = read(userId, storage)
    const known = new Set(current.map((i) => i.id))
    write(userId, [...current, ...mine.filter((i) => !known.has(i.id))], storage)
  }
  writeKey(LEGACY_OUTBOX_KEY, others, storage)
  return mine.length
}

/** True when the failure is about connectivity, not about the data. */
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String(err?.message || err || '')
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|ECONN|offline/i.test(
    msg,
  )
}

let flushing = null

/**
 * Try to send every queued item of `userId`. `send(payload, item)` must
 * resolve to { error } (`item.kind` says which form). Items not created by
 * `userId` are refused (kept, marked, never sent). Returns { sent, failed,
 * refused } counts. Stops early if the network drops again. `only` limits the
 * run to one item id (Retry). Runs one at a time per page: a second call
 * waits for the first, so an item is never in flight twice.
 */
export async function flushOutbox(send, userId, storage = defaultStorage(), { only } = {}) {
  while (flushing) {
    try {
      await flushing
    } catch {
      // the earlier run's failure is its caller's business
    }
  }
  const run = flushOnce(send, userId, storage, only)
  flushing = run
  try {
    return await run
  } finally {
    if (flushing === run) flushing = null
  }
}

async function flushOnce(send, userId, storage, only) {
  let sent = 0
  let failed = 0
  let refused = 0
  if (!userId) return { sent, failed, refused }
  for (const queued of read(userId, storage)) {
    if (only && queued.id !== only) continue
    let item = queued
    if (!isOwnedBy(item, userId)) {
      refused += 1
      if (item.lastError !== ANOTHER_ACCOUNT_ERROR) {
        write(
          userId,
          read(userId, storage).map((i) =>
            i.id === item.id ? { ...i, lastError: ANOTHER_ACCOUNT_ERROR } : i,
          ),
          storage,
        )
      }
      continue
    }
    if (!item.payload?.clientMutationId) {
      // Queued before replay keys: give it one now and keep it, so a retry
      // after a lost response is recognised by the server.
      item = { ...item, payload: { ...item.payload, clientMutationId: `outbox-${item.id}` } }
      write(
        userId,
        read(userId, storage).map((i) => (i.id === item.id ? item : i)),
        storage,
      )
    }
    let error = null
    try {
      const res = await send(item.payload, item)
      error = res?.error || null
    } catch (err) {
      error = err
    }
    if (!error) {
      removeFromOutbox(item.id, userId, storage)
      sent += 1
      continue
    }
    if (isNetworkError(error)) break
    failed += 1
    write(
      userId,
      read(userId, storage).map((i) =>
        i.id === item.id ? { ...i, lastError: cleanError(error) } : i,
      ),
      storage,
    )
  }
  return { sent, failed, refused }
}

/**
 * The human sentence for a failed send: `error.data.message` for a ConvexError
 * (convex/lib/errors.ts), otherwise `error.message` without Convex's
 * request-id/stack noise.
 */
export function cleanError(err) {
  return errorMessage(err)
}
