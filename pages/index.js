// pages/index.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { AppShellSkeleton } from '../components/ui'
import Landing from '../components/marketing/Landing'

/**
 * Signed-in visitors go to the app; everyone else sees the landing page.
 * The landing renders while auth is still loading (and on the server), so
 * the page has real content for first paint and search engines; only a
 * confirmed signed-in user gets the app skeleton while being redirected.
 */
export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  if (user) return <AppShellSkeleton />
  return <Landing />
}
