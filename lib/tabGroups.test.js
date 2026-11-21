import { describe, expect, it } from 'vitest'
import { ROUTE_PERMISSIONS } from './routePermissions'
import { TAB_GROUPS, groupOfPath, importHrefFor, legacyTabTarget, resolveTab, tabHref, visibleTabs } from './tabGroups'
import { IMPORT_KINDS } from './csvImport'

const only = (...perms) => (p) => p == null || perms.includes(p)

describe('TAB_GROUPS', () => {
  it('gives every tab the permission of the page it reuses', () => {
    for (const group of Object.values(TAB_GROUPS)) {
      for (const tab of group.tabs) {
        expect([tab.legacy, tab.permission ?? null]).toEqual([tab.legacy, ROUTE_PERMISSIONS[tab.legacy] ?? null])
      }
    }
  })

  it('joins the pages Paper 71b joins with "+"', () => {
    expect(TAB_GROUPS.records.tabs.map((t) => t.legacy)).toEqual(['/daily-data', '/biweekly-records', '/stocking-management', '/fish-transfers'])
    expect(TAB_GROUPS.catalog.tabs.map((t) => t.legacy)).toEqual(['/inventory/items', '/inventory/lots'])
    expect(TAB_GROUPS.stock.tabs.map((t) => t.legacy)).toEqual(['/stock-levels', '/inventory-alerts'])
    expect(TAB_GROUPS.feedSetup.tabs.map((t) => t.legacy)).toEqual(['/feed-types', '/feeding-plans'])
    expect(TAB_GROUPS.integrations.tabs.map((t) => t.legacy)).toEqual(['/api-keys', '/webhooks', '/inbound-webhooks', '/api-docs'])
    expect(TAB_GROUPS.settings.tabs.map((t) => t.legacy)).toEqual(['/company-settings', '/global-settings'])
    expect(TAB_GROUPS.feedAnalytics.tabs.map((t) => t.legacy)).toEqual(['/feed-management/analytics', '/inventory/analytics'])
  })
})

describe('visibleTabs / resolveTab', () => {
  it('hides tabs the member cannot open', () => {
    expect(visibleTabs('settings', only()).map((t) => t.key)).toEqual(['global'])
    expect(visibleTabs('feedSetup', only('production.view')).map((t) => t.key)).toEqual(['plans'])
  })

  it('falls back to the first open tab', () => {
    expect(resolveTab('records', 'nope').key).toBe('daily')
    expect(resolveTab('records', 'transfers').key).toBe('transfers')
    expect(resolveTab('feedSetup', 'types', only('production.view')).key).toBe('plans')
    expect(resolveTab('people', 'members', only())).toBeNull()
  })
})

describe('legacyTabTarget', () => {
  it('sends old routes to their tab and keeps the query', () => {
    expect(legacyTabTarget('/daily-data', {})).toEqual({ pathname: '/records/daily', query: {} })
    expect(legacyTabTarget('/fish-transfers', { source: 'c1' })).toEqual({ pathname: '/records/transfers', query: { source: 'c1' } })
    expect(legacyTabTarget('/stocking-management', { tab: 'history' })).toEqual({
      pathname: '/records/stockings',
      query: { tab: 'history' },
    })
    expect(legacyTabTarget('/inventory/lots', {}).pathname).toBe('/inventory/catalog/lots')
  })

  it('maps /users views and leaves one member alone', () => {
    expect(legacyTabTarget('/users', {})).toEqual({ pathname: '/people/members', query: {} })
    expect(legacyTabTarget('/users', { view: 'roles' })).toEqual({ pathname: '/people/roles', query: {} })
    expect(legacyTabTarget('/users', { member: 'u1' })).toBeNull()
  })

  it('ignores other routes', () => {
    expect(legacyTabTarget('/daily-entry', {})).toBeNull()
    expect(legacyTabTarget('/records/[[...groupTab]]', {})).toBeNull()
  })
})

describe('tabHref / groupOfPath', () => {
  it('round-trips', () => {
    expect(tabHref('stock', 'alerts')).toBe('/stock/alerts')
    expect(groupOfPath('/stock/alerts?x=1')).toEqual({ groupKey: 'stock', tabKey: 'alerts' })
    expect(groupOfPath('/records')).toEqual({ groupKey: 'records', tabKey: null })
    expect(groupOfPath('/stocking')).toBeNull()
  })
})

describe('importHrefFor (Paper 71b Import button, Paper 53 tabs)', () => {
  it('opens Bulk import on the tab matching the Records tab', () => {
    expect(importHrefFor('records', 'daily')).toBe('/bulk-upload')
    expect(importHrefFor('records', 'sampling')).toBe('/bulk-upload?kind=biweekly')
    expect(importHrefFor('records', 'stockings')).toBe('/bulk-upload?kind=stocking')
    expect(importHrefFor('records', 'transfers')).toBe('/bulk-upload')
    expect(importHrefFor('records', undefined)).toBe('/bulk-upload')
    expect(importHrefFor('feedSetup', 'types')).toBeNull()
    for (const kind of Object.values(TAB_GROUPS.records.importKinds)) expect(IMPORT_KINDS).toContain(kind)
  })
})
