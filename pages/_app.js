// pages/_app.js
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
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
import '../styles/globals.css'
import '../styles/tour.css'

/** Lazy-load assistant so it does not block first paint / route transitions. */
const AiAssistant = dynamic(() => import('../components/AiAssistant'), {
  ssr: false,
})

function AppWrapper({ Component, pageProps }) {
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
                            <Component {...pageProps} />
                            <AiAssistant />
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

function AuthWrapper({ children }) {
  const { user, initialized, loading } = useAuth()
  const router = useRouter()

  const publicRoutes = ['/login', '/signup', '/reset-password', '/verify-email']
  const currentPath = router.pathname

  useEffect(() => {
    if (!initialized || loading) return

    if (!user && !publicRoutes.includes(currentPath)) {
      router.push('/login')
      return
    }

    if (user && publicRoutes.includes(currentPath)) {
      router.push(
        user.mustChangePassword ? '/account?force=1' : '/dashboard',
      )
      return
    }

    // After password update, mustChangePassword clears reactively — allow leave.
    if (
      user?.mustChangePassword &&
      currentPath !== '/account' &&
      !publicRoutes.includes(currentPath)
    ) {
      router.push('/account?force=1')
    }
  }, [
    user,
    user?.mustChangePassword,
    initialized,
    loading,
    currentPath,
    router,
  ])

  if (loading || !initialized) {
    if (!publicRoutes.includes(currentPath)) {
      return <AppShellSkeleton />
    }
  }

  return children
}

export default AppWrapper
