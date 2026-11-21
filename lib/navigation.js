// Drawer and phone tab bar destinations (UX-004). Each `permission` must match
// lib/routePermissions.js ROUTE_PERMISSIONS (checked by its test).
import {
  Activity,
  Calculator,
  BellRing,
  Building2,
  Calendar,
  CreditCard,
  ChartColumn,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Crosshair,
  Database,
  Download,
  Eye,
  FileText,
  Fish,
  Globe,
  HeartPulse,
  IdCard,
  House,
  KeyRound,
  LayoutGrid,
  List,
  ListTodo,
  MapPin,
  MessageSquare,
  Network,
  Package,
  Plus,
  QrCode,
  Receipt,
  Scale,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  TrendingUp,
  TriangleAlert,
  Truck,
  Upload,
  Users,
  UsersRound,
  Waves,
  Zap,
  FolderKanban,
} from 'lucide-react'
import { AnowaPulseIcon } from '../components/brand/AnowaPulseIcon'
import {
  CagesIcon,
  FeedIcon,
  FinanceIcon,
  HatcheryIcon,
  HomeIcon,
  ProductionIcon,
  ReportsIcon,
  SettingsIcon,
  TasksIcon,
} from './navIcons'
import { MAX_MOBILE_SHORTCUTS } from '../convex/lib/userPreferences'
import { legacyTabTarget, visibleTabs } from './tabGroups'

