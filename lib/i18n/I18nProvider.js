/**
 * Language for the whole app (I18N-002). The UI language resolves as:
 * the user's saved choice (users.locale, or the language picked on this
 * device before sign-in) → the organization's default locale → the browser
 * → English.
 *
 * Also pushes the formatting locale, unit system and currency into
 * lib/format.js so formatMoney/formatDate/formatQuantity follow the user's
 * language and the organization's settings without every caller passing them.
 *
 * Consumers: useT() for strings; useLocale() for the language picker
 * (Phase 8 user preferences use setLocale from here).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useCompanySettings } from '../../contexts/CompanySettingsContext'
import { setActiveCurrency, setActiveLocale, setActiveUnitSystem } from '../format'
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  formattingLocale,
  resolveLocale,
  setActiveLanguage,
  supportedLanguage,
} from './index'
import { I18nContext, makeT } from './context'

const STORAGE_KEY = 'pbafarm:locale'

function readDeviceLocale() {
  try {
    return supportedLanguage(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function writeDeviceLocale(locale) {
  try {
    if (locale) window.localStorage.setItem(STORAGE_KEY, locale)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}


export function I18nProvider({ children }) {
  const { user } = useAuth()
  const { company, currency } = useCompanySettings()
  const saveLocale = useMutation(api.users.setLocale)
  // English on the server render and first paint; the effect below switches.
  const [deviceLocale, setDeviceLocale] = useState(null)
  const [browser, setBrowser] = useState(null)
  const [pending, setPending] = useState(null)

  useEffect(() => {
    setDeviceLocale(readDeviceLocale())
    if (typeof navigator !== 'undefined') {
      setBrowser(navigator.languages?.length ? [...navigator.languages] : navigator.language)
    }
  }, [])

  const orgLocale = company?.profile?.defaultLocale || null
  const userLocale = user ? user.locale || null : null

  // A choice just made wins until the server echoes it back.
  useEffect(() => {
    if (pending && userLocale === pending) setPending(null)
  }, [pending, userLocale])

  const locale = resolveLocale({
    // A language picked on this device before sign-in counts as the user's
    // choice until they save one to their account.
    user: pending || userLocale || deviceLocale,
    org: orgLocale,
    browser,
  })
  const formatLocale = formattingLocale(locale, orgLocale)

  // Module-level state for non-React callers, set during render so children
  // formatting in this same render already see it.
  setActiveLanguage(locale)
  setActiveLocale(formatLocale)
  setActiveUnitSystem(company?.profile?.unitSystem)
  setActiveCurrency(currency)

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback(
    async (next) => {
      const lang = next == null ? null : supportedLanguage(next)
      if (next != null && !lang) throw new Error(`Language ${next} is not available`)
      writeDeviceLocale(lang)
      setDeviceLocale(lang)
      if (!user) return
      setPending(lang)
      try {
        await saveLocale({ locale: lang })
      } catch (err) {
        setPending(null)
        throw err
      }
    },
    [user, saveLocale],
  )

  const value = useMemo(
    () => ({
      locale,
      formatLocale,
      setLocale,
      supported: SUPPORTED_LOCALES.map((code) => ({ code, label: LOCALE_LABELS[code] })),
      t: makeT(locale),
    }),
    [locale, formatLocale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export { useLocale, useT } from './context'
