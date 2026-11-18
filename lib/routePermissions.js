/**
 * Which permission opens each page (UX-007, PERM-003). The Sidebar, the
 * phone tab bar and page guards use the same keys; lib/routePermissions.test.js
 * keeps this list in step with them. Link-style buttons, "related" links and
 * empty-state shortcuts use it so nobody is offered a page they would be
 * bounced from. The server enforces every permission regardless.
 */
export const ROUTE_PERMISSIONS = {
  '/analytics': 'reports.view',
  '/api-docs': 'integrations.manage',
  '/api-keys': 'integrations.manage',
  '/approvals': 'production.stocking.approve',
  '/audit-logs': 'org.audit.view',
  '/automations': 'automation.manage',
  '/biweekly-entry': 'production.sampling.record',
  '/biweekly-records': 'production.view',
  '/bulk-upload': 'production.import',
  '/cages': 'production.view',
  '/cages/analytics': 'production.view',
  '/cages/qr-codes': 'production.view',
  '/cages/settings': 'production.units.manage',
  '/company-settings': 'org.settings.manage',
  '/compliance': 'production.view',
  '/create-cage': 'production.units.manage',
  '/customization': 'customization.manage',
  '/daily-data': 'production.view',
  '/daily-entry': 'production.daily.record',
  '/dashboard': 'reports.view',
  '/expenses': 'finance.view',
  '/export': 'reports.export',
  '/farm-locations': 'org.sites.manage',
  '/feed-issue': 'inventory.issue',
  '/feeding-plans': 'production.view',
  '/feed-management': 'inventory.view',
  '/feed-management/analytics': 'inventory.view',
  '/feed-purchases': 'inventory.view',
  '/feed-suppliers': 'inventory.view',
  '/feed-types': 'inventory.view',
  '/fish-transfers': 'production.view',
  '/group-reports': 'group.reports.view',
  '/harvest': 'production.view',
  '/harvest-sampling': 'production.harvest.record',
  '/health': 'production.view',
  '/inventory-alerts': 'inventory.view',
  '/inventory-transactions': 'inventory.view',
  '/inventory/adjust': 'inventory.adjust',
  '/inventory/analytics': 'inventory.view',
  '/inventory/counts': 'inventory.issue',
  '/inventory/items': 'inventory.view',
  '/inventory/lots': 'inventory.view',
  '/inventory/overview': 'inventory.view',
  '/maintenance': 'production.view',
  '/messaging-settings': 'integrations.manage',
  '/organization-structure': 'org.structure.manage',
  '/pending-approval': 'production.stocking.approve',
  '/pnl': 'finance.view',
  '/procurement': 'inventory.view',
  '/report': 'reports.view',
  '/reports/regions': 'reports.view',
  '/sales': 'finance.view',
  '/species': 'org.settings.manage',
  '/stock-levels': 'inventory.view',
  '/stocking': 'production.stocking.request',
  '/stocking-management': 'production.view',
  '/teams': 'workforce.view',
  '/trace': 'production.view',
  '/units': 'production.view',
  '/units/groups': 'production.view',
  '/units/map': 'production.view',
  '/users': 'org.members.manage',
  '/water-quality': 'production.view',
  '/webhooks': 'integrations.manage',
  '/workforce': 'workforce.view',
}

/** Quick-create dialogs in DependencyEmpty and the mutation permission they need. */
export const CREATE_PERMISSIONS = {
  cage: 'production.units.manage',
  feedType: 'inventory.purchase.record',
  stocking: 'production.stocking.request',
  purchase: 'inventory.purchase.record',
}

/** The permission needed to open `href` (path, query and hash ignored), or null. */
export function routePermission(href) {
  if (typeof href !== 'string' || !href.startsWith('/')) return null
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  return ROUTE_PERMISSIONS[path] || null
}
