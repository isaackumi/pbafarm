import { useCallback, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { ADMIN_ONLY } from '../convex/lib/permissionCatalog'

/**
 * What the signed-in member may do in the active organization (PERM-003),
 * from roles.myPermissions. Until that answers (or offline), fall back to the
 * legacy role: admins everything, others everything but ADMIN_ONLY — the
 * same split the role templates encode. The server enforces regardless.
 */
export function usePermissions() {
  const { user, canUseApp } = useAuth()
  const mine = useQuery(api.roles.myPermissions, canUseApp ? {} : 'skip')
  const set = useMemo(() => (mine ? new Set(mine.permissions) : null), [mine])
  const role = user?.role || 'user'
  const can = useCallback(
    (permission) => {
      if (!permission) return true
      if (set) return set.has(permission)
      if (role === 'admin' || role === 'super_admin') return true
      return !ADMIN_ONLY.includes(permission)
    },
    [set, role],
  )
  return {
    can,
    loading: canUseApp && mine === undefined,
    roleKey: mine?.roleKey ?? null,
    roleName: mine?.roleName ?? null,
    allSites: mine?.allSites ?? true,
    siteIds: mine?.siteIds ?? [],
  }
}

/** True when the member holds `permission`. */
export function usePermission(permission) {
  return usePermissions().can(permission)
}
