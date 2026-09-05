import { useEffect, useRef } from 'react'
import { useLocation } from '../contexts/LocationContext'
import { Select } from './ui'

/**
 * Farm site picker bound to header location context.
 * - valueKind "id" (default): value is farmLocations id
 * - valueKind "name": value is the location display name (string fields)
 * - syncWithHeader: follow the header switcher when it changes
 * - locked: read-only, always the header location (forms that track site metadata)
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
}) {
  const { locations, activeLocationId, activeLocation } = useLocation()
  const lastHeader = useRef(null)

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
      {(locations || []).map((loc) => (
        <option key={loc.id || loc._id} value={loc.id || loc._id}>
          {loc.name}
          {loc.code ? ` (${loc.code})` : ''}
          {locked && (loc.id || loc._id) === activeLocationId ? ' · current' : ''}
        </option>
      ))}
    </Select>
  )
}