// Grouped to match the Paper shell (Shell 7Z-0) and the grouped sidebar
// (Paper 71 TP8-1 / 71b TTA-1): Home, My tasks, Ask Anowa, Calendar, Cages,
// Production, Feed & inventory, Finance, Hatchery, Reports, Settings.
// `direct` sections render as a single link row. Inside a section, items sit
// under `groups` (a small label shows only when a section has 2+ groups).
// `labelKey` gives the Paper label in the sidebar while `title`/navKey stay
// the page name. Items with `tabGroup` open a tabbed page (lib/tabGroups):
// the member sees them when any of its tabs is open to them.
export const MENU_SECTIONS = {
  home: {
    title: 'Home',
    icon: HomeIcon,
    direct: true,
    items: [
      { title: 'Dashboard', path: '/dashboard', permission: 'reports.view', icon: House, tourId: 'dashboard', shortLabelKey: 'nav.home', labelKey: 'nav.home' },
    ],
  },
  tasks: {
    title: 'My tasks',
    icon: TasksIcon,
    direct: true,
    items: [{ title: 'My Tasks', path: '/tasks', icon: ListTodo }],
  },
  // Ask Anowa (the AI assistant, ANLY-005): a direct row so it is always one
  // click away. The page itself explains how to turn Anowa on when it is off.
  anowa: {
    title: 'Ask Anowa',
    icon: AnowaPulseIcon,
    direct: true,
    items: [{ title: 'Ask Anowa', path: '/assistant', permission: 'ai.use', icon: AnowaPulseIcon }],
  },
  calendar: {
    title: 'Calendar',
    icon: Calendar,
    direct: true,
    items: [{ title: 'Calendar', path: '/calendar', permission: 'production.view', icon: Calendar }],
  },
  // "Create cage" and Cages "Settings" live in the Cages page header (71b).
  cages: {
    title: 'Cages',
    icon: CagesIcon,
    tourId: 'cages-section',
    groups: [
      { key: 'units', title: 'Units' },
      { key: 'equipment', title: 'Equipment' },
    ],
    items: [
      { title: 'All Cages', path: '/cages', permission: 'production.view', icon: Database, tourId: 'cages', shortLabelKey: 'nav.cages', group: 'units', labelKey: 'navSearch.item.allCages' },
      { title: 'Unit board', path: '/units', permission: 'production.view', icon: LayoutGrid, group: 'units' },
      { title: 'Groups', path: '/units/groups', permission: 'production.view', icon: List, group: 'units' },
      { title: 'Site map', path: '/units/map', permission: 'production.view', icon: Crosshair, group: 'units' },
      { title: 'Cage keepers', path: '/cage-keepers', permission: 'production.keepers.manage', icon: Users, group: 'units' },
      { title: 'Analytics', path: '/cages/analytics', permission: 'production.view', icon: ChartColumn, group: 'units' },
      { title: 'Sensors', path: '/sensors', permission: 'production.view', icon: Activity, group: 'equipment' },
      { title: 'Maintenance', path: '/maintenance', permission: 'production.view', icon: Settings, group: 'equipment' },
      { title: 'QR codes', path: '/cages/qr-codes', permission: 'production.view', icon: QrCode, group: 'equipment' },
    ],
  },
  production: {
    title: 'Production',
    icon: ProductionIcon,
    tourId: 'production',
    groups: [
      { key: 'record', title: 'Record' },
      { key: 'watch', title: 'Watch' },
      { key: 'review', title: 'Review & plan' },
    ],
    items: [
      { title: 'Daily Entry', path: '/daily-entry', permission: 'production.daily.record', icon: Calendar, tourId: 'daily-entry', shortLabelKey: 'nav.dailyEntry', labelKey: 'nav.paper.dailyEntry', group: 'record' },
      { title: 'Bi-weekly Entry', path: '/biweekly-entry', permission: 'production.sampling.record', icon: Scale, tourId: 'biweekly-entry', labelKey: 'nav.paper.sampling', group: 'record' },
      { title: 'New Stocking', path: '/stocking', permission: 'production.stocking.request', icon: Plus, tourId: 'stocking', labelKey: 'nav.paper.stocking', group: 'record' },
      { title: 'Harvest Data', path: '/harvest', permission: 'production.view', icon: Package, tourId: 'harvest', labelKey: 'nav.paper.harvest', group: 'record' },
      { title: 'Alerts & insights', path: '/alerts', permission: 'production.view', icon: BellRing, labelKey: 'navSearch.item.alerts', group: 'watch', count: 'openAlerts' },
      { title: 'Health', path: '/health', permission: 'production.view', icon: HeartPulse, tourId: 'health', labelKey: 'nav.paper.health', group: 'watch' },
      { title: 'Approvals', path: '/approvals', permission: 'production.stocking.approve', icon: CircleCheck, tourId: 'approvals', group: 'watch', count: 'approvals' },
      { title: 'Compliance', path: '/compliance', permission: 'production.view', icon: ClipboardList, group: 'watch' },
      { title: 'Records', path: '/records', tabGroup: 'records', icon: ClipboardList, tourId: 'records', labelKey: 'navSearch.item.records', group: 'review' },
      { title: 'Harvest Lots', path: '/trace', permission: 'production.view', icon: Package, labelKey: 'navSearch.item.harvestLots', group: 'review' },
      { title: 'Cycle planner', path: '/cycle-planner', permission: 'production.plan.manage', icon: TrendingUp, group: 'review' },
    ],
  },
  feed: {
    title: 'Feed & inventory',
    icon: FeedIcon,
    tourId: 'feed-section',
    groups: [
      { key: 'feed', title: 'Feed' },
      { key: 'buying', title: 'Buying' },
      { key: 'stock', title: 'Stock' },
    ],
    items: [
      { title: 'Overview', path: '/feed-management', permission: 'inventory.view', icon: ChartColumn, tourId: 'feed-management', group: 'feed' },
      { title: 'Issue Feed', path: '/feed-issue', permission: 'inventory.issue', icon: Package, tourId: 'feed-issue', shortLabelKey: 'nav.feed', labelKey: 'navSearch.item.issueFeed', group: 'feed' },
      { title: 'Feed types + feeding plans', path: '/feed-setup', tabGroup: 'feedSetup', icon: List, tourId: 'feed-types', labelKey: 'navSearch.item.feedSetup', group: 'feed' },
      { title: 'Analytics (feed + stock)', path: '/feed-analytics', tabGroup: 'feedAnalytics', icon: TrendingUp, labelKey: 'navSearch.item.feedAnalytics', group: 'feed' },
      { title: 'Purchase Orders', path: '/procurement', permission: 'inventory.view', icon: ClipboardList, labelKey: 'navSearch.item.purchaseOrders', group: 'buying' },
      { title: 'Purchases', path: '/feed-purchases', permission: 'inventory.view', icon: ShoppingCart, tourId: 'feed-purchases', group: 'buying' },
      { title: 'Suppliers', path: '/feed-suppliers', permission: 'inventory.view', icon: Truck, tourId: 'feed-suppliers', group: 'buying' },
      { title: 'Stock levels + alerts', path: '/stock', tabGroup: 'stock', icon: Package, tourId: 'stock-levels', labelKey: 'navSearch.item.stock', group: 'stock' },
      { title: 'Items + lots', path: '/inventory/catalog', tabGroup: 'catalog', icon: List, tourId: 'inventory-lots', labelKey: 'navSearch.item.catalog', group: 'stock' },
      { title: 'Adjust / Transfer', path: '/inventory/adjust', permission: 'inventory.adjust', icon: Package, tourId: 'inventory-adjust', labelKey: 'navSearch.item.adjust', group: 'stock' },
      { title: 'Stock Counts', path: '/inventory/counts', permission: 'inventory.issue', icon: ClipboardList, labelKey: 'navSearch.item.counts', group: 'stock' },
      { title: 'Transactions', path: '/inventory-transactions', permission: 'inventory.view', icon: FileText, tourId: 'inventory-transactions', group: 'stock' },
    ],
  },
  finance: {
    title: 'Finance',
    icon: FinanceIcon,
    items: [
      { title: 'Sales', path: '/sales', permission: 'finance.view', icon: ShoppingCart, tourId: 'sales' },
      { title: 'Expenses', path: '/expenses', permission: 'finance.view', icon: Receipt },
      { title: 'Cage P&L', path: '/pnl', permission: 'finance.view', icon: TrendingUp, tourId: 'pnl' },
      { title: 'Projects', path: '/projects', permission: 'projects.view', icon: FolderKanban },
      { title: 'Accounting export', path: '/accounting-export', permission: 'reports.export', icon: Calculator },
    ],
  },
  hatchery: {
    title: 'Hatchery',
    icon: HatcheryIcon,
    items: [
      { title: 'Overview', path: '/hatchery', icon: House },
      { title: 'Broodstock', path: '/hatchery/broodstock', icon: Fish },
      { title: 'New spawning', path: '/hatchery/spawning', icon: Plus, labelKey: 'navSearch.item.spawning' },
      { title: 'Larvae & fingerlings', path: '/hatchery/larval', icon: Waves },
      { title: 'Live feed', path: '/hatchery/live-feed', icon: ClipboardList },
    ],
  },
  analytics: {
    title: 'Reports',
    icon: ReportsIcon,
    tourId: 'reports-section',
    groups: [
      { key: 'read', title: 'Read' },
      { key: 'build', title: 'Build' },
    ],
    items: [
      { title: 'Weekly report', path: '/weekly-report', permission: 'reports.view', icon: FileText, group: 'read' },
      { title: 'Production Report', path: '/report', permission: 'reports.view', icon: FileText, tourId: 'report', labelKey: 'navSearch.item.productionReport', group: 'read' },
      { title: 'Analytics', path: '/analytics', permission: 'reports.view', icon: ChartColumn, group: 'read' },
      { title: 'Report Builder', path: '/reports', permission: 'reports.view', icon: ChartColumn, labelKey: 'navSearch.item.reportBuilder', group: 'build' },
      { title: 'Regional + group reports', path: '/regional-reports', tabGroup: 'regional', icon: MapPin, labelKey: 'navSearch.item.regional', group: 'build' },
      { title: 'Export Data', path: '/export', permission: 'reports.export', icon: Download, labelKey: 'navSearch.item.exportData', group: 'build' },
    ],
  },
  management: {
    title: 'Settings',
    icon: SettingsIcon,
    tourId: 'management-section',
    groups: [
      { key: 'organization', title: 'Organization' },
      { key: 'people', title: 'People' },
      { key: 'setup', title: 'Farm setup' },
      { key: 'connections', title: 'Connections' },
    ],
    items: [
      { title: 'Company + global settings', path: '/settings', tabGroup: 'settings', icon: Building2, tourId: 'company-settings', labelKey: 'navSearch.item.settings', group: 'organization' },
      { title: 'Farm Locations', path: '/farm-locations', permission: 'org.sites.manage', icon: MapPin, tourId: 'farm-locations', labelKey: 'navSearch.item.farmLocations', group: 'organization' },
      { title: 'Organization Structure', path: '/organization-structure', permission: 'org.structure.manage', icon: Network, labelKey: 'navSearch.item.structure', group: 'organization' },
      { title: 'Billing', path: '/billing', permission: 'org.settings.manage', icon: CreditCard, group: 'organization' },
      { title: 'Audit Logs', path: '/audit-logs', permission: 'org.audit.view', icon: Eye, tourId: 'audit-logs', labelKey: 'navSearch.item.auditLog', group: 'organization' },
      { title: 'Users + roles', path: '/people', tabGroup: 'people', icon: Users, labelKey: 'navSearch.item.people', group: 'people' },
      { title: 'Teams', path: '/teams', permission: 'workforce.view', icon: UsersRound, group: 'people' },
      { title: 'Workforce', path: '/workforce', permission: 'workforce.view', icon: IdCard, group: 'people' },
      { title: 'Species', path: '/species', permission: 'org.settings.manage', icon: Fish, group: 'setup' },
      { title: 'Customization', path: '/customization', permission: 'customization.manage', icon: SlidersHorizontal, group: 'setup' },
      { title: 'Automations', path: '/automations', permission: 'automation.manage', icon: Zap, group: 'setup' },
      { title: 'Messaging', path: '/messaging-settings', permission: 'integrations.manage', icon: MessageSquare, group: 'connections' },
      { title: 'AI settings', path: '/ai-settings', permission: 'integrations.manage', icon: AnowaPulseIcon, group: 'connections' },
      { title: 'API keys + webhooks', path: '/integrations', tabGroup: 'integrations', icon: KeyRound, labelKey: 'navSearch.item.integrations', group: 'connections' },
    ],
  },
  admin: {
    title: 'Admin',
    icon: ShieldCheck,
    superAdminOnly: true,
    items: [
      { title: 'Admin Dashboard', path: '/admin/admin', icon: House },
      { title: 'Registrations', path: '/admin/company-registrations', icon: Building2 },
    ],
  },
}

