// contexts/AuthContext.js — Convex Auth bridge
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useConvex, useConvexAuth, useQuery } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { api } from '../convex/_generated/api'
import {
  setConvexAuthToken,
  bindConvexReactClient,
} from '../lib/convexBridge'
import { clearLlmKeys } from '../lib/llmClient'
import {
  clearOutbox,
  flushOutbox,
  migrateLegacyOutbox,
  outboxCount,
} from '../lib/offlineOutbox'
import { clearDeviceData } from '../lib/deviceData'
import SignOutOutboxDialog from '../components/SignOutOutboxDialog'
import {
  CONNECT_TIMEOUT_MS,
  accessStateOf,
  decideOfflineSession,
  readCachedUser,
  userIdFromToken,
  writeCachedUser,
} from '../lib/offlineSession'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const convex = useConvex()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn, signOut: convexSignOut } = useAuthActions()
  const authToken = useAuthToken()
  const convexUser = useQuery(api.users.current)

  // Keep module token in sync during render so child effects (Layout fetch)
  // see auth before their useEffect runs.
  setConvexAuthToken(authToken)

  useEffect(() => {
    bindConvexReactClient(convex)
    return () => bindConvexReactClient(null)
  }, [convex])

  // Invites are no longer claimed automatically (SEC-003): a company-less user
  // asks to join from /register-company and a company admin approves.

  // Convex has answered for this session: the real result wins from here on.
  const authResolved =
    !isLoading && (!isAuthenticated || convexUser !== undefined)

  // Offline cold start (MOBILE-001): with no signal Convex never confirms the
  // stored token, so fall back to the last-known user saved on this device.
  const [online, setOnline] = useState(true)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const update = () => setOnline(navigator.onLine !== false)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (authResolved || !authToken) {
      setTimedOut(false)
      return undefined
    }
    const t = setTimeout(() => setTimedOut(true), CONNECT_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [authResolved, authToken])

  const offlineUser = useMemo(() => {
    if (authResolved || typeof window === 'undefined') return null
    let storage = null
    try {
      storage = window.localStorage
    } catch {
      return null
    }
    return decideOfflineSession({
      authResolved,
      online,
      timedOut,
      token: authToken,
      cachedUser: readCachedUser(storage, userIdFromToken(authToken)),
    })
  }, [authResolved, online, timedOut, authToken])

  /** True while the shell runs from the cached user because Convex is unreachable. */
  const offlineMode = Boolean(offlineUser)

  // Remember the last-known user for the next offline start (minimal fields,
  // no secrets). Inactive/unapproved accounts are removed instead.
  useEffect(() => {
    if (!isAuthenticated || !convexUser || typeof window === 'undefined') return
    try {
      writeCachedUser(window.localStorage, convexUser, Date.now(), authToken)
    } catch {
      // storage blocked
    }
  }, [isAuthenticated, convexUser, authToken])

  const sourceUser = offlineMode
    ? offlineUser
    : isAuthenticated
      ? convexUser
      : null

  /**
   * What this account may do right now, mirroring requireUser on the server:
   * 'ok' | 'USER_INACTIVE' | 'COMPANY_NOT_APPROVED' (both sign out)
   * | 'PASSWORD_CHANGE_REQUIRED' (only /account) | 'MFA_REQUIRED' (only /verify)
   * | 'NO_COMPANY' (only /register-company)
   */
  const accessState = useMemo(() => accessStateOf(sourceUser), [sourceUser])

  const user = useMemo(() => {
    if (!sourceUser) return null
    return {
      id: sourceUser._id,
      _id: sourceUser._id,
      email: sourceUser.email,
      name: sourceUser.name,
      role: sourceUser.role || 'user',
      companyId: sourceUser.companyId,
      mustChangePassword: sourceUser.mustChangePassword === true,
      active: sourceUser.active !== false,
      companyStatus: sourceUser.companyStatus ?? null,
      accessState,
      activeLocationId: sourceUser.activeLocationId,
      locationIds: sourceUser.locationIds,
      // Two-step verification (SEC-007)
      mfaRequired: sourceUser.mfaRequired === true,
      mfaChannels: sourceUser.mfaChannels || [],
      mfaDefaultChannel: sourceUser.mfaDefaultChannel || null,
      hasPhone: sourceUser.hasPhone === true,
      maskedPhone: sourceUser.maskedPhone || null,
      mfaTotp: sourceUser.mfaTotp === true,
      // Support access (ENT-006): role/companyId above are the acted-as ones.
      realRole: sourceUser.realRole || sourceUser.role || 'user',
      actingAs: sourceUser.actingAs ?? null,
      offline: offlineMode,
      // Compatibility with former Supabase user shape
      user_metadata: {
        full_name: sourceUser.name,
        role: sourceUser.role || 'user',
      },
    }
  }, [sourceUser, accessState, offlineMode])

  /** True when tenant data may be loaded (providers skip their queries otherwise). */
  const canUseApp = accessState === 'ok'

  // Entries queued before the outbox was scoped per user move to the user
  // signed in now; items stamped with another owner stay where they are.
  const userId = user?.id
  useEffect(() => {
    if (!userId || !canUseApp) return
    migrateLegacyOutbox(userId)
  }, [userId, canUseApp])

  const loading = offlineMode
    ? false
    : isLoading || (isAuthenticated && convexUser === undefined)
  const initialized = offlineMode || !isLoading

  const signInWithEmail = async (email, password, humanTicket) => {
    try {
      const formData = new FormData()
      formData.set('email', email)
      formData.set('password', password)
      formData.set('flow', 'signIn')
      if (humanTicket) formData.set('humanTicket', humanTicket)
      await signIn('password', formData)
      return { data: { user: true }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  }

  const signUpWithEmail = async (email, password, fullName, humanTicket) => {
    try {
      const formData = new FormData()
      formData.set('email', email)
      formData.set('password', password)
      formData.set('flow', 'signUp')
      if (fullName) formData.set('name', fullName)
      if (humanTicket) formData.set('humanTicket', humanTicket)
      await signIn('password', formData)
      return { data: { user: true }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  }

  /**
   * Phone sign-in (SEC-006). `send` always resolves the same way whether or
   * not the number is registered; `verify` resolves { signedIn }.
   */
  const sendPhoneCode = async (phone) => {
    try {
      await signIn('phone-otp', { flow: 'send', phone })
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const verifyPhoneCode = async (phone, code) => {
    try {
      const result = await signIn('phone-otp', { flow: 'verify', phone, code })
      return { signedIn: result?.signingIn === true, error: null }
    } catch (error) {
      return { signedIn: false, error }
    }
  }

  const signInWithGoogle = async () => {
    return {
      data: null,
      error: new Error(
        'Google sign-in is not configured. Use email and password.',
      ),
    }
  }

  // Sign-out on a shared phone (MOBILE-001): unsent entries are sent or
  // discarded on purpose, then the device forgets this user's data.
  const [outboxPrompt, setOutboxPrompt] = useState(null)
  const promptResolve = useRef(null)

  const askOutbox = useCallback(
    (count, note = '') =>
      new Promise((resolve) => {
        promptResolve.current = resolve
        setOutboxPrompt({ count, note, sending: false })
      }),
    [],
  )

  const answerOutbox = useCallback((choice) => {
    const resolve = promptResolve.current
    promptResolve.current = null
    if (choice === 'send') {
      setOutboxPrompt((p) => (p ? { ...p, sending: true } : p))
    } else {
      setOutboxPrompt(null)
    }
    resolve?.(choice)
  }, [])

  /**
   * @param {{ force?: boolean }} [options] force: the server ended the session
   *   (inactive account, company not approved). No prompt; this user's queued
   *   entries are kept (scoped to them, never sent by anyone else).
   * @returns {Promise<{ error: any, cancelled?: boolean }>}
   */
  const signOut = async ({ force = false } = {}) => {
    const userId = user?.id
    if (!force && userId) {
      let pending = outboxCount(userId)
      let note = ''
      while (pending > 0) {
        const choice = await askOutbox(pending, note)
        if (choice === 'cancel') return { error: null, cancelled: true }
        if (choice === 'discard') {
          clearOutbox(userId)
          break
        }
        // Lazy: keep the service layer out of the first-load bundle.
        const { sendOutboxItem } = await import('../lib/outboxSenders')
        const { sent, failed } = await flushOutbox(sendOutboxItem, userId)
        pending = outboxCount(userId)
        if (pending > 0) {
          note =
            failed > 0
              ? `${pending} could not be sent. Open Outbox to see why, or discard them.`
              : sent > 0
                ? `${sent} sent. ${pending} still waiting; the connection dropped.`
                : 'Could not reach the server. Try again when you have signal.'
        }
      }
      setOutboxPrompt(null)
    }
    // Pasted assistant keys live in plaintext localStorage: drop them first,
    // even if the network sign-out below fails.
    clearLlmKeys()
    if (typeof window !== 'undefined') {
      try {
        clearDeviceData({
          local: window.localStorage,
          session: window.sessionStorage,
          userId,
          keepOutbox: force,
        })
      } catch {
        // storage blocked
      }
    }
    try {
      await convexSignOut()
      setConvexAuthToken(null)
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const updateUserMetadata = async () => {
    return {
      data: null,
      error: new Error(
        'Profile updates will be available in a later migration unit.',
      ),
    }
  }

  const getUserRole = () => user?.role || 'user'

  const hasRole = (role) => {
    const userRole = getUserRole()
    if (userRole === 'super_admin') return true
    if (userRole === 'admin' && role !== 'super_admin') return true
    return userRole === role
  }

  const authValue = {
    user,
    accessState,
    canUseApp,
    loading,
    initialized,
    isAuthenticated,
    offlineMode,
    signInWithEmail,
    signInWithGoogle,
    sendPhoneCode,
    verifyPhoneCode,
    signUpWithEmail,
    signOut,
    updateUserMetadata,
    getUserRole,
    hasRole,
    profile: user,
    refreshUserDetails: async () => user,
  }

  return (
    <AuthContext.Provider value={authValue}>
      {children}
      {outboxPrompt && (
        <SignOutOutboxDialog
          count={outboxPrompt.count}
          note={outboxPrompt.note}
          sending={outboxPrompt.sending}
          onSend={() => answerOutbox('send')}
          onDiscard={() => answerOutbox('discard')}
          onCancel={() => answerOutbox('cancel')}
        />
      )}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
