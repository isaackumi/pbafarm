import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { AppShellSkeleton } from './ui'

const ROLE_RANK = { user: 1, admin: 2, super_admin: 3 }

export default function ProtectedRoute({ children, requiredRole = 'user' }) {
  const router = useRouter()
  const { user, loading, initialized, hasRole } = useAuth()

  const allowed =
    user &&
    (typeof hasRole === 'function'
      ? hasRole(requiredRole)
      : (ROLE_RANK[user.role || 'user'] || 0) >= (ROLE_RANK[requiredRole] || 1))

  useEffect(() => {
    if (initialized && !loading && !user) {
      router.push('/login')
      return
    }
    if (initialized && !loading && user && !allowed) {
      router.replace('/dashboard')
    }
  }, [initialized, loading, user, allowed, router])

  if (loading || !initialized) {
    return <AppShellSkeleton />
  }

  if (!user || !allowed) {
    return null
  }

  return children
}
