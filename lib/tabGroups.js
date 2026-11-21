// Tabbed pages (Paper 71 / 71b, "joined with +"): several existing pages shown
// as tabs of one page. Each tab reuses an existing page body; its old route
// redirects here (legacyTabTarget, applied by Layout). Pure data, no React.

/**
 * group: the sidebar section and group the page belongs to (for the eyebrow).
 * tabs[].legacy: the old route whose page body the tab renders.
 * tabs[].legacyQuery: extra query the old route needs to land on this tab.
 */
export const TAB_GROUPS = {
  records: {
    path: '/records',
    section: 'production',
    group: 'review',
    labelKey: 'navSearch.item.records',
    title: 'Records',
    importHref: '/bulk-upload',
    /** Paper 53 tab the Import button opens from each Records tab (lib/csvImport IMPORT_KINDS). */
    importKinds: { daily: 'daily', sampling: 'biweekly', stockings: 'stocking' },
    tabs: [
      { key: 'daily', legacy: '/daily-data', permission: 'production.view', labelKey: 'navSearch.tab.daily', title: 'Daily' },
      { key: 'sampling', legacy: '/biweekly-records', permission: 'production.view', labelKey: 'navSearch.tab.sampling', title: 'Sampling' },
      { key: 'stockings', legacy: '/stocking-management', permission: 'production.view', labelKey: 'navSearch.tab.stockings', title: 'Stockings' },
      { key: 'transfers', legacy: '/fish-transfers', permission: 'production.view', labelKey: 'navSearch.tab.transfers', title: 'Transfers' },
    ],
  },
  feedSetup: {
    path: '/feed-setup',
    section: 'feed',
    group: 'feed',
    labelKey: 'navSearch.item.feedSetup',
    title: 'Feed types + feeding plans',
    tabs: [
      { key: 'types', legacy: '/feed-types', permission: 'inventory.view', labelKey: 'navSearch.tab.feedTypes', title: 'Feed types' },
      { key: 'plans', legacy: '/feeding-plans', permission: 'production.view', labelKey: 'navSearch.tab.feedingPlans', title: 'Feeding plans' },
    ],
  },
  feedAnalytics: {
    path: '/feed-analytics',
    section: 'feed',
    group: 'feed',
    labelKey: 'navSearch.item.feedAnalytics',
    title: 'Analytics (feed + stock)',
    tabs: [
      { key: 'feed', legacy: '/feed-management/analytics', permission: 'inventory.view', labelKey: 'navSearch.tab.feed', title: 'Feed' },
      { key: 'stock', legacy: '/inventory/analytics', permission: 'inventory.view', labelKey: 'navSearch.tab.stock', title: 'Stock' },
    ],
  },
  stock: {
    path: '/stock',
    section: 'feed',
    group: 'stock',
    labelKey: 'navSearch.item.stock',
    title: 'Stock levels + alerts',
    tabs: [
      { key: 'levels', legacy: '/stock-levels', permission: 'inventory.view', labelKey: 'navSearch.tab.stockLevels', title: 'Stock levels' },
      { key: 'alerts', legacy: '/inventory-alerts', permission: 'inventory.view', labelKey: 'navSearch.tab.alerts', title: 'Alerts' },
    ],
  },
  catalog: {
    path: '/inventory/catalog',
    section: 'feed',
    group: 'stock',
    labelKey: 'navSearch.item.catalog',
    title: 'Items + lots',
    tabs: [
      { key: 'items', legacy: '/inventory/items', permission: 'inventory.view', labelKey: 'navSearch.tab.items', title: 'Items' },
      { key: 'lots', legacy: '/inventory/lots', permission: 'inventory.view', labelKey: 'navSearch.tab.lots', title: 'Lots' },
    ],
  },
  regional: {
    path: '/regional-reports',
    section: 'analytics',
    group: 'build',
    labelKey: 'navSearch.item.regional',
    title: 'Regional + group reports',
    tabs: [
      { key: 'regions', legacy: '/reports/regions', permission: 'reports.view', labelKey: 'navSearch.tab.regional', title: 'Regional' },
      { key: 'group', legacy: '/group-reports', permission: 'group.reports.view', labelKey: 'navSearch.tab.group', title: 'Group' },
    ],
  },
  settings: {
    path: '/settings',
    section: 'management',
    group: 'organization',
    labelKey: 'navSearch.item.settings',
    title: 'Company + global settings',
    tabs: [
      { key: 'company', legacy: '/company-settings', permission: 'org.settings.manage', labelKey: 'navSearch.tab.company', title: 'Company' },
      { key: 'global', legacy: '/global-settings', labelKey: 'navSearch.tab.global', title: 'Global' },
    ],
  },
  people: {
    path: '/people',
    section: 'management',
    group: 'people',
    labelKey: 'navSearch.item.people',
    title: 'Users + roles',
    tabs: [
      { key: 'members', legacy: '/users', permission: 'org.members.manage', labelKey: 'navSearch.tab.users', title: 'Users' },
      { key: 'roles', legacy: '/users', legacyQuery: { view: 'roles' }, permission: 'org.members.manage', labelKey: 'navSearch.tab.roles', title: 'Roles' },
    ],
  },
  integrations: {
    path: '/integrations',
    section: 'management',
    group: 'connections',
    labelKey: 'navSearch.item.integrations',
    title: 'API keys + webhooks',
    tabs: [
      { key: 'keys', legacy: '/api-keys', permission: 'integrations.manage', labelKey: 'settingsUi.integ.nav.keys', title: 'API keys' },
      { key: 'outbound', legacy: '/webhooks', permission: 'integrations.manage', labelKey: 'settingsUi.integ.nav.outbound', title: 'Webhooks' },
      { key: 'inbound', legacy: '/inbound-webhooks', permission: 'integrations.manage', labelKey: 'settingsUi.integ.nav.inbound', title: 'Inbound webhooks' },
      { key: 'docs', legacy: '/api-docs', permission: 'integrations.manage', labelKey: 'settingsUi.integ.nav.docs', title: 'API docs' },
    ],
  },
}

