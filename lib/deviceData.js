/**
 * What sign-out removes from this device so the next person on a shared
 * phone does not see or send the previous user's data (MOBILE-001, D-010).
 *
 * Pure over Storage-like objects so it can be tested.
 */
import { outboxKey } from './offlineOutbox'
import { CACHED_USER_PREFIX } from './offlineSession'

/** Form drafts written by hooks/usePersistedForm (local and session storage). */
export const FORM_DRAFT_PREFIX = 'pbafarm:form:'

/** Fixed keys holding the previous user's data. */
export const SIGN_OUT_KEYS = [
  'persist:root', // redux-persist (cages, dashboard, feed, biweekly, auth)
  'pbafarm:daily-entry:lookups', // cached cages and feed types for offline entry
  'pba_active_location_id', // last active site
]

export function removeKeysWithPrefix(storage, prefix) {
  if (!storage) return
  try {
    const keys = []
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i)
      if (k && k.startsWith(prefix)) keys.push(k)
    }
    keys.forEach((k) => storage.removeItem(k))
  } catch {
    // storage blocked
  }
}

/**
 * Clear the signed-out user's data.
 *
 * `keepOutbox` keeps that user's queued entries (forced sign-out: the account
 * was disabled, so they are neither sent nor silently lost; they stay scoped
 * to that user and no one else can send them). Other users' outboxes are
 * never touched.
 */
export function clearDeviceData({ local, session, userId, keepOutbox = false }) {
  for (const k of SIGN_OUT_KEYS) {
    try {
      local?.removeItem(k)
    } catch {
      // ignore
    }
  }
  removeKeysWithPrefix(local, FORM_DRAFT_PREFIX)
  removeKeysWithPrefix(session, FORM_DRAFT_PREFIX)
  removeKeysWithPrefix(local, CACHED_USER_PREFIX)
  if (userId && !keepOutbox) {
    try {
      local?.removeItem(outboxKey(userId))
    } catch {
      // ignore
    }
  }
}
