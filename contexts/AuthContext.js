// contexts/AuthContext.js
import React, { createContext, useState, useEffect, useContext } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/router'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // Check for active session - updated for Supabase v2
    const checkSession = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        setSession(data.session)
        setUser(data.session?.user ?? null)

        // Set up auth state change listener - updated for Supabase v2
        const { data: authListener } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            setSession(session)
            setUser(session?.user ?? null)
          },
        )

        setLoading(false)
        return () => {
          authListener?.subscription.unsubscribe()
        }
      } catch (error) {
        console.error('Error checking session:', error)
        setLoading(false)
      }
    }

    checkSession()
  }, [])

  // Sign in with Google - updated for Supabase v2
  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      })
      if (error) throw error
    } catch (error) {
      console.error('Error signing in with Google:', error.message)
      return { error }
    }
  }

  // Sign in with email and password - updated for Supabase v2
  const signInWithEmail = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error
      return { user: data.user }
    } catch (error) {
      console.error('Error signing in with email:', error.message)
      return { error }
    }
  }

  // Sign up with email and password - updated for Supabase v2
  const signUpWithEmail = async (email, password, fullName) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      })
      if (error) throw error
      return { user: data.user }
    } catch (error) {
      console.error('Error signing up with email:', error.message)
      return { error }
    }
  }

  // Sign out - updated for Supabase v2
  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.push('/login')
    } catch (error) {
      console.error('Error signing out:', error.message)
      return { error }
    }
  }

  // Get user profile
  const getUserProfile = async () => {
    try {
      if (!user) return null

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error) throw error
      return data
    } catch (error) {
      console.error('Error fetching user profile:', error.message)
      return null
    }
  }

  const value = {
    user,
    session,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    getUserProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
