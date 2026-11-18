// contexts/AuthContext.js — Convex Auth bridge
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useConvex, useConvexAuth, useQuery } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { api } from '../convex/_generated/api'
import {
  setConvexAuthToken,
  bindConvexReactClient,
} from '../lib/convexBridge'
import { clearLlmKeys } from '../lib/llmClient'
import { migrateLegacyOutbox } from '../lib/offlineOutbox'
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
      writeCachedUser(window.localStorage, convexUser)
    } catch {
      // storage blocked
    }
  }, [isAuthenticated, convexUser])

  const sourceUser = offlineMode
    ? offlineUser
    : isAuthenticated
      ? convexUser
      : null

  /**
   * What this account may do right now, mirroring requireUser on the server:
   * 'ok' | 'USER_INACTIVE' | 'COMPANY_NOT_APPROVED' (both sign out)
   * | 'PASSWORD_CHANGE_REQUIRED' (only /account) | 'NO_COMPANY' (only /register-company)
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

  const signInWithEmail = async (email, password) => {
    try {
      const formData = new FormData()
      formData.set('email', email)
      formData.set('password', password)
      formData.set('flow', 'signIn')
      await signIn('password', formData)
      return { data: { user: true }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  }

  const signUpWithEmail = async (email, password, fullName) => {
    try {
      const formData = new FormData()
      formData.set('email', email)
      formData.set('password', password)
      formData.set('flow', 'signUp')
      if (fullName) formData.set('name', fullName)
      await signIn('password', formData)
      return { data: { user: true }, error: null }
    } catch (error) {
      return { data: null, error }
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

  const signOut = async () => {
    // Pasted assistant keys live in plaintext localStorage: drop them first,
    // even if the network sign-out below fails.
    clearLlmKeys()
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
    signUpWithEmail,
    signOut,
    updateUserMetadata,
    getUserRole,
    hasRole,
    profile: user,
    refreshUserDetails: async () => user,
  }

  return (
    <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
