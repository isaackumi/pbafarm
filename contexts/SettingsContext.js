import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { DEFAULT_PREFERENCES, cleanPreferences, resolvePreferences } from '../convex/lib/userPreferences'
import {
  readCachedPrefs,
  readLegacySettings,
  removeLegacySettings,
  writeCachedPrefs,
} from '../lib/userPreferences'
import { useAuth } from './AuthContext'
import ErrorBoundary from '../components/ErrorBoundary'

const SettingsContext = createContext()

/**
 * Personal display preferences (CUSTOM-007). Saved on the account in Convex
 * so they follow the person to any device; a per-user copy in localStorage
 * gives the first paint (and offline sessions) the right values. The first
 * time an account has no saved preferences, the settings this browser kept
 * before CUSTOM-007 are copied to it and the old key is removed.
 */
export function SettingsProvider({ children }) {
  const { user, canUseApp } = useAuth()
  const userId = user?.id || null
  const online = Boolean(userId && canUseApp && !user?.offline)
  // undefined = not loaded (or unavailable); null = nothing saved yet.
  const [live, setLive] = useState(undefined)
  const save = useMutation(api.userPreferences.update)
  const importFromDevice = useMutation(api.userPreferences.importFromDevice)

  const [cached, setCached] = useState({ userId: null, prefs: null })
  const [legacy, setLegacy] = useState(null)
  // Edits not yet confirmed by the server; they win over the saved copy.
  const [pending, setPending] = useState({})
  const importing = useRef(false)

  useEffect(() => {
    setCached({ userId, prefs: userId ? readCachedPrefs(userId) : null })
    setLegacy(readLegacySettings())
    setPending({})
  }, [userId])

  useEffect(() => {
    if (!online) setLive(undefined)
  }, [online, userId])

  useEffect(() => {
    if (!userId || live === undefined) return
    if (live) {
      writeCachedPrefs(userId, live)
      // The account already has preferences; this browser's old copy is stale.
      if (legacy) {
        removeLegacySettings()
        setLegacy(null)
      }
      return
    }
    if (!legacy || importing.current) return
    importing.current = true
    importFromDevice({ settings: legacy })
      .then(() => {
        removeLegacySettings()
        setLegacy(null)
      })
      .catch((err) => console.error('Could not move settings to your account', err))
      .finally(() => {
        importing.current = false
      })
  }, [userId, live, legacy, importFromDevice])

  const settings = useMemo(
    () =>
      resolvePreferences(
        // Until the account copy exists, keep showing this browser's settings.
        live ? null : legacy,
        // The account copy, once loaded, replaces the cache: a field cleared
        // on the account must not reappear from an older cached copy.
        !live && cached.userId === userId ? cached.prefs : null,
        live,
        pending,
      ),
    [legacy, cached, userId, live, pending],
  )

  const settingsRef = useRef(settings)
  settingsRef.current = settings

  /** Save some preferences. Resolves when the account copy is updated. */
  const updateSettings = useCallback(
    async (patch) => {
      const clean = cleanPreferences(patch)
      const keys = Object.keys(clean)
      if (keys.length === 0) return
      setPending((p) => ({ ...p, ...clean }))
      if (!userId) return
      writeCachedPrefs(userId, { ...settingsRef.current, ...clean })
      const drop = () =>
        setPending((p) => {
          const next = { ...p }
          for (const k of keys) if (next[k] === clean[k]) delete next[k]
          return next
        })
      try {
        await save(clean)
        drop()
      } catch (err) {
        drop()
        throw err
      }
    },
    [userId, save],
  )

  const resetSettings = useCallback(() => updateSettings(DEFAULT_PREFERENCES), [updateSettings])

  const value = useMemo(
    () => ({
      settings,
      loading: Boolean(online && live === undefined && !cached.prefs),
      updateSettings,
      resetSettings,
    }),
    [settings, online, live, cached.prefs, updateSettings, resetSettings],
  )

  return (
    <SettingsContext.Provider value={value}>
      {online && (
        // A failed load must not take the app down: the cached copy stays.
        <ErrorBoundary silent resetKey={userId}>
          <LivePreferences key={userId} onChange={setLive} />
        </ErrorBoundary>
      )}
      {children}
    </SettingsContext.Provider>
  )
}

function LivePreferences({ onChange }) {
  const live = useQuery(api.userPreferences.mine, {})
  useEffect(() => {
    onChange(live)
  }, [live, onChange])
  return null
}

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
