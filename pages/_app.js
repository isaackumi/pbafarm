// pages/_app.js
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import { SettingsProvider } from '../contexts/SettingsContext'
import { CompanySettingsProvider } from '../contexts/CompanySettingsContext'
import { DataProvider } from '../contexts/DataContext'
import { NotificationProvider } from '../contexts/NotificationContext'
import { AnalyticsProvider } from '../contexts/AnalyticsContext'
import { ToastProvider } from '../components/Toast'
import { Provider } from 'react-redux'
import { store } from '../store'
import { convex } from '../lib/convexClient'
import { AppShellSkeleton } from '../components/ui'
import '../styles/globals.css'

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
                <DataProvider>
                  <ToastProvider>
                    <NotificationProvider>
                      <AnalyticsProvider>
                        <AuthWrapper>
                          <Component {...pageProps} />
                          <AiAssistant />
                        </AuthWrapper>
                      </AnalyticsProvider>
                    </NotificationProvider>
                  </ToastProvider>
                </DataProvider>
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
    }

    if (user && publicRoutes.includes(currentPath)) {
      router.push('/dashboard')
    }
  }, [user, initialized, loading, currentPath, router])

  if (loading || !initialized) {
    if (!publicRoutes.includes(currentPath)) {
      return <AppShellSkeleton />
    }
  }

  return children
}

export default AppWrapper
