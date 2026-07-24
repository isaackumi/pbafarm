// pages/_app.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import { SettingsProvider } from '../contexts/SettingsContext'
import { DataProvider } from '../contexts/DataContext'
import { NotificationProvider } from '../contexts/NotificationContext'
import { AnalyticsProvider } from '../contexts/AnalyticsContext'
import { ToastProvider } from '../components/Toast'
import { Provider } from 'react-redux'
import { store } from '../store'
import { convex } from '../lib/convexClient'
import AiAssistant from '../components/AiAssistant'
import '../styles/globals.css'

function AppWrapper({ Component, pageProps }) {
  return (
    <ConvexAuthProvider client={convex}>
      <Provider store={store}>
        <ThemeProvider>
          <SettingsProvider>
            <AuthProvider>
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
      return (
        <div className="min-h-screen flex items-center justify-center bg-foam">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800" />
        </div>
      )
    }
  }

  return children
}

AppWrapper.getInitialProps = async ({ Component, ctx }) => {
  let pageProps = {}
  if (Component.getInitialProps) {
    pageProps = await Component.getInitialProps(ctx)
  }
  return { pageProps }
}

export default AppWrapper
