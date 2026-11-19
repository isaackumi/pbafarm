import { useMemo } from 'react'
import { useQueries } from 'convex/react'
import { getFunctionName } from 'convex/server'

/**
 * Like `useQuery`, but a failing query yields `fallback` instead of throwing to
 * the nearest QueryBoundary. For secondary data a page can render without.
 * Returns undefined while loading. Pass args = 'skip' to skip.
 *
 * The memo is keyed on the function's *name*, not the reference: `api.x.y`
 * builds a new proxy object on every access, so keying on it rebuilt the
 * queries object each render and Convex re-subscribed during render, which
 * React reports as "Too many re-renders" (error #301).
 */
export function useOptionalQuery(query, args, fallback = null) {
  const name = getFunctionName(query)
  const key = args === 'skip' ? 'skip' : JSON.stringify(args ?? {})
  const queries = useMemo(
    () => (key === 'skip' ? {} : { result: { query, args: JSON.parse(key) } }),
    // `query` is intentionally left out: its identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, key],
  )
  const { result } = useQueries(queries)
  if (key === 'skip') return undefined
  return result instanceof Error ? fallback : result
}
