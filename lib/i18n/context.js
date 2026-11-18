/**
 * React side of lib/i18n without app dependencies, so UI primitives can use
 * it without importing the auth and company contexts. The provider that
 * fills it is ./I18nProvider.
 */
import { createContext, useContext } from 'react'
import { DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED_LOCALES, translate, translateOr } from './index'

/** t(key, vars); t.or(key, fallback, vars) for keys that may be missing (dynamic keys). */
export function makeT(locale) {
  const t = (key, vars) => translate(locale, key, vars)
  t.or = (key, fallback, vars) => translateOr(locale, key, fallback, vars)
  return t
}

export const I18nContext = createContext(null)

const FALLBACK = {
  locale: DEFAULT_LOCALE,
  formatLocale: DEFAULT_LOCALE,
  setLocale: async () => {},
  supported: SUPPORTED_LOCALES.map((code) => ({ code, label: LOCALE_LABELS[code] })),
  t: makeT(DEFAULT_LOCALE),
}

/** `t(key, vars)` in the current language; re-renders on a language change. */
export function useT() {
  return (useContext(I18nContext) || FALLBACK).t
}

/** `{ locale, formatLocale, setLocale, supported }` for language pickers (Phase 8 preferences). */
export function useLocale() {
  const { locale, formatLocale, setLocale, supported } = useContext(I18nContext) || FALLBACK
  return { locale, formatLocale, setLocale, supported }
}
