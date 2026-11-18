import { describe, expect, it } from 'vitest'
import {
  LEGACY_SETTINGS_KEY,
  prefsKey,
  readCachedPrefs,
  readLegacySettings,
  removeLegacySettings,
  writeCachedPrefs,
} from './userPreferences'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('cached preferences (CUSTOM-007)', () => {
  it('round-trips per user and drops invalid fields', () => {
    const storage = memoryStorage()
    writeCachedPrefs('u1', { dateFormat: 'YYYY-MM-DD', mobileShortcuts: ['/cages'], junk: 1 }, storage)
    expect(readCachedPrefs('u1', storage)).toEqual({ dateFormat: 'YYYY-MM-DD', mobileShortcuts: ['/cages'] })
    expect(readCachedPrefs('u2', storage)).toBeNull()
  })

  it('ignores a corrupt cache', () => {
    const storage = memoryStorage({ [prefsKey('u1')]: '{not json' })
    expect(readCachedPrefs('u1', storage)).toBeNull()
  })

  it('reads and removes the old per-browser settings', () => {
    const storage = memoryStorage({ [LEGACY_SETTINGS_KEY]: '{"dateFormat":"MM/DD/YYYY"}' })
    expect(readLegacySettings(storage)).toEqual({ dateFormat: 'MM/DD/YYYY' })
    removeLegacySettings(storage)
    expect(readLegacySettings(storage)).toBeNull()
    expect(readLegacySettings(memoryStorage({ [LEGACY_SETTINGS_KEY]: '[1]' }))).toBeNull()
  })
})
