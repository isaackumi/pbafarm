import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

/** True while `now` is inside the window [startsAt, endsAt). */
export function isMaintenanceActive(window, now) {
  return Boolean(window && now >= window.startsAt && now < window.endsAt)
}

/** "02:30" in GMT for "Back by 02:30 GMT". */
export function backByTime(endsAt) {
  const d = new Date(endsAt)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Milliseconds until the window next opens or closes, or null when nothing changes. */
export function nextBoundary(window, now) {
  if (!window) return null
  if (now < window.startsAt) return window.startsAt - now
  if (now < window.endsAt) return window.endsAt - now
  return null
}

/**
 * The platform maintenance window (convex/platform/maintenance.ts) and
 * whether it is open now. Queries have no clock, so this re-renders when the
 * window opens or closes.
 */
export function useMaintenance() {
  const data = useQuery(api.platform.maintenance.status, {})
  const window = data?.window ?? null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const wait = nextBoundary(window, Date.now())
    if (wait === null) return undefined
    // setTimeout caps at ~24.8 days; re-check at least daily.
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait + 250, 24 * 60 * 60 * 1000))
    return () => clearTimeout(id)
  }, [window, now])
  return {
    loading: data === undefined,
    window,
    statusPageUrl: data?.statusPageUrl ?? null,
    active: isMaintenanceActive(window, now),
  }
}
