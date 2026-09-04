/** Active farm location for HTTP Convex client calls (mirrors LocationContext). */
export const ACTIVE_LOCATION_STORAGE_KEY = 'pba_active_location_id'

export function getActiveLocationId() {
  if (typeof window === 'undefined') return undefined
  return localStorage.getItem(ACTIVE_LOCATION_STORAGE_KEY) || undefined
}

/** Spread into Convex query/mutation args that accept locationId. */
export function withActiveLocation(args = {}) {
  const locationId = getActiveLocationId()
  if (!locationId) return { ...args }
  return { ...args, locationId }
}
