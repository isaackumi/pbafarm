import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children }) {
  const router = useRouter()
  const { user, loading, initialized } = useAuth()

  useEffect(() => {
    if (initialized && !loading && !user) {
      router.push('/login')
    }
  }, [initialized, loading, user, router])

  if (loading || !initialized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-foam">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return children
}
