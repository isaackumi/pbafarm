/**
 * Route tabs for the Paper section headers (09 Feed & inventory, 51 Inventory,
 * 10 Finance, 11 Reports). NavTabs hides tabs the member can't open.
 */
export const feedTabs = (t) => [
  { href: '/feed-management', label: t('ops.tab.overview') },
  { href: '/stock-levels', label: t('ops.tab.stockLevels') },
  { href: '/feed-purchases', label: t('ops.tab.purchases') },
  { href: '/procurement', label: t('ops.tab.purchaseOrders') },
  { href: '/feed-suppliers', label: t('ops.tab.suppliers') },
  { href: '/feed-types', label: t('ops.tab.feedTypes') },
  { href: '/feeding-plans', label: t('ops.tab.feedingPlans') },
  { href: '/feed-management/overview', label: t('ops.tab.trends') },
  { href: '/feed-management/analytics', label: t('ops.tab.analytics') },
]

export const inventoryTabs = (t) => [
  { href: '/inventory/overview', label: t('ops.tab.overview') },
  { href: '/inventory/items', label: t('ops.tab.items') },
  { href: '/inventory/lots', label: t('ops.tab.lots') },
  { href: '/inventory/counts', label: t('ops.tab.counts') },
  { href: '/inventory/adjust', label: t('ops.tab.adjustments') },
  { href: '/inventory-transactions', label: t('ops.tab.transactions') },
  { href: '/inventory-alerts', label: t('ops.tab.alerts') },
  { href: '/inventory/analytics', label: t('ops.tab.analytics') },
]

export const financeTabs = (t) => [
  { href: '/pnl', label: t('ops.tab.pnl') },
  { href: '/sales', label: t('ops.tab.sales') },
  { href: '/expenses', label: t('ops.tab.expenses') },
  { href: '/accounting-export', label: t('ops.tab.accountingExport') },
]

export const reportTabs = (t) => [
  { href: '/reports', label: t('ops.tab.library') },
  { href: '/report', label: t('ops.tab.production') },
  { href: '/reports/regions', label: t('ops.tab.regions') },
  { href: '/group-reports', label: t('ops.tab.group') },
  { href: '/analytics', label: t('ops.tab.analytics') },
]
