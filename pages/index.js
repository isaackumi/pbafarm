// pages/index.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { AppShellSkeleton } from '../components/ui'
import Landing from '../components/landing/Landing'

/** Signed-in visitors go to the app; everyone else sees the landing page. */
export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  if (loading || user) return <AppShellSkeleton />
  return <Landing />
}
