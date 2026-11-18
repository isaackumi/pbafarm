import { describe, expect, it } from 'vitest'
import {
  LEGACY_LOOKUPS_KEY,
  readReferenceData,
  readReferenceList,
  referenceKey,
  saveReferenceData,
} from './referenceCache'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('reference data cache (MOBILE-003)', () => {
  it('keeps each user and site apart', () => {
    const s = memoryStorage()
    saveReferenceData('userA', 'loc1', { cages: [{ _id: 'c1' }] }, s, 1)
    expect(readReferenceList('userA', 'loc1', 'cages', s)).toEqual([{ _id: 'c1' }])
    expect(readReferenceList('userB', 'loc1', 'cages', s)).toBeNull()
    expect(readReferenceList('userA', 'loc2', 'cages', s)).toBeNull()
    expect(readReferenceList(null, 'loc1', 'cages', s)).toBeNull()
  })

  it('merges lists instead of replacing the whole entry', () => {
    const s = memoryStorage()
    saveReferenceData('u', null, { cages: [1], feedTypes: [2] }, s, 1)
    saveReferenceData('u', null, { cages: [3] }, s, 2)
    expect(readReferenceData('u', null, s)).toMatchObject({ cages: [3], feedTypes: [2], savedAt: 2 })
  })

  it("ignores an entry written under another user's key", () => {
    const s = memoryStorage({ [referenceKey('u', 'l')]: JSON.stringify({ userId: 'x', cages: [1] }) })
    expect(readReferenceData('u', 'l', s)).toBeNull()
  })

  it('drops the old unscoped cache and never reads it', () => {
    const s = memoryStorage({ [LEGACY_LOOKUPS_KEY]: '{"cages":[9]}' })
    expect(readReferenceList('u', null, 'cages', s)).toBeNull()
    saveReferenceData('u', null, { cages: [1] }, s)
    expect(s.getItem(LEGACY_LOOKUPS_KEY)).toBeNull()
  })

  it('survives corrupt JSON and blocked storage', () => {
    const s = memoryStorage({ [referenceKey('u', null)]: '{' })
    expect(readReferenceData('u', null, s)).toBeNull()
    const blocked = { getItem: () => null, setItem: () => { throw new Error('full') }, removeItem() {} }
    expect(saveReferenceData('u', null, { cages: [] }, blocked)).toBe(false)
  })
})