/** Permissions of a group's tabs; a member sees the page when any tab is open to them. */
export function groupPermissions(groupKey) {
  const group = TAB_GROUPS[groupKey]
  if (!group) return []
  return group.tabs.map((tab) => tab.permission ?? null)
}

/** The tabs of a group the member may open (`can(null)` is true). */
export function visibleTabs(groupKey, can = () => true) {
  const group = TAB_GROUPS[groupKey]
  if (!group) return []
  return group.tabs.filter((tab) => can(tab.permission ?? null))
}

/** The tab shown for `requested` (a tab key), falling back to the first open one. */
export function resolveTab(groupKey, requested, can = () => true) {
  const tabs = visibleTabs(groupKey, can)
  return tabs.find((tab) => tab.key === requested) || tabs[0] || null
}

/**
 * The group's Import link for a tab: Records' Daily, Sampling and Stockings
 * tabs open Bulk import on the matching tab (`?kind=`); other tabs open its
 * default (daily). Null when the group has no Import button.
 */
export function importHrefFor(groupKey, tabKey) {
  const group = TAB_GROUPS[groupKey]
  if (!group?.importHref) return null
  const kind = group.importKinds?.[tabKey]
  return kind && kind !== 'daily' ? `${group.importHref}?kind=${kind}` : group.importHref
}

export function tabHref(groupKey, tabKey) {
  const group = TAB_GROUPS[groupKey]
  return group ? `${group.path}/${tabKey}` : null
}

const QUERY_KEYS_OWNED = new Set(['view'])

/**
 * Where an old route now lives: `{ pathname, query }` for router.replace, or
 * null when the route is not a joined page (or, for /users, when it shows one
 * member). `query` keeps the old route's other parameters.
 */
export function legacyTabTarget(pathname, query = {}) {
  for (const [groupKey, group] of Object.entries(TAB_GROUPS)) {
    const matches = group.tabs.filter((tab) => tab.legacy === pathname)
    if (matches.length === 0) continue
    if (groupKey === 'people' && query.member) return null
    const tab =
      matches.find((m) => m.legacyQuery && Object.entries(m.legacyQuery).every(([k, v]) => query[k] === v)) ||
      matches.find((m) => !m.legacyQuery)
    if (!tab) return null
    const rest = {}
    for (const [k, v] of Object.entries(query)) {
      if (tab.legacyQuery && k in tab.legacyQuery) continue
      if (groupKey === 'people' && QUERY_KEYS_OWNED.has(k)) continue
      rest[k] = v
    }
    return { pathname: tabHref(groupKey, tab.key), query: rest }
  }
  return null
}

/** The group and tab a path belongs to (`/records/daily` → records/daily), or null. */
export function groupOfPath(path) {
  const clean = String(path || '').split(/[?#]/, 1)[0]
  for (const [groupKey, group] of Object.entries(TAB_GROUPS)) {
    if (clean === group.path || clean.startsWith(`${group.path}/`)) {
      return { groupKey, tabKey: clean.slice(group.path.length + 1).split('/')[0] || null }
    }
  }
  return null
}
