import { useMemo } from 'react'
import { useQueries } from 'convex/react'

/**
 * Like `useQuery`, but a failing query yields `fallback` instead of throwing to
 * the nearest QueryBoundary. For secondary data a page can render without.
 * Returns undefined while loading. Pass args = 'skip' to skip.
 */
export function useOptionalQuery(query, args, fallback = null) {
  const key = args === 'skip' ? 'skip' : JSON.stringify(args ?? {})
  const queries = useMemo(
    () => (key === 'skip' ? {} : { result: { query, args: JSON.parse(key) } }),
    [query, key],
  )
  const { result } = useQueries(queries)
  if (key === 'skip') return undefined
  return result instanceof Error ? fallback : result
}
