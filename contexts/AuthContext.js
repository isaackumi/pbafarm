// contexts/AuthContext.js — Convex Auth bridge
import React, { createContext, useContext, useEffect, useMemo } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { api } from '../convex/_generated/api'
import { setConvexAuthToken } from '../lib/convexBridge'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn, signOut: convexSignOut } = useAuthActions()
  const authToken = useAuthToken()
  const convexUser = useQuery(api.users.current)

  useEffect(() => {
    setConvexAuthToken(authToken)
  }, [authToken])

  const user = useMemo(() => {
    if (!isAuthenticated || !convexUser) return null
    return {
      id: convexUser._id,
      email: convexUser.email,
      name: convexUser.name,
      role: convexUser.role || 'user',
      companyId: convexUser.companyId,
      // Compatibility with former Supabase user shape
      user_metadata: {
        full_name: convexUser.name,
        role: convexUser.role || 'user',
      },
    }
  }, [isAuthenticated, convexUser])

  const loading = isLoading || (isAuthenticated && convexUser === undefined)
  const initialized = !isLoading

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
      error: new Error('Google sign-in is not configured. Use email and password.'),
    }
  }

  const signOut = async () => {
    try {
      await convexSignOut()
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const updateUserMetadata = async () => {
    return {
      data: null,
      error: new Error('Profile updates will be available in a later migration unit.'),
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
    loading,
    initialized,
    isAuthenticated,
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
