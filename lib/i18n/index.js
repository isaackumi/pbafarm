/**
 * UI translation (I18N-002, D-012). A small in-house `t()` over JSON catalogs
 * in /locales; formatting of numbers, money, dates and units stays in
 * lib/format.js (Intl).
 *
 * Keys are dotted paths into the catalog: t('nav.item.dashboard'). Placeholders
 * are `{name}`. Plurals: when vars.count is a number and the entry is an
 * object, the Intl.PluralRules category picks the branch (`one`, `other`,
 * and `zero`/`few`/`many` where a language has them), falling back to
 * `other`. Missing in the active language → English → the key itself.
 *
 * No React here, so non-component code (toasts, form validation) can call
 * the module-level t(); components use useT() from ./I18nProvider so they
 * re-render when the language changes.
 */
import en from '../../locales/en.json'
import fr from '../../locales/fr.json'

export const CATALOGS = { en, fr }

/** Languages with a committed catalog. English is the source language. */
export const SUPPORTED_LOCALES = ['en', 'fr']
export const DEFAULT_LOCALE = 'en'

/** Each language named in itself, for the language picker. */
export const LOCALE_LABELS = { en: 'English', fr: 'Français' }

/** 'fr-CI' → 'fr'; anything without a catalog → null. */
export function supportedLanguage(tag) {
  if (!tag || typeof tag !== 'string') return null
  const lang = tag.trim().toLowerCase().split(/[-_]/)[0]
  return SUPPORTED_LOCALES.includes(lang) ? lang : null
}

/**
 * The UI language: the user's choice, then the organization's default
 * locale, then the browser, then English.
 */
export function resolveLocale({ user, org, browser } = {}) {
  return (
    supportedLanguage(user) ||
    supportedLanguage(org) ||
    (Array.isArray(browser) ? browser.map(supportedLanguage).find(Boolean) : supportedLanguage(browser)) ||
    DEFAULT_LOCALE
  )
}

/**
 * The tag used for Intl formatting: keep the organization's region when it
 * speaks the same language ('en' + 'en-GH' → 'en-GH'), else the language.
 */
export function formattingLocale(language, orgLocale) {
  if (orgLocale && supportedLanguage(orgLocale) === language) return orgLocale
  return language
}

function lookup(catalog, key) {
  let node = catalog
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

const pluralRules = {}
function pluralCategory(locale, count) {
  try {
    pluralRules[locale] ||= new Intl.PluralRules(locale)
    return pluralRules[locale].select(count)
  } catch {
    return count === 1 ? 'one' : 'other'
  }
}

function interpolate(text, vars, locale) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    if (typeof value === 'number' && Number.isFinite(value)) {
      try {
        return new Intl.NumberFormat(locale).format(value)
      } catch {
        return String(value)
      }
    }
    return value == null ? '' : String(value)
  })
}

function resolveEntry(entry, locale, vars) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof vars?.count === 'number') {
    const branch = entry[pluralCategory(locale, vars.count)] ?? entry.other
    if (typeof branch === 'string') return branch
  }
  return undefined
}

/** Translate `key` in `locale`. */
export function translate(locale, key, vars) {
  const lang = supportedLanguage(locale) || DEFAULT_LOCALE
  let text = resolveEntry(lookup(CATALOGS[lang], key), lang, vars)
  let used = lang
  if (text === undefined && lang !== DEFAULT_LOCALE) {
    text = resolveEntry(lookup(CATALOGS[DEFAULT_LOCALE], key), DEFAULT_LOCALE, vars)
    used = DEFAULT_LOCALE
  }
  if (text === undefined) return key
  return interpolate(text, vars, used)
}

let activeLanguage = DEFAULT_LOCALE

/** Called by I18nProvider; lets non-React code translate in the user's language. */
export function setActiveLanguage(locale) {
  activeLanguage = supportedLanguage(locale) || DEFAULT_LOCALE
}

export function getActiveLanguage() {
  return activeLanguage
}

/** Translate in the active language (for code outside components). */
export function t(key, vars) {
  return translate(activeLanguage, key, vars)
}

/** Catalog key for a navigation path: '/feed-management/analytics' → 'nav.item.feedManagementAnalytics'. */
export function navKey(path) {
  const slug = String(path)
    .replace(/^\/+/, '')
    .split(/[/-]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
  return `nav.item.${slug || 'home'}`
}

/** translate(), but `fallback` instead of the bare key when nothing matches. */
export function translateOr(locale, key, fallback, vars) {
  const text = translate(locale, key, vars)
  return text === key ? fallback : text
}

/** Every dotted key with a string or plural entry (tests, tooling). */
export function catalogKeys(catalog) {
  const out = []
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k
      const isPlural =
        v && typeof v === 'object' && typeof v.other === 'string' &&
        Object.values(v).every((x) => typeof x === 'string')
      if (typeof v === 'string' || isPlural) out.push(path)
      else if (v && typeof v === 'object') walk(v, path)
    }
  }
  walk(catalog, '')
  return out.sort()
}