/**
 * Pages that left the sidebar in Paper 71 but stay one search (and one phone
 * shortcut) away: actions moved to page headers and pages reached from
 * another page. `section` gives the search result its place.
 */
export const EXTRA_DESTINATIONS = [
  { title: 'My cages', path: '/my-cages', permission: 'production.daily.record', icon: ClipboardCheck, section: 'production', group: 'record' },
  { title: 'Water quality', path: '/water-quality', permission: 'production.view', icon: Waves, section: 'production', group: 'watch' },
  { title: 'Harvest Sampling', path: '/harvest-sampling', permission: 'production.harvest.record', icon: Crosshair, section: 'production', group: 'record' },
  { title: 'Bulk Upload', path: '/bulk-upload', permission: 'production.import', icon: Upload, section: 'production', group: 'review', labelKey: 'navSearch.item.import' },
  { title: 'Create Cage', path: '/create-cage', permission: 'production.units.manage', icon: Plus, section: 'cages', group: 'units' },
  { title: 'Settings', path: '/cages/settings', permission: 'production.units.manage', icon: Settings, section: 'cages', group: 'units', labelKey: 'navSearch.item.cageSettings' },
  { title: 'Inventory overview', path: '/inventory/overview', permission: 'inventory.view', icon: ChartColumn, section: 'feed', group: 'stock', labelKey: 'nav.paper.inventoryOverview' },
  { title: 'Trends', path: '/feed-management/overview', permission: 'inventory.view', icon: TrendingUp, section: 'feed', group: 'feed', labelKey: 'ops.tab.trends' },
]

