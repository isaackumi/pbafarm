import { describe, expect, it } from 'vitest'
import {
  OFFLINE_SESSION_MAX_AGE_MS,
  accessStateOf,
  cachedUserKey,
  decideOfflineSession,
  readCachedUser,
  removeCachedUsers,
  snapshotUser,
  userIdFromToken,
  writeCachedUser,
} from './offlineSession'

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
    keys: () => [...map.keys()],
  }
}

function b64url(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function tokenFor(userId) {
  return `${b64url({ alg: 'RS256' })}.${b64url({ sub: `${userId}|session1`, exp: 1 })}.sig`
}

const NOW = 1_800_000_000_000

function convexUser(overrides = {}) {
  return {
    _id: 'userA',
    email: 'a@example.com',
    name: 'Ama',
    role: 'user',
    companyId: 'company1',
    companyStatus: 'approved',
    active: true,
    mustChangePassword: false,
    activeLocationId: 'loc1',
    locationIds: ['loc1'],
    ...overrides,
  }
}

function cached(overrides = {}) {
  return { ...snapshotUser(convexUser(), NOW - 1000), ...overrides }
}

const offlineArgs = (overrides = {}) => ({
  authResolved: false,
  online: false,
  timedOut: false,
  token: tokenFor('userA'),
  cachedUser: cached(),
  now: NOW,
  ...overrides,
})

describe('userIdFromToken', () => {
  it('reads the user id from a Convex Auth JWT subject', () => {
    expect(userIdFromToken(tokenFor('k57abc'))).toBe('k57abc')
  })

  it('returns null for missing or malformed tokens', () => {
    expect(userIdFromToken(null)).toBeNull()
    expect(userIdFromToken('not-a-jwt')).toBeNull()
    expect(userIdFromToken('a.%%%.c')).toBeNull()
  })
})

describe('decideOfflineSession', () => {
  it('uses the cached user when offline with a stored token for that user', () => {
    expect(decideOfflineSession(offlineArgs())?._id).toBe('userA')
  })

  it('uses the cached user when online but Convex did not connect in time', () => {
    expect(decideOfflineSession(offlineArgs({ online: true, timedOut: true }))?._id).toBe('userA')
  })

  it('waits for Convex while online and before the timeout', () => {
    expect(decideOfflineSession(offlineArgs({ online: true, timedOut: false }))).toBeNull()
  })

  it('lets the real result win once Convex has answered', () => {
    expect(decideOfflineSession(offlineArgs({ authResolved: true }))).toBeNull()
  })

  it('never grants access without a stored token (never signed in / signed out)', () => {
    expect(decideOfflineSession(offlineArgs({ token: null }))).toBeNull()
  })

  it('never grants access without a cached user for this device', () => {
    expect(decideOfflineSession(offlineArgs({ cachedUser: null }))).toBeNull()
  })

  it("never uses another user's snapshot for this token", () => {
    expect(decideOfflineSession(offlineArgs({ token: tokenFor('userB') }))).toBeNull()
  })

  it('refuses an inactive or unapproved cached user (SEC-001)', () => {
    expect(decideOfflineSession(offlineArgs({ cachedUser: cached({ active: false }) }))).toBeNull()
    expect(
      decideOfflineSession(offlineArgs({ cachedUser: cached({ companyStatus: 'pending' }) })),
    ).toBeNull()
    expect(
      decideOfflineSession(offlineArgs({ cachedUser: cached({ mustChangePassword: true }) })),
    ).toBeNull()
    expect(decideOfflineSession(offlineArgs({ cachedUser: cached({ companyId: null }) }))).toBeNull()
  })

  it('refuses a stale snapshot', () => {
    const old = cached({ savedAt: NOW - OFFLINE_SESSION_MAX_AGE_MS - 1 })
    expect(decideOfflineSession(offlineArgs({ cachedUser: old }))).toBeNull()
    expect(decideOfflineSession(offlineArgs({ cachedUser: cached({ savedAt: undefined }) }))).toBeNull()
  })
})

describe('cached last-known user', () => {
  it('stores minimal fields per user id and reads them back', () => {
    const s = memoryStorage()
    writeCachedUser(s, { ...convexUser(), password: 'x', tokenIdentifier: 'y' }, NOW)
    expect(s.keys()).toEqual([cachedUserKey('userA')])
    const back = readCachedUser(s, 'userA')
    expect(back).toMatchObject({ _id: 'userA', role: 'user', companyStatus: 'approved', savedAt: NOW })
    expect(back).not.toHaveProperty('password')
    expect(back).not.toHaveProperty('tokenIdentifier')
    expect(readCachedUser(s, 'userB')).toBeNull()
  })

  it('removes the snapshot when the server says the account must sign out', () => {
    const s = memoryStorage()
    writeCachedUser(s, convexUser(), NOW)
    writeCachedUser(s, convexUser({ active: false }), NOW)
    expect(readCachedUser(s, 'userA')).toBeNull()
    writeCachedUser(s, convexUser(), NOW)
    writeCachedUser(s, convexUser({ companyStatus: 'suspended' }), NOW)
    expect(readCachedUser(s, 'userA')).toBeNull()
  })

  it('removeCachedUsers clears every snapshot and nothing else', () => {
    const s = memoryStorage({ other: '1' })
    writeCachedUser(s, convexUser(), NOW)
    writeCachedUser(s, convexUser({ _id: 'userB' }), NOW)
    removeCachedUsers(s)
    expect(s.keys()).toEqual(['other'])
  })
})

describe('accessStateOf', () => {
  it('matches the server guard order', () => {
    expect(accessStateOf(null)).toBeNull()
    expect(accessStateOf(convexUser())).toBe('ok')
    expect(accessStateOf(convexUser({ active: false }))).toBe('USER_INACTIVE')
    expect(accessStateOf(convexUser({ companyStatus: 'pending' }))).toBe('COMPANY_NOT_APPROVED')
    expect(accessStateOf(convexUser({ mustChangePassword: true }))).toBe('PASSWORD_CHANGE_REQUIRED')
    expect(accessStateOf(convexUser({ companyId: null }))).toBe('NO_COMPANY')
    expect(accessStateOf(convexUser({ role: 'super_admin', companyId: null }))).toBe('ok')
  })
})
