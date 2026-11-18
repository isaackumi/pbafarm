/**
 * Browser side of per-user preferences (CUSTOM-007).
 *
 * The account copy lives in Convex (`userPreferences`). This module keeps a
 * per-user copy in localStorage (`pbafarm:prefs:<userId>`) so the first paint
 * and offline sessions use the person's choices, and reads the old
 * per-browser `userSettings` key once so it can be moved to the account.
 * Sign-out removes every cached copy (lib/deviceData.js).
 *
 * Storage is passed last (default `window.localStorage`) so it can be tested.
 */
import { cleanPreferences } from '../convex/lib/userPreferences'

export const PREFS_PREFIX = 'pbafarm:prefs:'
/** Where SettingsContext kept preferences per browser before CUSTOM-007. */
export const LEGACY_SETTINGS_KEY = 'userSettings'

function defaultStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function prefsKey(userId) {
  return `${PREFS_PREFIX}${userId}`
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** This user's cached preferences (cleaned), or null. */
export function readCachedPrefs(userId, storage = defaultStorage()) {
  if (!userId || !storage) return null
  const parsed = readJson(storage, prefsKey(userId))
  if (!parsed || typeof parsed !== 'object') return null
  return cleanPreferences(parsed)
}

export function writeCachedPrefs(userId, prefs, storage = defaultStorage()) {
  if (!userId || !storage) return false
  try {
    storage.setItem(prefsKey(userId), JSON.stringify(cleanPreferences(prefs)))
    return true
  } catch {
    return false
  }
}

/** The pre-CUSTOM-007 browser settings, or null when there are none. */
export function readLegacySettings(storage = defaultStorage()) {
  if (!storage) return null
  const parsed = readJson(storage, LEGACY_SETTINGS_KEY)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
}

export function removeLegacySettings(storage = defaultStorage()) {
  try {
    storage?.removeItem(LEGACY_SETTINGS_KEY)
  } catch {
    // storage blocked
  }
}
