import { describe, expect, it } from 'vitest'
import { clearDeviceData } from './deviceData'
import { LEGACY_OUTBOX_KEY, outboxKey } from './offlineOutbox'
import { cachedUserKey } from './offlineSession'
import { referenceKey } from './referenceCache'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    keys: () => [...map.keys()].sort(),
  }
}

function deviceWithTwoUsers() {
  const local = memoryStorage({
    'persist:root': '{}',
    'pbafarm:daily-entry:lookups': '{}',
    [referenceKey('userA', 'loc1')]: '{}',
    [referenceKey('userB', null)]: '{}',
    pba_active_location_id: 'loc1',
    'pbafarm:form:daily-entry-batch': '{}',
    [cachedUserKey('userA')]: '{}',
    [cachedUserKey('userB')]: '{}',
    [outboxKey('userA')]: '[{"id":"1"}]',
    [outboxKey('userB')]: '[{"id":"2"}]',
    [LEGACY_OUTBOX_KEY]: '[{"id":"3","createdBy":"userB"}]',
    theme: 'dark',
    __convexAuthJWT_x: 'token',
  })
  const session = memoryStorage({ 'pbafarm:form:stocking': '{}', other: '1' })
  return { local, session }
}

describe('clearDeviceData (sign-out)', () => {
  it("removes the user's data, drafts, lookups and cached users", () => {
    const { local, session } = deviceWithTwoUsers()
    clearDeviceData({ local, session, userId: 'userA' })
    expect(local.keys()).toEqual(
      [
        '__convexAuthJWT_x', // Convex Auth removes its own token
        LEGACY_OUTBOX_KEY, // another owner's items: never adopted, never sent
        outboxKey('userB'),
        'theme',
      ].sort(),
    )
    expect(session.keys()).toEqual(['other'])
  })

  it("keeps the user's outbox on a forced sign-out", () => {
    const { local, session } = deviceWithTwoUsers()
    clearDeviceData({ local, session, userId: 'userA', keepOutbox: true })
    expect(local.getItem(outboxKey('userA'))).not.toBeNull()
    expect(local.getItem(cachedUserKey('userA'))).toBeNull()
    expect(local.getItem('persist:root')).toBeNull()
  })
})
