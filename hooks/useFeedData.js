import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { normalizeAlerts, rangeToDates, summarizeCosts, summarizeUsage } from '../lib/feedData'

// Reactive feed reads (UX-002). Each returns undefined while loading; a
// failed load throws to the nearest QueryBoundary.

function useRange(timeRange) {
  // Recomputed only when the range changes, so the subscription is stable.
  return useMemo(() => rangeToDates(timeRange), [timeRange])
}

/** Feed used in the range at the active site, totalled by feed type and cage. */
export function useFeedUsageStats(timeRange = '30d') {
  const { locationArgs } = useLocation()
  const { dateFrom, dateTo } = useRange(timeRange)
  const rows = useQuery(api.feed.listUsage, { ...locationArgs, dateFrom, dateTo })
  const feedTypes = useQuery(api.feed.listFeedTypes, {})
  const cages = useQuery(api.cages.list, locationArgs)
  return useMemo(
    () =>
      rows === undefined || feedTypes === undefined || cages === undefined
        ? undefined
        : summarizeUsage(rows, feedTypes, cages),
    [rows, feedTypes, cages],
  )
}

/** Purchase spend in the range (all sites). */
export function useFeedCostAnalysis(timeRange = '30d') {
  const { dateFrom, dateTo } = useRange(timeRange)
  const purchases = useQuery(api.feed.listPurchases, { dateFrom, dateTo })
  return useMemo(() => (purchases === undefined ? undefined : summarizeCosts(purchases)), [purchases])
}

/** Items below their minimum stock. */
export function useLowStockAlerts() {
  const data = useQuery(api.inventory.listAlerts, {})
  return useMemo(() => (data === undefined ? undefined : normalizeAlerts(data)), [data])
}
