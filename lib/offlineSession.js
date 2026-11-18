/**
 * Offline cold start: the last-known user, cached per user id on this device.
 *
 * Online, AuthContext saves a minimal snapshot of `users.current` (no tokens,
 * no secrets) after every successful load. When the phone opens the app with
 * no signal, Convex cannot confirm the session, so `useConvexAuth` and
 * `users.current` never resolve. If a Convex Auth token is stored and the
 * snapshot for that token's user exists, the app shell renders from the
 * snapshot instead of waiting forever. The server still authenticates and
 * authorizes every queued write when it is sent.
 *
 * Pure helpers; storage is passed in so they can be tested.
 */

export const CACHED_USER_PREFIX = 'pbafarm:user:'

/** How long Convex may take to confirm the session before we go offline. */
export const CONNECT_TIMEOUT_MS = 4000

/** A snapshot older than this is not trusted for offline start. */
export const OFFLINE_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export function cachedUserKey(userId) {
  return `${CACHED_USER_PREFIX}${userId}`
}

/**
 * What this account may do right now, mirroring requireUser on the server:
 * 'ok' | 'USER_INACTIVE' | 'COMPANY_NOT_APPROVED' (both sign out)
 * | 'PASSWORD_CHANGE_REQUIRED' (only /account) | 'MFA_REQUIRED' (only /verify)
 * | 'NO_COMPANY' (only /register-company)
 */
export function accessStateOf(u) {
  if (!u) return null
  const role = u.role || 'user'
  if (u.active === false) return 'USER_INACTIVE'
  if (role !== 'super_admin' && u.companyId && u.companyStatus !== 'approved') {
    return 'COMPANY_NOT_APPROVED'
  }
  if (u.mustChangePassword === true) return 'PASSWORD_CHANGE_REQUIRED'
  if (u.mfaRequired === true) return 'MFA_REQUIRED'
  if (role !== 'super_admin' && !u.companyId) return 'NO_COMPANY'
  return 'ok'
}

function base64UrlDecode(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return atob(padded)
}

function subjectParts(token) {
  if (typeof token !== 'string') return []
  const parts = token.split('.')
  if (parts.length < 2) return []
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    const sub = typeof payload?.sub === 'string' ? payload.sub : ''
    return sub.split('|')
  } catch {
    return []
  }
}

/**
 * The user id inside a Convex Auth JWT (`sub` is "<userId>|<sessionId>").
 * Decoded only to pick which snapshot to read; never trusted for access,
 * the server verifies the token on every call.
 */
export function userIdFromToken(token) {
  return subjectParts(token)[0] || null
}

/** The sign-in session id inside a Convex Auth JWT (same caveats). */
export function sessionIdFromToken(token) {
  return subjectParts(token)[1] || null
}

/**
 * Minimal fields needed to render the shell and route by role. When the
 * company requires two-step verification, the snapshot also records which
 * session verified it (SEC-007): only that session may start offline.
 */
export function snapshotUser(convexUser, now = Date.now(), token = null) {
  if (!convexUser?._id) return null
  const mfaPolicy = convexUser.mfaPolicy === true
  return {
    _id: convexUser._id,
    email: convexUser.email ?? null,
    name: convexUser.name ?? null,
    role: convexUser.role || 'user',
    companyId: convexUser.companyId ?? null,
    companyStatus: convexUser.companyStatus ?? null,
    active: convexUser.active !== false,
    mustChangePassword: convexUser.mustChangePassword === true,
    activeLocationId: convexUser.activeLocationId ?? null,
    locationIds: Array.isArray(convexUser.locationIds) ? convexUser.locationIds : [],
    mfaPolicy,
    mfaRequired: convexUser.mfaRequired === true,
    verifiedSessionId: mfaPolicy && convexUser.mfaRequired !== true ? sessionIdFromToken(token) : null,
    savedAt: now,
  }
}

export function readCachedUser(storage, userId) {
  if (!storage || !userId) return null
  try {
    const raw = storage.getItem(cachedUserKey(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && parsed._id === userId ? parsed : null
  } catch {
    return null
  }
}

/**
 * Save the snapshot after a successful online load. An account the server
 * would sign out (inactive, company not approved), or a session that has not
 * passed two-step verification, is removed instead, so it can never start
 * offline.
 */
export function writeCachedUser(storage, convexUser, now = Date.now(), token = null) {
  if (!storage || !convexUser?._id) return
  try {
    const state = accessStateOf(convexUser)
    if (state === 'USER_INACTIVE' || state === 'COMPANY_NOT_APPROVED' || state === 'MFA_REQUIRED') {
      storage.removeItem(cachedUserKey(convexUser._id))
      return
    }
    const snap = snapshotUser(convexUser, now, token)
    storage.setItem(cachedUserKey(convexUser._id), JSON.stringify(snap))
  } catch {
    // storage full or blocked: offline start just will not be available
  }
}

/**
 * Should the app render from the cached snapshot instead of waiting for Convex?
 *
 * Returns the snapshot to use, or null. All must hold:
 * - Convex has not confirmed the session yet (`authResolved` false); once it
 *   answers, the real result always wins;
 * - the browser reports offline, or Convex has not connected within
 *   CONNECT_TIMEOUT_MS (`timedOut`);
 * - a Convex Auth token is stored (someone signed in on this device and did
 *   not sign out) and a snapshot exists for that token's user;
 * - the snapshot is fresh and its access state is 'ok' (never inactive,
 *   unapproved, temporary-password, unverified or company-less);
 * - if the company requires two-step verification, the stored token is the
 *   very session that was verified online.
 */
export function decideOfflineSession({
  authResolved,
  online,
  timedOut,
  token,
  cachedUser,
  now = Date.now(),
  maxAgeMs = OFFLINE_SESSION_MAX_AGE_MS,
}) {
  if (authResolved) return null
  if (online !== false && !timedOut) return null
  const tokenUserId = userIdFromToken(token)
  if (!tokenUserId) return null
  if (!cachedUser || cachedUser._id !== tokenUserId) return null
  const savedAt = Number(cachedUser.savedAt)
  if (!Number.isFinite(savedAt) || now - savedAt > maxAgeMs || savedAt > now + 60_000) {
    return null
  }
  if (accessStateOf(cachedUser) !== 'ok') return null
  if (cachedUser.mfaPolicy === true) {
    const sessionId = sessionIdFromToken(token)
    if (!sessionId || cachedUser.verifiedSessionId !== sessionId) return null
  }
  return cachedUser
}

/** Forget every cached last-known user on this device (sign-out). */
export function removeCachedUsers(storage) {
  if (!storage) return
  try {
    const keys = []
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i)
      if (k && k.startsWith(CACHED_USER_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => storage.removeItem(k))
  } catch {
    // ignore
  }
}
