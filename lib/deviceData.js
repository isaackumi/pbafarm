/**
 * What sign-out removes from this device so the next person on a shared
 * phone does not see or send the previous user's data (MOBILE-001, D-010).
 *
 * Pure over Storage-like objects so it can be tested.
 */
import { forgetOutboxMirror, outboxKey } from './offlineOutbox'
import { CACHED_USER_PREFIX } from './offlineSession'
import { LEGACY_LOOKUPS_KEY, REFERENCE_PREFIX } from './referenceCache'
import { PREFS_PREFIX } from './userPreferences'

/** Form drafts written by hooks/usePersistedForm (local and session storage). */
export const FORM_DRAFT_PREFIX = 'pbafarm:form:'

/**
 * The Redux-persist cache of server data (cages, dashboard, feed, biweekly,
 * auth). Retired by UX-002: screens read Convex live, so nothing writes it.
 */
export const RETIRED_REDUX_KEY = 'persist:root'

/** Remove server data the app no longer writes (run once per page load). */
export function clearRetiredData(local) {
  try {
    local?.removeItem(RETIRED_REDUX_KEY)
  } catch {
    // storage blocked
  }
}

/** Fixed keys holding the previous user's data. */
export const SIGN_OUT_KEYS = [
  RETIRED_REDUX_KEY,
  LEGACY_LOOKUPS_KEY, // unscoped cages/feed types cache (before MOBILE-003)
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
  removeKeysWithPrefix(local, REFERENCE_PREFIX)
  removeKeysWithPrefix(local, PREFS_PREFIX)
  if (userId && !keepOutbox) {
    try {
      local?.removeItem(outboxKey(userId))
    } catch {
      // ignore
    }
    forgetOutboxMirror(userId)
  }
}
