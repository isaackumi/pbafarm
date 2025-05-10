// pages/_app.js - Update to include company registration flow

import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { ToastProvider } from '../hooks/useToast'
import '../styles/globals.css'
import { supabase } from '../lib/supabase'

// This HOC (Higher-Order Component) wraps the entire app
function AppWrapper({ Component, pageProps }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <CompanyRegistrationFlow>
          <Component {...pageProps} />
        </CompanyRegistrationFlow>
      </ToastProvider>
    </AuthProvider>
  )
}

// This component handles company registration flow redirects
function CompanyRegistrationFlow({ children }) {
  const { user, profile, initialized, loading } = useAuth()
  const router = useRouter()
  const [checkingRegistration, setCheckingRegistration] = useState(true)
  const [registrationStatus, setRegistrationStatus] = useState(null)

  // Public routes that don't require authentication or company
  const publicRoutes = ['/login', '/signup', '/reset-password', '/verify-email']

  // Routes that require authentication but not company
  const authRoutes = ['/register-company', '/pending-approval']

  const currentPath = router.pathname

  // Check registration status when auth state is initialized and user is authenticated
  useEffect(() => {
    const checkRegistrationStatus = async () => {
      if (!initialized || loading) return

      if (!user) {
        // Not logged in, check if on a protected route
        if (!publicRoutes.includes(currentPath)) {
          router.push('/login')
        }
        setCheckingRegistration(false)
        return
      }

      try {
        // User is logged in

        // Check if user has a company already
        if (profile && profile.company_id) {
          setRegistrationStatus('approved')
          setCheckingRegistration(false)

          // If on company registration flow pages, redirect to dashboard
          if (authRoutes.includes(currentPath)) {
            router.push('/dashboard')
          }
          return
        }

        // No company assigned, check registration status
        const { data, error } = await supabase.rpc(
          'get_user_registration_status',
          {
            user_id: user.id,
          },
        )

        if (error) throw error

        if (data) {
          setRegistrationStatus(data.status)

          // Handle redirects based on status
          if (data.status === 'pending') {
            // If pending and not on pending page, redirect
            if (
              currentPath !== '/pending-approval' &&
              !publicRoutes.includes(currentPath)
            ) {
              router.push('/pending-approval')
            }
          } else if (data.status === 'rejected') {
            // If rejected, let them re-register
            if (
              currentPath !== '/register-company' &&
              !publicRoutes.includes(currentPath)
            ) {
              router.push('/register-company')
            }
          }
        } else {
          // No registration found, they need to register
          setRegistrationStatus('none')

          // If not on registration page or public page, redirect
          if (
            currentPath !== '/register-company' &&
            !publicRoutes.includes(currentPath)
          ) {
            router.push('/register-company')
          }
        }
      } catch (error) {
        console.error('Error checking registration status:', error)
      } finally {
        setCheckingRegistration(false)
      }
    }

    checkRegistrationStatus()
  }, [user, profile, initialized, loading, currentPath, router])

  // Loading state
  if (loading || checkingRegistration) {
    // Show loading indicator only for protected routes
    if (!publicRoutes.includes(currentPath)) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      )
    }
  }

  // Render children for public routes or if company flow is satisfied
  return children
}

export default AppWrapper
