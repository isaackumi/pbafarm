import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'

const FIELD_CLASS =
  'w-full rounded-xl border border-foam-deep bg-surface px-3.5 py-3 text-[15px] text-chart-ink placeholder:text-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-lagoon-800/30 focus:border-lagoon-800 transition-colors disabled:opacity-50 min-h-12'

/**
 * Searchable person field: pick a company user or type a free-text name.
 * Stores a string name (not a user id) so external supervisors still work.
 */
export default function PersonPicker({
  id,
  name,
  value = '',
  onChange,
  placeholder = 'Search users or type a name…',
  disabled = false,
  className = '',
  required = false,
}) {
  const { user } = useAuth()
  const directory = useQuery(api.users.listDirectory, user ? {} : 'skip')
  const listId = useId()
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const people = useMemo(() => directory || [], [directory])

  const filtered = useMemo(() => {
    const q = String(value || '')
      .trim()
      .toLowerCase()
    if (!q) return people.slice(0, 12)
    return people
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.email && p.email.toLowerCase().includes(q)),
      )
      .slice(0, 12)
  }, [people, value])

  useEffect(() => {
    setHighlight(0)
  }, [value, open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const emit = (next) => {
    if (typeof onChange === 'function') {
      onChange({
        target: { name: name || '', value: next },
      })
    }
  }

  const pick = (person) => {
    emit(person.name)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter' && filtered[highlight]) {
      e.preventDefault()
      pick(filtered[highlight])
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        required={required}
        value={value}
        placeholder={placeholder}
        className={FIELD_CLASS}
        onChange={(e) => {
          emit(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-foam-deep bg-surface shadow-lg py-1"
        >
          {directory === undefined ? (
            <li className="px-3.5 py-2 text-sm text-muted">Loading users…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3.5 py-2 text-sm text-muted">
              {value?.trim()
                ? 'No matching user — keep typing to use this name'
                : 'No users loaded — type a name'}
            </li>
          ) : (
            filtered.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={`w-full text-left px-3.5 py-2.5 text-sm transition-colors ${
                    i === highlight
                      ? 'bg-foam text-chart-ink'
                      : 'hover:bg-foam/70 text-chart-ink'
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                >
                  <span className="font-medium">{p.name}</span>
                  {p.email ? (
                    <span className="block text-xs text-muted">{p.email}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
