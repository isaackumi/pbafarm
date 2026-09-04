import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from './AuthContext'

const STORAGE_KEY = 'pba_active_location_id'

const LocationContext = createContext(null)

export function LocationProvider({ children }) {
  const { user } = useAuth()
  const locations = useQuery(api.farmLocations.list, user ? {} : 'skip')
  const ensureDefault = useMutation(api.farmLocations.ensureDefault)
  const setActiveMutation = useMutation(api.farmLocations.setActiveLocation)
  const backfill = useMutation(api.farmLocations.backfillLocations)

  const activeFromServer = user?.activeLocationId

  useEffect(() => {
    if (!user) return
    if (locations === undefined) return
    if (locations.length > 0) return
    ensureDefault({}).catch(() => {})
  }, [user, locations, ensureDefault])

  const activeLocationId = useMemo(() => {
    if (!locations || locations.length === 0) return null
    const stored =
      typeof window !== 'undefined'
        ? localStorage.getItem(STORAGE_KEY)
        : null
    const candidates = [
      stored,
      activeFromServer,
      user?.activeLocationId,
      locations[0]?.id || locations[0]?._id,
    ].filter(Boolean)
    for (const id of candidates) {
      if (locations.some((l) => (l.id || l._id) === id)) return id
    }
    return locations[0]?.id || locations[0]?._id || null
  }, [locations, activeFromServer, user])

  const activeLocation = useMemo(() => {
    if (!activeLocationId || !locations) return null
    return (
      locations.find((l) => (l.id || l._id) === activeLocationId) || null
    )
  }, [locations, activeLocationId])

  const setActiveLocation = useCallback(
    async (locationId) => {
      if (!locationId) return
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, locationId)
      }
      try {
        await setActiveMutation({ locationId })
      } catch (err) {
        console.warn('Failed to persist active location', err)
      }
    },
    [setActiveMutation],
  )

  // Sync localStorage when server active changes
  useEffect(() => {
    if (!activeLocationId || typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, activeLocationId)
  }, [activeLocationId])

  const locationArgs = useMemo(
    () => (activeLocationId ? { locationId: activeLocationId } : {}),
    [activeLocationId],
  )

  const value = useMemo(
    () => ({
      locations: locations || [],
      activeLocation,
      activeLocationId,
      setActiveLocation,
      locationArgs,
      loading: Boolean(user) && locations === undefined,
      runBackfill: (opts) => backfill(opts || {}),
    }),
    [
      locations,
      activeLocation,
      activeLocationId,
      setActiveLocation,
      locationArgs,
      user,
      backfill,
    ],
  )

  return (
    <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
  )
}

export function useLocation() {
  const ctx = useContext(LocationContext)
  if (!ctx) {
    return {
      locations: [],
      activeLocation: null,
      activeLocationId: null,
      setActiveLocation: async () => {},
      locationArgs: {},
      loading: false,
      runBackfill: async () => {},
    }
  }
  return ctx
}
