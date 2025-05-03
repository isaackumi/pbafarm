// contexts/AuthContext.js
import React, { createContext, useState, useEffect, useContext } from 'react'
import { supabase } from '../lib/supabase'
import permissionService from '../lib/permissionService'
import companyService from '../lib/companyService'

// Create auth context
const AuthContext = createContext()

// Auth provider component
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [roles, setRoles] = useState([])
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
          await fetchUserDetails(session.user)
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
          await fetchUserDetails(session.user)
        } else if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
          setCompany(null)
          setPermissions([])
          setRoles([])
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

  // Fetch user profile, company, and permissions
  const fetchUserDetails = async (user) => {
    try {
      // Fetch user profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileError) throw profileError

      setProfile(profile)

      // Fetch company details
      if (profile.company_id) {
        const {
          data: company,
          error: companyError,
        } = await companyService.getCompanyDetails(profile.company_id)

        if (companyError) throw companyError

        setCompany(company)
      }

      // Fetch user roles and permissions
      const {
        data: permissionsData,
        error: permissionsError,
      } = await permissionService.getUserRolesAndPermissions(user.id)

      if (permissionsError) throw permissionsError

      setRoles(permissionsData.roles)
      setPermissions(permissionsData.permissionCodes)
    } catch (error) {
      console.error('Error fetching user details:', error)
    }
  }

  // Sign in with email and password
  const signInWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

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

    return { data, error }
  }

  // Sign out
  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  // Update user profile
  const updateProfile = async (profileData) => {
    try {
      // Update profile in database
      const { data, error } = await supabase
        .from('profiles')
        .update(profileData)
        .eq('id', user.id)
        .select()

      if (error) throw error

      // Update profile in state
      setProfile(data[0])

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating profile:', error)
      return { data: null, error }
    }
  }

  // Check if user has a specific permission
  const hasPermission = (permissionCode) => {
    return permissionService.hasPermission(permissions, permissionCode)
  }

  // Check if user has a specific role
  const hasRole = (roleName) => {
    return roles.some(
      (r) => r.role.name.toLowerCase() === roleName.toLowerCase(),
    )
  }

  // Check if user is an admin or super admin
  const isAdmin = () => {
    return hasRole('admin') || hasRole('super_admin')
  }

  const authValue = {
    user,
    profile,
    company,
    roles,
    permissions,
    loading,
    initialized,
    signInWithEmail,
    signInWithGoogle,
    signUpWithEmail,
    signOut,
    updateProfile,
    hasPermission,
    hasRole,
    isAdmin,
    refreshUserDetails: () => fetchUserDetails(user),
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
