// pages/_app.js - Simplified without company registration flow

import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { ToastProvider } from '../hooks/useToast'
import '../styles/globals.css'

// This HOC (Higher-Order Component) wraps the entire app
function AppWrapper({ Component, pageProps }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <AuthWrapper>
          <Component {...pageProps} />
        </AuthWrapper>
      </ToastProvider>
    </AuthProvider>
  )
}

// This component handles authentication redirects
function AuthWrapper({ children }) {
  const { user, initialized, loading } = useAuth()
  const router = useRouter()

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/signup', '/reset-password', '/verify-email']

  const currentPath = router.pathname

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!initialized || loading) return

    // If not logged in and trying to access protected route, redirect to login
    if (!user && !publicRoutes.includes(currentPath)) {
      router.push('/login')
    }

    // If logged in and trying to access login/signup pages, redirect to dashboard
    if (user && publicRoutes.includes(currentPath)) {
      router.push('/dashboard')
    }
  }, [user, initialized, loading, currentPath, router])

  // Loading state
  if (loading || !initialized) {
    // Show loading indicator only for protected routes
    if (!publicRoutes.includes(currentPath)) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      )
    }
  }

  // Render children
  return children
}

export default AppWrapper
