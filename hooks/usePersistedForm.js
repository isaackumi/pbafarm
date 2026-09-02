import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIX = 'pbafarm:form:'

function readStored(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeStored(key, value) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // quota / private mode — ignore
  }
}

function clearStored(key) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(PREFIX + key)
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
 * @param {{ debounceMs?: number }} [options]
 */
export function usePersistedForm(key, defaults, options = {}) {
  const debounceMs = options.debounceMs ?? 300
  const defaultsRef = useRef(defaults)
  const [formData, setFormData] = useState(() => {
    const stored = readStored(key)
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
      writeStored(key, formData)
    }, debounceMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [key, formData, debounceMs])

  const clear = useCallback(() => {
    clearStored(key)
    setFormData(defaultsRef.current)
  }, [key])

  const reset = useCallback(
    (next = defaultsRef.current) => {
      setFormData(next)
      writeStored(key, next)
    },
    [key],
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
