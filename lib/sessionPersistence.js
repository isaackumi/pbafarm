/**
 * "Keep me signed in for 30 days" (Paper 15). Convex Auth keeps a session
 * for AUTH_SESSION_TOTAL_DURATION_MS (30 days by default) in localStorage.
 * Unticked, the session is for this browser session only: a flag in
 * localStorage says so, and a marker in sessionStorage (cleared when the
 * browser closes) says this browser session started it. On the next start
 * without the marker, the app signs out (contexts/AuthContext).
 *
 * Storage can be unavailable (private windows, blocked site data): every
 * access is guarded, and without storage the session simply persists.
 */
const ONLY_KEY = 'anowa.sessionOnly'
const ALIVE_KEY = 'anowa.sessionAlive'

function store(kind) {
  try {
    return typeof window === 'undefined' ? null : window[kind]
  } catch {
    return null
  }
}

/** Call right before (or after) a sign-in: `keep` = the checkbox. */
export function setKeepSignedIn(keep) {
  const local = store('localStorage')
  const session = store('sessionStorage')
  try {
    if (keep) {
      local?.removeItem(ONLY_KEY)
      session?.removeItem(ALIVE_KEY)
    } else {
      local?.setItem(ONLY_KEY, '1')
      session?.setItem(ALIVE_KEY, '1')
    }
  } catch {
    // Storage full or blocked: the session persists, as when ticked.
  }
}

/** True when the session was meant to end with the browser and the browser was closed since. */
export function sessionExpiredWithBrowser() {
  try {
    const local = store('localStorage')
    const session = store('sessionStorage')
    if (!local || !session) return false
    return local.getItem(ONLY_KEY) === '1' && session.getItem(ALIVE_KEY) !== '1'
  } catch {
    return false
  }
}

/** After that sign-out: forget the flag so the next sign-in starts clean. */
export function clearSessionPersistence() {
  try {
    store('localStorage')?.removeItem(ONLY_KEY)
    store('sessionStorage')?.removeItem(ALIVE_KEY)
  } catch {
    // ignore
  }
}
