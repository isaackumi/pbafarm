/**
 * Offline reference data (MOBILE-003): the cages, feed types and species a
 * field form needs to be filled in with no signal.
 *
 * Every successful online load saves the lists here; a form that cannot reach
 * the server reads the last copy. The cache is per user and per site
 * (`pbafarm:ref:<userId>:<locationId|all>`), so a second person signing in on
 * the same phone never sees the first person's farm, and sign-out removes
 * every copy (lib/deviceData.js).
 *
 * Storage is passed last (default `window.localStorage`) so it can be tested.
 */

export const REFERENCE_PREFIX = 'pbafarm:ref:'

/** The single global cache used before it was scoped per user. */
export const LEGACY_LOOKUPS_KEY = 'pbafarm:daily-entry:lookups'

const LISTS = ['cages', 'feedTypes', 'species']

function defaultStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function referenceKey(userId, locationId) {
  return `${REFERENCE_PREFIX}${userId}:${locationId || 'all'}`
}

/** The saved lists for this user and site, or null. */
export function readReferenceData(userId, locationId, storage = defaultStorage()) {
  if (!userId || !storage) return null
  try {
    const raw = storage.getItem(referenceKey(userId, locationId))
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || parsed.userId !== userId) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Merge `lists` ({ cages?, feedTypes?, species? }) into this user's cache.
 * Lists not given keep their saved value. Returns true when written.
 */
export function saveReferenceData(userId, locationId, lists, storage = defaultStorage(), now = Date.now()) {
  if (!userId || !storage || !lists) return false
  const current = readReferenceData(userId, locationId, storage) || {}
  const next = { ...current, userId, savedAt: now }
  for (const name of LISTS) {
    if (Array.isArray(lists[name])) next[name] = lists[name]
  }
  try {
    storage.setItem(referenceKey(userId, locationId), JSON.stringify(next))
    // The unscoped cache could belong to anyone: drop it once we have our own.
    storage.removeItem(LEGACY_LOOKUPS_KEY)
    return true
  } catch {
    return false
  }
}

/** One saved list (`cages`, `feedTypes`, `species`) or null when never saved. */
export function readReferenceList(userId, locationId, name, storage = defaultStorage()) {
  const data = readReferenceData(userId, locationId, storage)
  return Array.isArray(data?.[name]) ? data[name] : null
}
