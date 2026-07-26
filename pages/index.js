// pages/index.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'

export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    // If not loading and we have a user, redirect to dashboard
    if (!loading) {
      if (user) {
        router.push('/dashboard')
      } else {
        router.push('/login')
      }
    }
  }, [user, loading, router])

  // Show loading state while checking authentication
  return (
    <div className="min-h-screen flex items-center justify-center bg-foam">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto"></div>
        <p className="mt-3 text-chart-ink">Loading...</p>
      </div>
    </div>
  )
}
