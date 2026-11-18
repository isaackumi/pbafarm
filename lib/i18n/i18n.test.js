import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import en from '../../locales/en.json'
import fr from '../../locales/fr.json'
import {
  catalogKeys,
  formattingLocale,
  navKey,
  resolveLocale,
  setActiveLanguage,
  supportedLanguage,
  t,
  translate,
  translateOr,
} from './index'

const ROOT = join(__dirname, '..', '..')
const SOURCE_DIRS = ['pages', 'components', 'lib', 'hooks', 'contexts']

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(js|jsx|ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

const sources = SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
  path,
  src: readFileSync(path, 'utf8'),
}))

const NAMESPACES = Object.keys(en)

afterEach(() => setActiveLanguage('en'))

describe('catalogs (I18N-002)', () => {
  test('English and French have exactly the same keys', () => {
    expect(catalogKeys(fr)).toEqual(catalogKeys(en))
  })

  test('plural entries have an `other` form in both languages', () => {
    const walk = (a, b, prefix) => {
      for (const [k, v] of Object.entries(a)) {
        if (v && typeof v === 'object' && 'other' in v) {
          expect({ key: `${prefix}${k}`, fr: typeof b[k]?.other }).toEqual({ key: `${prefix}${k}`, fr: 'string' })
        } else if (v && typeof v === 'object') walk(v, b[k] || {}, `${prefix}${k}.`)
      }
    }
    walk(en, fr, '')
  })

  test('placeholders match between English and French', () => {
    const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const flat = (cat, key) => key.split('.').reduce((n, p) => n?.[p], cat)
    for (const key of catalogKeys(en)) {
      const a = flat(en, key)
      const b = flat(fr, key)
      const as = typeof a === 'string' ? a : a.other
      const bs = typeof b === 'string' ? b : b.other
      expect({ key, vars: vars(bs) }).toEqual({ key, vars: vars(as) })
    }
  })

  test('every key the code names exists in en.json', () => {
    const known = new Set(catalogKeys(en))
    const missing = []
    const keyRe = new RegExp(`['"]((?:${NAMESPACES.join('|')})\\.[\\w.]+)['"]`, 'g')
    for (const { path, src } of sources) {
      // t('a.b'), t.or('a.b', …), translate('a.b') and keys chosen in a ternary.
      for (const m of src.matchAll(/\bt(?:\.or)?\(\s*'([\w.]+)'/g)) {
        if (!known.has(m[1])) missing.push(`${path.slice(ROOT.length)}: ${m[1]}`)
      }
      if (!/\buseT\(\)|from '(\.\.\/)+lib\/i18n'|from '\.\/index'/.test(src)) continue
      for (const m of src.matchAll(keyRe)) {
        if (!known.has(m[1])) missing.push(`${path.slice(ROOT.length)}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('every navigation path has a translated label', () => {
    const known = new Set(catalogKeys(en))
    for (const file of ['components/Sidebar.js', 'components/MobileTabBar.js']) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const m of src.matchAll(/path: '([^']+)'/g)) {
        expect({ path: m[1], key: known.has(navKey(m[1])) }).toEqual({ path: m[1], key: true })
      }
    }
    expect(navKey('/feed-management/analytics')).toBe('nav.item.feedManagementAnalytics')
  })
})

describe('t()', () => {
  test('interpolates, pluralises per language, and falls back', () => {
    expect(translate('en', 'common.sendAgainIn', { seconds: 30 })).toBe('Send again in 30s')
    expect(translate('fr', 'common.sendAgainIn', { seconds: 30 })).toBe('Renvoyer dans 30 s')
    expect(translate('en', 'daily.saveN', { count: 1 })).toBe('Save 1 record')
    expect(translate('en', 'daily.saveN', { count: 3 })).toBe('Save 3 records')
    // French treats 0 and 1 as singular.
    expect(translate('fr', 'daily.saveN', { count: 0 })).toBe('Enregistrer 0 relevé')
    expect(translate('fr', 'daily.saveN', { count: 2 })).toBe('Enregistrer 2 relevés')
    // Numbers are formatted for the language.
    expect(translate('en', 'harvest.onRecord', { count: 12500 })).toBe('On record now: 12,500 fish.')
    expect(translate('fr', 'harvest.onRecord', { count: 12500 })).toMatch(/^Effectif actuel : 12\s500 poissons\.$/)
    // Unknown language → English; unknown key → the key, or the given fallback.
    expect(translate('de', 'common.save')).toBe('Save')
    expect(translate('fr', 'nope.missing')).toBe('nope.missing')
    expect(translateOr('fr', 'nav.item.unknownPage', 'Unknown page')).toBe('Unknown page')
    setActiveLanguage('fr-CI')
    expect(t('common.cancel')).toBe('Annuler')
  })

  test('language resolution: user, then organization, then browser, then English', () => {
    expect(resolveLocale({ user: 'fr', org: 'en-GH', browser: 'en-US' })).toBe('fr')
    expect(resolveLocale({ user: null, org: 'fr-SN', browser: 'en-US' })).toBe('fr')
    expect(resolveLocale({ user: 'de', org: 'pt-BR', browser: ['de-DE', 'fr-FR'] })).toBe('fr')
    expect(resolveLocale({})).toBe('en')
    expect(supportedLanguage('FR_ci')).toBe('fr')
    expect(formattingLocale('en', 'en-GH')).toBe('en-GH')
    expect(formattingLocale('fr', 'en-GH')).toBe('fr')
  })
})
