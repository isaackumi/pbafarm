import { useEffect, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { readReferenceList, saveReferenceData } from '../lib/referenceCache'
import { useOnline } from './useOutbox'

const EMPTY = []

/**
 * A reference list a field form needs offline (MOBILE-003): the live query,
 * saved on the device whenever it loads; while it has not loaded (no signal),
 * the last copy this user saw at this site.
 *
 * `name` is the cache slot ('cages' | 'feedTypes'); `select` filters the live
 * rows before they are used and saved. Returns { list, ready, cached }:
 * `ready` is true once there is something to show, or offline with nothing saved.
 */
export function useReferenceList(name, query, args = {}, select) {
  const { user } = useAuth()
  const userId = user?.id
  const { activeLocationId } = useLocation()
  const online = useOnline()
  const raw = useQuery(query, user ? args : 'skip')
  const live = useMemo(() => (raw === undefined ? undefined : select ? select(raw) : raw), [raw, select])

  useEffect(() => {
    if (userId && Array.isArray(live)) saveReferenceData(userId, activeLocationId, { [name]: live })
  }, [userId, activeLocationId, name, live])

  const cached = useMemo(
    () => (live === undefined ? readReferenceList(userId, activeLocationId, name) : null),
    [live, userId, activeLocationId, name],
  )
  return {
    list: live ?? cached ?? EMPTY,
    ready: live !== undefined || cached != null || !online,
    cached: live === undefined && cached != null,
  }
}
