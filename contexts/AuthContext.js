// contexts/AuthContext.js
import React, { createContext, useState, useEffect, useContext } from 'react'
import { supabase } from '../lib/supabase'

// Create auth context
const AuthContext = createContext()

// Auth provider component
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)

  // Initialize auth state
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Get current session
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (error) {
          console.error('Error getting session:', error)
          setLoading(false)
          return
        }

        // Set user if session exists
        if (session?.user) {
          setUser(session.user)
        }
      } catch (error) {
        console.error('Error initializing auth:', error)
      } finally {
        setLoading(false)
        setInitialized(true)
      }
    }

    // Initialize auth state
    initializeAuth()

    // Subscribe to auth changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event)

        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user)
        } else if (event === 'SIGNED_OUT') {
          setUser(null)
        } else if (event === 'USER_UPDATED' && session?.user) {
          setUser(session.user)
        }

        setLoading(false)
      },
    )

    // Cleanup subscription
    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  // Sign in with email and password
  const signInWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (!error) {
      // Redirect to dashboard after successful login
      window.location.href = '/dashboard'
    }

    return { data, error }
  }

  // Sign in with Google
  const signInWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    })

    return { data, error }
  }

  // Sign up with email and password
  const signUpWithEmail = async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })

    if (!error) {
      // Redirect to dashboard after successful signup
      window.location.href = '/dashboard'
    }

    return { data, error }
  }

  // Sign out
  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  // Update user metadata
  const updateUserMetadata = async (metadata) => {
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: metadata,
      })

      if (error) throw error

      // Update user in state
      if (data && data.user) {
        setUser(data.user)
        return { data: data.user, error: null }
      }

      return {
        data: null,
        error: new Error('No user data returned after update'),
      }
    } catch (error) {
      console.error('Error updating user metadata:', error)
      return { data: null, error }
    }
  }

  // Get user role
  const getUserRole = () => {
    return user?.user_metadata?.role || 'user'
  }

  // Check if user has a specific role
  const hasRole = (role) => {
    const userRole = getUserRole()

    // Admin roles should include access to lesser roles
    if (userRole === 'super_admin') return true
    if (userRole === 'admin' && role !== 'super_admin') return true

    return userRole === role
  }

  const authValue = {
    user,
    loading,
    initialized,
    signInWithEmail,
    signInWithGoogle,
    signUpWithEmail,
    signOut,
    updateUserMetadata,
    getUserRole,
    hasRole,
    // For compatibility with code expecting a profile
    profile: user,
    refreshUserDetails: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) setUser(user)
      return user
    },
  }

  return (
    <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
  )
}

// Custom hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