/** True when the member may open `item` (a tabbed page: any of its tabs). */
export function canOpenItem(item, can = () => true) {
  if (!item) return false
  if (item.tabGroup) return visibleTabs(item.tabGroup, can).length > 0
  return can(item.permission)
}

/** Every place a member can pin to the phone tab bar (not super-admin pages). */
export const NAV_ITEMS = [
  ...Object.entries(MENU_SECTIONS)
    .filter(([, section]) => !section.superAdminOnly)
    .flatMap(([section, { items }]) => items.map((item) => ({ ...item, section }))),
  ...EXTRA_DESTINATIONS,
]

const NAV_BY_PATH = new Map(NAV_ITEMS.map((item) => [item.path, item]))

/** Tab bar when the member has not chosen their own. */
export const DEFAULT_SHORTCUTS = ['/dashboard', '/daily-entry', '/cages', '/feed-issue']

export { MAX_MOBILE_SHORTCUTS }

/**
 * The tab bar for this member: their saved choice (null = defaults), minus
 * places they may not open or that no longer exist, at most
 * MAX_MOBILE_SHORTCUTS, in the order chosen.
 */
export function resolveShortcuts(saved, can = () => true) {
  const paths = Array.isArray(saved) ? saved : DEFAULT_SHORTCUTS
  const seen = new Set()
  const out = []
  for (const saved of paths) {
    // A shortcut to a page now shown as a tab follows it to its tabbed page.
    const path = typeof saved === 'string' ? legacyTabTarget(saved)?.pathname.replace(/\/[^/]+$/, '') || saved : saved
    const item = NAV_BY_PATH.get(path)
    if (!item || seen.has(path) || !canOpenItem(item, can)) continue
    seen.add(path)
    out.push(item)
    if (out.length >= MAX_MOBILE_SHORTCUTS) break
  }
  return out
}
