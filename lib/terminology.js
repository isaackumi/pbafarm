/**
 * Organization words (CUSTOM-003, D-007), pure helpers shared by the editor,
 * the unit-label formatter and tests. The server allow-list lives in
 * convex/lib/terminology.ts and must stay in step with TERM_GROUPS.
 *
 * `makeTerm(terms)` returns:
 *   term(key, fallback)                  one stored word, else the fallback
 *   term.text(label)                     built-in nouns rewritten ("All Cages" → "All Pens")
 *   term.unit(unitOrType, { plural })    a unit type's renamed label
 */
import { UNIT_TYPES } from './format'

/** Editable words, grouped for the editor. `singular`/`plural` are built-in labels. */
export const TERM_GROUPS = [
  {
    id: 'units',
    title: 'Production units',
    description: 'What you call the places fish live. The generic word covers units without a type.',
    fields: [
      { key: 'unit', pluralKey: 'unitPlural', label: 'Generic unit', singular: 'Unit', plural: 'Units' },
      { key: 'cage', pluralKey: 'cagePlural', label: 'Cage unit', singular: 'Cage', plural: 'Cages' },
      { key: 'pond', pluralKey: 'pondPlural', label: 'Pond unit', singular: 'Pond', plural: 'Ponds' },
      { key: 'tank', pluralKey: 'tankPlural', label: 'Tank unit', singular: 'Tank', plural: 'Tanks' },
      { key: 'raceway', pluralKey: 'racewayPlural', label: 'Raceway unit', singular: 'Raceway', plural: 'Raceways' },
      {
        key: 'hatcheryTank',
        pluralKey: 'hatcheryTankPlural',
        label: 'Hatchery tank unit',
        singular: 'Hatchery tank',
        plural: 'Hatchery tanks',
      },
      { key: 'incubator', pluralKey: 'incubatorPlural', label: 'Incubator unit', singular: 'Incubator', plural: 'Incubators' },
      { key: 'hapa', pluralKey: 'hapaPlural', label: 'Hapa unit', singular: 'Hapa', plural: 'Hapas' },
    ],
  },
  {
    id: 'production',
    title: 'Daily work',
    description: 'Words used in entry forms, menus and reports.',
    fields: [
      { key: 'feed', pluralKey: 'feedPlural', label: 'Feed', singular: 'Feed', plural: 'Feeds' },
      { key: 'harvest', pluralKey: 'harvestPlural', label: 'Harvest', singular: 'Harvest', plural: 'Harvests' },
      { key: 'stocking', pluralKey: 'stockingPlural', label: 'Stocking', singular: 'Stocking', plural: 'Stockings' },
      { key: 'sampling', pluralKey: 'samplingPlural', label: 'Sampling', singular: 'Sampling', plural: 'Samplings' },
    ],
  },
  {
    id: 'records',
    title: 'Records',
    description: 'Grouping and place names.',
    fields: [
      { key: 'batch', pluralKey: 'batchPlural', label: 'Batch', singular: 'Batch', plural: 'Batches' },
      { key: 'site', pluralKey: 'sitePlural', label: 'Site', singular: 'Site', plural: 'Sites' },
    ],
  },
]

const UNIT_TERM_KEYS = Object.fromEntries(
  UNIT_TYPES.map((u) => [u.value, u.value === 'hatchery_tank' ? 'hatcheryTank' : u.value]),
)

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Default noun → override, longest first so "Hatchery tanks" wins over "Tanks". */
function replacementPairs(terms) {
  if (!terms) return []
  const pairs = []
  for (const group of TERM_GROUPS) {
    for (const field of group.fields) {
      const one = terms[field.key]
      const many = terms[field.pluralKey]
      if (one && one.trim() && one.trim().toLowerCase() !== field.singular.toLowerCase()) {
        pairs.push([field.singular, one.trim()])
      }
      if (many && many.trim() && many.trim().toLowerCase() !== field.plural.toLowerCase()) {
        pairs.push([field.plural, many.trim()])
      }
    }
  }
  return pairs.sort((a, b) => b[0].length - a[0].length)
}

/**
 * Rewrite the built-in nouns in a label ("All Cages" → "All Pens"). Whole
 * words only, case-insensitive, so "Feedback" and "Cageside" stay untouched.
 */
export function applyTerms(text, terms) {
  if (!text || typeof text !== 'string') return text
  let out = text
  for (const [from, to] of replacementPairs(terms)) {
    out = out.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'gi'), to)
  }
  return out
}

/** A term reader bound to one organization's overrides. */
export function makeTerm(terms) {
  const term = (key, fallback) => terms?.[key] || fallback
  term.text = (text) => applyTerms(text, terms)
  term.unit = (unitOrType, { plural = false } = {}) => {
    const type =
      typeof unitOrType === 'string'
        ? unitOrType
        : unitOrType?.unitType || unitOrType?.unit_type || 'cage'
    const known = UNIT_TYPES.find((u) => u.value === type) || UNIT_TYPES[0]
    const key = UNIT_TERM_KEYS[known.value]
    return terms?.[plural ? `${key}Plural` : key] || (plural ? known.plural : known.label)
  }
  return term
}
