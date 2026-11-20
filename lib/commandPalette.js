// Search palette (Paper 72a TVA-1 / 72b TXA-1): pure helpers for page
// matching, the "> action" mode, links that open a page pre-filled for a
// cage, and which visits count as "recent". No React; see lib/commandPalette.test.js.

import { MENU_SECTIONS, NAV_ITEMS, canOpenItem } from './navigation'
import { legacyTabTarget } from './tabGroups'

/** Lower case, letters and digits only: "C-07", "c 07" and "c07" compare equal. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
}

/** True when `query` (normalized) appears in any of `texts`. */
export function matches(query, ...texts) {
  const q = normalize(query)
  if (!q) return false
  return texts.some((text) => normalize(text).includes(q))
}

/** Rank: label starts with the query, then contains it. */
function rank(query, label) {
  const q = normalize(query)
  const l = normalize(label)
  if (l === q) return 0
  if (l.startsWith(q)) return 1
  return 2
}

/** "Production · Review & plan" for a nav item (section, then its group when the section has 2+). */
export function placeOf(item, t = (key, fallback) => fallback) {
  const section = MENU_SECTIONS[item.section]
  if (!section) return ''
  const sectionLabel = t(`nav.section.${item.section}`, section.title)
  const groups = section.groups || []
  const group = groups.length >= 2 ? groups.find((g) => g.key === item.group) : null
  return group ? `${sectionLabel} · ${t(`navSearch.group.${group.key}`, group.title)}` : sectionLabel
}

/**
 * Pages the member may open whose label (or page name) matches `query`, best
 * first, at most `limit`. `labelOf(item)` gives the shown label.
 */
export function matchPages(query, { can = () => true, labelOf = (item) => item.title, limit = 5 } = {}) {
  if (!normalize(query)) return []
  const seen = new Set()
  return NAV_ITEMS.filter((item) => {
    if (seen.has(item.path) || !canOpenItem(item, can)) return false
    seen.add(item.path)
    return matches(query, labelOf(item), item.title)
  })
    .map((item) => ({ item, label: labelOf(item) }))
    .sort((a, b) => rank(query, a.label) - rank(query, b.label) || a.label.localeCompare(b.label))
    .slice(0, limit)
}

/**
 * Actions the palette can run (Paper 72a quick actions, "> log water", and
 * Bulk upload's "Import"). `cage` actions open the page pre-filled.
 */
export const ACTIONS = [
  { key: 'daily', labelKey: 'navSearch.action.daily', title: 'Log daily entry', path: '/daily-entry', permission: 'production.daily.record', cageParam: 'cage' },
  { key: 'water', labelKey: 'navSearch.action.water', title: 'Log water', path: '/water-entry', permission: 'production.daily.record', cageParam: 'cage' },
  { key: 'feed', labelKey: 'navSearch.action.feed', title: 'Issue feed', path: '/feed-issue', permission: 'inventory.issue', cageParam: 'cage' },
  { key: 'sampling', labelKey: 'navSearch.action.sampling', title: 'Record sampling', path: '/biweekly-entry', permission: 'production.sampling.record', cageParam: 'cage' },
  { key: 'transfer', labelKey: 'navSearch.action.transfer', title: 'Transfer', path: '/fish-transfers', permission: 'production.transfer.request', cageParam: 'source' },
  { key: 'stock', labelKey: 'navSearch.action.stock', title: 'Stock a new cage', path: '/stocking', permission: 'production.stocking.request' },
  { key: 'import', labelKey: 'navSearch.action.import', title: 'Import', path: '/bulk-upload', permission: 'production.import' },
  { key: 'createCage', labelKey: 'navSearch.action.createCage', title: 'Create cage', path: '/create-cage', permission: 'production.units.manage' },
  { key: 'ask', labelKey: 'navSearch.action.ask', title: 'Ask Anowa', path: '/assistant', permission: 'ai.use' },
]

export const ACTION_BY_KEY = Object.fromEntries(ACTIONS.map((a) => [a.key, a]))

/** Link for an action, pre-filled for a cage when the action takes one. */
export function actionHref(key, cageId) {
  const action = ACTION_BY_KEY[key]
  if (!action) return null
  if (cageId && action.cageParam) return `${action.path}?${action.cageParam}=${encodeURIComponent(cageId)}`
  return action.path
}

/** Water history of one cage (Health & water, filtered to it). */
export function waterHistoryHref(cageName) {
  return `/water-quality?q=${encodeURIComponent(cageName)}`
}

/** Ask Anowa with a question (Ask Anowa reads `q`). */
export function askHref(question) {
  const q = String(question ?? '').trim()
  return q ? `/assistant?q=${encodeURIComponent(q)}` : '/assistant'
}

/** `"> log water"`: the text after ">" when the query is in action mode, else null. */
export function actionQuery(query) {
  const m = /^\s*>\s*(.*)$/.exec(String(query ?? ''))
  return m ? m[1] : null
}

/** Actions the member may run whose label matches `query` (all of them for an empty query). */
export function matchActions(query, { can = () => true, labelOf = (a) => a.title, limit = 6 } = {}) {
  const allowed = ACTIONS.filter((a) => can(a.permission))
  if (!normalize(query)) return allowed.slice(0, limit)
  return allowed.filter((a) => matches(query, labelOf(a), a.title)).slice(0, limit)
}

const NAV_PATHS = new Set(NAV_ITEMS.map((item) => item.path))

/**
 * What a visit adds to "Recent": `{ kind, key }` for a cage, a batch or a
 * page in the menu, else null. `pathname` is Next's route pattern.
 */
export function recentFromRoute(pathname, query = {}) {
  const id = typeof query.id === 'string' ? query.id : null
  if (pathname === '/cages/[id]' && id) return { kind: 'cage', key: id }
  if (pathname === '/batches/[id]' && id) return { kind: 'batch', key: id }
  const legacy = legacyTabTarget(pathname, query)
  const path = legacy ? legacy.pathname : pathname
  if (NAV_PATHS.has(path)) return { kind: 'page', key: path }
  // A tabbed page (/records/[[...groupTab]], or an old route's /records/daily) counts as its menu entry.
  const group = path.replace(/\/\[\[\.\.\.groupTab\]\]$/, '')
  if (NAV_PATHS.has(group)) return { kind: 'page', key: group }
  const parent = path.replace(/\/[^/]+$/, '')
  if (legacy && NAV_PATHS.has(parent)) return { kind: 'page', key: parent }
  return null
}

/** The nav item for a page path, or null. */
export function pageItem(path) {
  return NAV_ITEMS.find((item) => item.path === path) || null
}

/** Next active index when moving `step` through `count` options (wraps). */
export function moveIndex(index, step, count) {
  if (count <= 0) return -1
  if (index < 0) return step > 0 ? 0 : count - 1
  return (index + step + count) % count
}
