/**
 * The signed-in member's organizations (farms) and the active one (ORG-002).
 * Wraps memberships.listMine / switchActive. Switching reloads the app at
 * `/dashboard` (or `to`) so every cached query and the site picker start fresh.
 */
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { splitOrgs } from './activeOrganization'

export function useActiveOrganization() {
  const { canUseApp } = useAuth()
  const orgs = useQuery(api.memberships.listMine, canUseApp ? {} : 'skip')
  const switchActive = useMutation(api.memberships.switchActive)
  const [switching, setSwitching] = useState(null)

  const { active, others, isMulti } = useMemo(() => splitOrgs(orgs), [orgs])

  /**
   * Make `companyId` the active organization. Resolves true once the reload
   * has been started, false when nothing happened or the switch failed.
   * `reload: false` skips the reload (the caller navigates itself).
   */
  const switchTo = useCallback(
    async (companyId, { to = '/dashboard', reload = true } = {}) => {
      if (!companyId || switching) return false
      const org = (orgs || []).find((o) => o.companyId === companyId)
      if (!org || org.companyStatus !== 'approved') return false
      if (org.isActive) return false
      setSwitching(companyId)
      try {
        await switchActive({ companyId })
        if (reload) window.location.assign(to)
        return true
      } catch {
        setSwitching(null)
        return false
      }
    },
    [orgs, switching, switchActive],
  )

  return {
    orgs,
    loading: canUseApp && orgs === undefined,
    active,
    others,
    isMulti,
    switching,
    switchTo,
  }
}

export default useActiveOrganization
