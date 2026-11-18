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
import { I18nProvider } from '../lib/i18n/I18nProvider'
import { useT } from '../lib/i18n/context'
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
import { safeNextPath } from '../lib/safeRedirect'
import { SIGN_OUT_CODES, authErrorCode } from '../convex/lib/authErrors'
import { fontVariablesCss } from '../lib/fonts'
import '../styles/globals.css'
import '../styles/tour.css'

/** Lazy-load assistant so it does not block first paint / route transitions. */
const AiAssistant = dynamic(() => import('../components/AiAssistant'), {
  ssr: false,
})

/** Sends entries queued on this device when the connection is back (MOBILE-002). */
const OutboxSync = dynamic(() => import('../components/OutboxSync'), { ssr: false })

function useServiceWorker() {
  useEffect(() => {
    // Production only: a service worker caching dev bundles makes hot reload lie.
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    // A new URL per build installs a new worker, which drops the old build's cache.
    const build = window.__NEXT_DATA__?.buildId || 'dev'
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(build)}`)
      .catch((err) => {
        console.warn('Service worker registration failed', err)
      })
  }, [])
}

function AppWrapper({ Component, pageProps, router }) {
  useServiceWorker()
  return (
    <ConvexAuthProvider client={convex}>
      {/* Self-hosted font faces for the CSS variables in globals.css (MOBILE-007). */}
      <style dangerouslySetInnerHTML={{ __html: fontVariablesCss }} />
      <Provider store={store}>
        <ThemeProvider>
          <SettingsProvider>
            <AuthProvider>
              <CompanySettingsProvider>
                <I18nProvider>
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
                </I18nProvider>
              </CompanySettingsProvider>
            </AuthProvider>
          </SettingsProvider>
        </ThemeProvider>
      </Provider>
    </ConvexAuthProvider>
  )
}

/** Signed-out pages; a signed-in visitor is sent on to the app. */
const PUBLIC_ROUTES = ['/login', '/signup', '/reset-password']
/** Open to signed-in and signed-out visitors (an invite link shows who invited you). */
const OPEN_ROUTES = ['/invite/[token]']

/** Where each access state may go; everything else redirects to `home`. */
const ACCESS_ROUTES = {
  PASSWORD_CHANGE_REQUIRED: { home: '/account?force=1', allowed: ['/account'] },
  // Company requires two-step verification and this session has not passed it.
  MFA_REQUIRED: { home: '/verify', allowed: ['/verify'] },
  NO_COMPANY: {
    home: '/register-company',
    allowed: ['/register-company', '/account', '/verify-email', '/invite/[token]'],
  },
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

/**
 * Shown while the shell runs from the account saved on this device because
 * Convex could not be reached (offline cold start, MOBILE-001).
 */
function OfflineSessionBanner() {
  const t = useT()
  return (
    <div
      role="status"
      className="sticky top-0 z-40 bg-foam-deep px-4 py-2 text-center text-sm text-chart-ink print:hidden"
    >
      {t('common.offlineSession')}
    </div>
  )
}

function AuthWrapper({ children }) {
  const { user, initialized, loading, accessState, signOut, offlineMode } = useAuth()
  const router = useRouter()
  const signingOut = useRef(false)
  // AuthContext's signOut is a new function every render; keep callbacks stable.
  const signOutRef = useRef(signOut)
  signOutRef.current = signOut

  const currentPath = router.pathname

  // Inactive account or company no longer approved: end the session and say why.
  const signOutWithReason = useCallback(
    async (code) => {
      if (signingOut.current) return
      signingOut.current = true
      try {
        // Server ended the session: no outbox prompt; queued entries are kept.
        await signOutRef.current({ force: true })
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

    if (!user && !PUBLIC_ROUTES.includes(currentPath) && !OPEN_ROUTES.includes(currentPath)) {
      router.push(`/login?next=${encodeURIComponent(router.asPath)}`)
      return
    }

    if (user && PUBLIC_ROUTES.includes(currentPath)) {
      router.push(safeNextPath(router.query.next, restricted ? restricted.home : '/dashboard'))
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
    if (!PUBLIC_ROUTES.includes(currentPath) && !OPEN_ROUTES.includes(currentPath)) {
      return <AppShellSkeleton />
    }
  }

  // Do not render pages whose queries the server would refuse.
  if (mustSignOut || (offRoute && !PUBLIC_ROUTES.includes(currentPath))) {
    return <AppShellSkeleton />
  }

  return (
    <AuthErrorBoundary
      key={currentPath}
      onAuthError={(code) =>
        // Unverified session: verify, do not sign out.
        code === 'MFA_REQUIRED' ? router.replace('/verify') : signOutWithReason(code)
      }
    >
      {offlineMode && <OfflineSessionBanner />}
      {user && <OutboxSync />}
      {children}
    </AuthErrorBoundary>
  )
}

export default AppWrapper
