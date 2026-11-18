import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { usePermission } from '../hooks/usePermission'
import { Select } from './ui'

/**
 * Farm site picker bound to header location context.
 * - valueKind "id" (default): value is farmLocations id
 * - valueKind "name": value is the location display name (string fields)
 * - syncWithHeader: follow the header switcher when it changes
 * - locked: read-only, always the header location (forms that track site metadata)
 * - businessUnitId: only sites in that region / business unit (FARM-004)
 * Sites are grouped by region / business unit when any site has one.
 */
export default function FarmLocationSelect({
  id,
  name,
  value = '',
  onChange,
  required = false,
  disabled = false,
  locked = false,
  className = '',
  syncWithHeader = true,
  valueKind = 'id',
  emptyLabel = 'Select location…',
  allowEmpty = true,
  businessUnitId = null,
}) {
  const { locations: allLocations, activeLocationId, activeLocation } = useLocation()
  const lastHeader = useRef(null)
  const canViewOrg = usePermission('org.view')
  const grouped = canViewOrg && (allLocations || []).some((l) => l.businessUnitId)
  const units = useQuery(api.businessUnits.list, grouped ? {} : 'skip')
  const locations = useMemo(
    () => (businessUnitId ? (allLocations || []).filter((l) => l.businessUnitId === businessUnitId) : allLocations),
    [allLocations, businessUnitId],
  )
  const groups = useMemo(() => {
    if (!grouped || !units) return null
    const name = new Map(units.map((u) => [u._id, u.name]))
    const out = new Map()
    for (const loc of locations || []) {
      const label = (loc.businessUnitId && name.get(loc.businessUnitId)) || ''
      out.set(label, [...(out.get(label) || []), loc])
    }
    return [...out.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [grouped, units, locations])

  const nameForId = (locId) => {
    const loc = (locations || []).find((l) => (l.id || l._id) === locId)
    return loc?.name || activeLocation?.name || ''
  }

  const emit = (locId) => {
    if (typeof onChange !== 'function') return
    const next =
      valueKind === 'name' ? nameForId(locId) : locId || ''
    onChange({
      target: {
        name: name || '',
        value: next,
        locationId: locId || '',
      },
    })
  }

  useEffect(() => {
    if (!syncWithHeader || !activeLocationId) return
    if (lastHeader.current === activeLocationId) return
    lastHeader.current = activeLocationId
    emit(activeLocationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync on header change
  }, [syncWithHeader, activeLocationId])

  // Locked fields always emit the active header location
  useEffect(() => {
    if (!locked || !activeLocationId) return
    emit(activeLocationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, activeLocationId])

  const selectValue = (() => {
    if (locked) return activeLocationId || ''
    if (valueKind === 'name') {
      if (!value) return activeLocationId || ''
      const match = (locations || []).find(
        (l) => (l.name || '').toLowerCase() === String(value).toLowerCase(),
      )
      return match ? match.id || match._id : activeLocationId || ''
    }
    return value || activeLocationId || ''
  })()

  const renderOption = (loc) => (
    <option key={loc.id || loc._id} value={loc.id || loc._id}>
      {loc.name}
      {loc.code ? ` (${loc.code})` : ''}
      {locked && (loc.id || loc._id) === activeLocationId ? ' · current' : ''}
    </option>
  )

  return (
    <Select
      id={id}
      name={name}
      value={selectValue}
      required={required || locked}
      disabled={disabled || locked}
      className={className}
      onChange={(e) => {
        if (locked) return
        lastHeader.current = e.target.value || lastHeader.current
        emit(e.target.value)
      }}
      title={
        locked
          ? 'Locked to header location — switch site from the top bar'
          : undefined
      }
    >
      {!locked && allowEmpty && !required ? (
        <option value="">{emptyLabel}</option>
      ) : (
        <option value="" disabled>
          {emptyLabel}
        </option>
      )}
      {groups
        ? groups.map(([label, locs]) => (
            <optgroup key={label || '—'} label={label || 'Other sites'}>
              {locs.map(renderOption)}
            </optgroup>
          ))
        : (locations || []).map(renderOption)}
    </Select>
  )
}
