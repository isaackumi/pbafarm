// pages/index.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { AppShellSkeleton } from '../components/ui'

/**
 * app.getanowa.com is the product, not the marketing site (getanowa.com,
 * repo Hei-Tech-Inc/anowa-website). The root sends signed-in users to the
 * dashboard and everyone else to sign in, where farms can also sign up.
 */
export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    router.replace(user ? '/dashboard' : '/login')
  }, [user, loading, router])

  return <AppShellSkeleton />
}
