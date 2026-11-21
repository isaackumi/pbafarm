import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { AppShellSkeleton } from './ui'
import { usePermissions } from '../hooks/usePermission'
import MaintenanceState from './states/MaintenanceState'
import { useMaintenance } from '../lib/maintenanceMode'

const ROLE_RANK = { user: 1, admin: 2, super_admin: 3 }

/**
 * Page guard. `permission` (PERM-003) checks the member's permissions in the
 * active organization; `requiredRole` is the legacy role check for pages not
 * moved to a permission yet. During a maintenance window
 * (convex/platform/maintenance.ts) non-admins get the maintenance screen.
 */
export default function ProtectedRoute({ children, requiredRole = 'user', permission }) {
  const router = useRouter()
  const { user, loading, initialized, hasRole } = useAuth()
  const { can, loading: permsLoading } = usePermissions()
  const maintenance = useMaintenance()

  const allowed =
    user &&
    (permission
      ? can(permission)
      : typeof hasRole === 'function'
        ? hasRole(requiredRole)
        : (ROLE_RANK[user.role || 'user'] || 0) >= (ROLE_RANK[requiredRole] || 1))

  useEffect(() => {
    if (initialized && !loading && !user) {
      router.push('/login')
      return
    }
    if (initialized && !loading && !permsLoading && user && !allowed) {
      router.replace('/dashboard')
    }
  }, [initialized, loading, permsLoading, user, allowed, router])

  if (loading || !initialized || (permission && permsLoading)) {
    return <AppShellSkeleton />
  }

  if (!user) return null

  // Paper 62 maintenance: while a console admin's window is open, members see
  // the maintenance screen; platform admins keep working.
  if (maintenance.active && user.role !== 'super_admin') {
    return (
      <MaintenanceState
        endsAt={maintenance.window.endsAt}
        message={maintenance.window.message}
        statusPageUrl={maintenance.statusPageUrl}
      />
    )
  }

  if (!allowed) return null

  return children
}
