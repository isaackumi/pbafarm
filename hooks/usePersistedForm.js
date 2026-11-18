import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIX = 'pbafarm:form:'

function store(kind) {
  return kind === 'local' ? window.localStorage : window.sessionStorage
}

function readStored(key, kind) {
  if (typeof window === 'undefined') return null
  try {
    const raw = store(kind).getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeStored(key, value, kind) {
  if (typeof window === 'undefined') return
  try {
    store(kind).setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // quota / private mode — ignore
  }
}

function clearStored(key, kind) {
  if (typeof window === 'undefined') return
  try {
    store(kind).removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

/**
 * Persist form state in sessionStorage so a refresh does not wipe drafts.
 * Cleared automatically via `clear()` after a successful submit.
 *
 * @param {string} key Unique form id, e.g. 'daily-entry'
 * @param {object} defaults Initial form shape
 * @param {{ debounceMs?: number, storage?: 'session' | 'local' }} [options]
 *   storage 'local' survives the phone closing the tab (field drafts).
 */
export function usePersistedForm(key, defaults, options = {}) {
  const debounceMs = options.debounceMs ?? 300
  const kind = options.storage === 'local' ? 'local' : 'session'
  const defaultsRef = useRef(defaults)
  const [formData, setFormData] = useState(() => {
    const stored = readStored(key, kind)
    if (stored && typeof stored === 'object') {
      return { ...defaults, ...stored }
    }
    return defaults
  })
  const [hydrated] = useState(true)
  const timerRef = useRef(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      writeStored(key, formData, kind)
    }, debounceMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [key, formData, debounceMs, kind])

  const clear = useCallback(() => {
    clearStored(key, kind)
    setFormData(defaultsRef.current)
  }, [key, kind])

  const reset = useCallback(
    (next = defaultsRef.current) => {
      setFormData(next)
      writeStored(key, next, kind)
    },
    [key, kind],
  )

  const updateField = useCallback((name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }, [])

  return {
    formData,
    setFormData,
    handleChange,
    updateField,
    clear,
    reset,
    hydrated,
  }
}

export function clearPersistedForm(key) {
  clearStored(key)
}

export default usePersistedForm
