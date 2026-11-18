// pages/_app.js
import dynamic from 'next/dynamic'
import { Component, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import { SettingsProvider } from '../contexts/SettingsContext'
import { CompanySettingsProvider } from '../contexts/CompanySettingsContext'
import { LocationProvider } from '../contexts/LocationContext'
import { DataProvider } from '../contexts/DataContext'
import { NotificationProvider } from '../contexts/NotificationContext'
import { AnalyticsProvider } from '../contexts/AnalyticsContext'
import { ToastProvider } from '../components/Toast'
import { TourProvider } from '../components/TourProvider'
import { Provider } from 'react-redux'
import { store } from '../store'
import { convex } from '../lib/convexClient'
import { AppShellSkeleton } from '../components/ui'
import ErrorBoundary from '../components/ErrorBoundary'
import { SIGN_OUT_CODES, authErrorCode } from '../convex/lib/authErrors'
import '../styles/globals.css'
import '../styles/tour.css'

/** Lazy-load assistant so it does not block first paint / route transitions. */
const AiAssistant = dynamic(() => import('../components/AiAssistant'), {
  ssr: false,
})

function useServiceWorker() {
  useEffect(() => {
    // Production only: a service worker caching dev bundles makes hot reload lie.
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed', err)
    })
  }, [])
}

function AppWrapper({ Component, pageProps, router }) {
  useServiceWorker()
  return (
    <ConvexAuthProvider client={convex}>
      <Provider store={store}>
        <ThemeProvider>
          <SettingsProvider>
            <AuthProvider>
              <CompanySettingsProvider>
                <LocationProvider>
                <DataProvider>
                  <ToastProvider>
                    <NotificationProvider>
                      <AnalyticsProvider>
                        <TourProvider>
                          <AuthWrapper>
                            <ErrorBoundary resetKey={router.asPath}>
                              <Component {...pageProps} />
                            </ErrorBoundary>
                            <ErrorBoundary resetKey={router.asPath} silent>
                              <AiAssistant />
                            </ErrorBoundary>
                          </AuthWrapper>
                        </TourProvider>
                      </AnalyticsProvider>
                    </NotificationProvider>
                  </ToastProvider>
                </DataProvider>
                </LocationProvider>
              </CompanySettingsProvider>
            </AuthProvider>
          </SettingsProvider>
        </ThemeProvider>
      </Provider>
    </ConvexAuthProvider>
  )
}

/** Where each access state may go; everything else redirects to `home`. */
const ACCESS_ROUTES = {
  PASSWORD_CHANGE_REQUIRED: { home: '/account?force=1', allowed: ['/account'] },
  NO_COMPANY: { home: '/register-company', allowed: ['/register-company', '/account'] },
}

/**
 * Last line of defence: if a page throws an access-refusal error during
 * render (a race with users.current), sign out instead of crashing.
 */
class AuthErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    const code = authErrorCode(error)
    if (code) this.props.onAuthError(code)
  }

  render() {
    const { error } = this.state
    if (error) {
      if (!authErrorCode(error)) throw error
      return <AppShellSkeleton />
    }
    return this.props.children
  }
}

function AuthWrapper({ children }) {
  const { user, initialized, loading, accessState, signOut } = useAuth()
  const router = useRouter()
  const signingOut = useRef(false)
  // AuthContext's signOut is a new function every render; keep callbacks stable.
  const signOutRef = useRef(signOut)
  signOutRef.current = signOut

  const publicRoutes = ['/login', '/signup', '/reset-password', '/verify-email']
  const currentPath = router.pathname

  // Inactive account or company no longer approved: end the session and say why.
  const signOutWithReason = useCallback(
    async (code) => {
      if (signingOut.current) return
      signingOut.current = true
      try {
        await signOutRef.current()
      } finally {
        signingOut.current = false
        router.replace(`/login?reason=${encodeURIComponent(code)}`)
      }
    },
    [router],
  )

  // Mutations/actions refused with a sign-out code (USER_INACTIVE, COMPANY_NOT_APPROVED).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onRejection = (event) => {
      const code = authErrorCode(event.reason)
      if (code && SIGN_OUT_CODES.includes(code)) signOutWithReason(code)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [signOutWithReason])

  const mustSignOut = Boolean(user && SIGN_OUT_CODES.includes(accessState))
  const restricted = user ? ACCESS_ROUTES[accessState] : null
  const offRoute =
    restricted && !restricted.allowed.includes(currentPath)

  useEffect(() => {
    if (!initialized || loading) return

    if (mustSignOut) {
      signOutWithReason(accessState)
      return
    }

    if (!user && !publicRoutes.includes(currentPath)) {
      router.push('/login')
      return
    }

    if (user && publicRoutes.includes(currentPath)) {
      router.push(restricted ? restricted.home : '/dashboard')
      return
    }

    // Temporary password → /account; no company → /register-company.
    // These clear reactively, so the user can leave once resolved.
    if (offRoute) {
      router.push(restricted.home)
    }
  }, [
    user,
    accessState,
    mustSignOut,
    restricted,
    offRoute,
    initialized,
    loading,
    currentPath,
    router,
    signOutWithReason,
  ])

  if (loading || !initialized) {
    if (!publicRoutes.includes(currentPath)) {
      return <AppShellSkeleton />
    }
  }

  // Do not render pages whose queries the server would refuse.
  if (mustSignOut || (offRoute && !publicRoutes.includes(currentPath))) {
    return <AppShellSkeleton />
  }

  return (
    <AuthErrorBoundary key={currentPath} onAuthError={signOutWithReason}>
      {children}
    </AuthErrorBoundary>
  )
}

export default AppWrapper
