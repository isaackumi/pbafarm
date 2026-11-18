import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { FISH_SPECIES } from '../lib/fishSpecies'

/**
 * Species choices for pickers (D-012): the organization's configured species
 * when it has any, else the built-in list. `current` stays selectable even
 * if it was archived, so editing an old record does not change it.
 */
export function useSpeciesOptions(current) {
  const { user } = useAuth()
  const list = useQuery(api.species.list, user ? {} : 'skip')
  return useMemo(() => {
    const options = list?.length ? list.map((s) => ({ value: s.key, label: s.name })) : FISH_SPECIES
    if (current && !options.some((o) => o.value === current)) {
      const known = FISH_SPECIES.find((s) => s.value === current)
      return [...options, { value: current, label: known?.label || current }]
    }
    return options
  }, [list, current])
}
