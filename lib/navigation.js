// Drawer and phone tab bar destinations (UX-004). Each `permission` must match
// lib/routePermissions.js ROUTE_PERMISSIONS (checked by its test).
import {
  Activity,
  Calculator,
  Sparkles,
  ArrowLeftRight,
  BellRing,
  Building2,
  Calendar,
  CreditCard,
  ChartColumn,
  CircleCheck,
  ClipboardList,
  Crosshair,
  Database,
  Download,
  Egg,
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
  Webhook,
  Zap,
} from 'lucide-react'
import {
  CagesIcon,
  FeedIcon,
  FinanceIcon,
  HomeIcon,
  ProductionIcon,
  ReportsIcon,
  SettingsIcon,
  TasksIcon,
} from './navIcons'
import { MAX_MOBILE_SHORTCUTS } from '../convex/lib/userPreferences'

// Grouped to match the Paper shell (docs/design/paper-redesign, Shell 7Z-0):
// Home, My tasks, Cages, Production, Feed & inventory, Finance, Reports,
// Settings. `direct` sections render as a single link row. `labelKey` gives
// the Paper label in the sidebar while `title`/navKey stay the page name.
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
    icon: Sparkles,
    direct: true,
    items: [{ title: 'Ask Anowa', path: '/assistant', permission: 'ai.use', icon: Sparkles }],
  },
  calendar: {
    title: 'Calendar',
    icon: Calendar,
    direct: true,
    items: [{ title: 'Calendar', path: '/calendar', permission: 'production.view', icon: Calendar }],
  },
  cages: {
    title: 'Cages',
    icon: CagesIcon,
    tourId: 'cages-section',
    items: [
      { title: 'All Cages', path: '/cages', permission: 'production.view', icon: Database, tourId: 'cages', shortLabelKey: 'nav.cages' },
      { title: 'Unit board', path: '/units', permission: 'production.view', icon: LayoutGrid },
      { title: 'Groups', path: '/units/groups', permission: 'production.view', icon: List },
      { title: 'Site map', path: '/units/map', permission: 'production.view', icon: Crosshair },
      { title: 'Sensors', path: '/sensors', permission: 'production.view', icon: Activity },
      { title: 'Maintenance', path: '/maintenance', permission: 'production.view', icon: Settings },
      { title: 'Analytics', path: '/cages/analytics', permission: 'production.view', icon: ChartColumn },
      { title: 'QR codes', path: '/cages/qr-codes', permission: 'production.view', icon: QrCode },
      { title: 'Settings', path: '/cages/settings', permission: 'production.units.manage', icon: Settings },
      { title: 'Create Cage', path: '/create-cage', permission: 'production.units.manage', icon: Plus, tourId: 'create-cage' },
    ],
  },
  production: {
    title: 'Production',
    icon: ProductionIcon,
    tourId: 'production',
    items: [
      { title: 'Daily Entry', path: '/daily-entry', permission: 'production.daily.record', icon: Calendar, tourId: 'daily-entry', shortLabelKey: 'nav.dailyEntry', labelKey: 'nav.paper.dailyEntry' },
      { title: 'Bi-weekly Entry', path: '/biweekly-entry', permission: 'production.sampling.record', icon: Scale, tourId: 'biweekly-entry', labelKey: 'nav.paper.sampling' },
      { title: 'New Stocking', path: '/stocking', permission: 'production.stocking.request', icon: Plus, tourId: 'stocking', labelKey: 'nav.paper.stocking' },
      { title: 'Alerts & insights', path: '/alerts', permission: 'production.view', icon: BellRing },
      { title: 'Health', path: '/health', permission: 'production.view', icon: HeartPulse, tourId: 'health', labelKey: 'nav.paper.health' },
      { title: 'Harvest Data', path: '/harvest', permission: 'production.view', icon: Package, tourId: 'harvest', labelKey: 'nav.paper.harvest' },
      { title: 'Cycle planner', path: '/cycle-planner', permission: 'production.plan.manage', icon: TrendingUp },
      { title: 'Daily Records', path: '/daily-data', permission: 'production.view', icon: ClipboardList },
      { title: 'Bi-weekly Records', path: '/biweekly-records', permission: 'production.view', icon: FileText, tourId: 'biweekly-records' },
      { title: 'Stocking Management', path: '/stocking-management', permission: 'production.view', icon: Waves, tourId: 'stocking-management' },
      { title: 'Fish Transfers', path: '/fish-transfers', permission: 'production.view', icon: ArrowLeftRight, tourId: 'fish-transfers' },
      { title: 'Water quality', path: '/water-quality', permission: 'production.view', icon: Waves },
      { title: 'Harvest Sampling', path: '/harvest-sampling', permission: 'production.harvest.record', icon: Crosshair },
      { title: 'Harvest Lots', path: '/trace', permission: 'production.view', icon: Package },
      { title: 'Compliance', path: '/compliance', permission: 'production.view', icon: ClipboardList },
      { title: 'Approvals', path: '/approvals', permission: 'production.stocking.approve', icon: CircleCheck, tourId: 'approvals' },
      { title: 'Bulk Upload', path: '/bulk-upload', permission: 'production.import', icon: Upload },
    ],
  },
  feed: {
    title: 'Feed & inventory',
    icon: FeedIcon,
    tourId: 'feed-section',
    items: [
      { title: 'Overview', path: '/feed-management', permission: 'inventory.view', icon: ChartColumn, tourId: 'feed-management', labelKey: 'nav.paper.feedOverview' },
      { title: 'Feed Types', path: '/feed-types', permission: 'inventory.view', icon: List, tourId: 'feed-types' },
      { title: 'Suppliers', path: '/feed-suppliers', permission: 'inventory.view', icon: Truck, tourId: 'feed-suppliers' },
      { title: 'Purchases', path: '/feed-purchases', permission: 'inventory.view', icon: ShoppingCart, tourId: 'feed-purchases' },
      { title: 'Purchase Orders', path: '/procurement', permission: 'inventory.view', icon: ClipboardList },
      { title: 'Issue Feed', path: '/feed-issue', permission: 'inventory.issue', icon: Package, tourId: 'feed-issue', shortLabelKey: 'nav.feed' },
      { title: 'Feeding Plans', path: '/feeding-plans', permission: 'production.view', icon: Scale },
      { title: 'Analytics', path: '/feed-management/analytics', permission: 'inventory.view', icon: TrendingUp, labelKey: 'nav.paper.feedAnalytics' },
      { title: 'Overview', path: '/inventory/overview', permission: 'inventory.view', icon: ChartColumn, tourId: 'inventory-overview', labelKey: 'nav.paper.inventoryOverview' },
      { title: 'Stock Levels', path: '/stock-levels', permission: 'inventory.view', icon: Package, tourId: 'stock-levels' },
      { title: 'Stock Items', path: '/inventory/items', permission: 'inventory.view', icon: List },
      { title: 'Lots', path: '/inventory/lots', permission: 'inventory.view', icon: Package, tourId: 'inventory-lots' },
      { title: 'Adjust / Transfer', path: '/inventory/adjust', permission: 'inventory.adjust', icon: Package, tourId: 'inventory-adjust' },
      { title: 'Stock Counts', path: '/inventory/counts', permission: 'inventory.issue', icon: ClipboardList },
      { title: 'Alerts', path: '/inventory-alerts', permission: 'inventory.view', icon: TriangleAlert },
      { title: 'Transactions', path: '/inventory-transactions', permission: 'inventory.view', icon: FileText, tourId: 'inventory-transactions' },
      { title: 'Analytics', path: '/inventory/analytics', permission: 'inventory.view', icon: TrendingUp, labelKey: 'nav.paper.inventoryAnalytics' },
    ],
  },
  finance: {
    title: 'Finance',
    icon: FinanceIcon,
    items: [
      { title: 'Sales', path: '/sales', permission: 'finance.view', icon: ShoppingCart, tourId: 'sales' },
      { title: 'Expenses', path: '/expenses', permission: 'finance.view', icon: Receipt },
      { title: 'Cage P&L', path: '/pnl', permission: 'finance.view', icon: TrendingUp, tourId: 'pnl' },
      { title: 'Accounting export', path: '/accounting-export', permission: 'reports.export', icon: Calculator },
    ],
  },
  hatchery: {
    title: 'Hatchery',
    icon: Egg,
    items: [
      { title: 'Overview', path: '/hatchery', icon: House },
      { title: 'Broodstock', path: '/hatchery/broodstock', icon: Fish },
      { title: 'New spawning', path: '/hatchery/spawning', icon: Plus },
      { title: 'Larvae & fingerlings', path: '/hatchery/larval', icon: Waves },
      { title: 'Live feed', path: '/hatchery/live-feed', icon: ClipboardList },
    ],
  },
  analytics: {
    title: 'Reports',
    icon: ReportsIcon,
    tourId: 'reports-section',
    items: [
      { title: 'Analytics', path: '/analytics', permission: 'reports.view', icon: ChartColumn },
      { title: 'Weekly report', path: '/weekly-report', permission: 'reports.view', icon: FileText },
      { title: 'Production Report', path: '/report', permission: 'reports.view', icon: FileText, tourId: 'report' },
      { title: 'Report Builder', path: '/reports', permission: 'reports.view', icon: ChartColumn },
      { title: 'Regional Report', path: '/reports/regions', permission: 'reports.view', icon: MapPin },
      { title: 'Group Reports', path: '/group-reports', permission: 'group.reports.view', icon: Globe },
      { title: 'Export Data', path: '/export', permission: 'reports.export', icon: Download },
    ],
  },
  management: {
    title: 'Settings',
    icon: SettingsIcon,
    tourId: 'management-section',
    items: [
      { title: 'Global Settings', path: '/global-settings', icon: Settings, tourId: 'global-settings' },
      { title: 'Company Settings', path: '/company-settings', permission: 'org.settings.manage', icon: Building2, tourId: 'company-settings' },
      { title: 'Farm Locations', path: '/farm-locations', permission: 'org.sites.manage', icon: MapPin, tourId: 'farm-locations' },
      { title: 'Users', path: '/users', permission: 'org.members.manage', icon: Users },
      { title: 'Organization Structure', path: '/organization-structure', permission: 'org.structure.manage', icon: Network },
      { title: 'Teams', path: '/teams', permission: 'workforce.view', icon: UsersRound },
      { title: 'Workforce', path: '/workforce', permission: 'workforce.view', icon: IdCard },
      { title: 'Billing', path: '/billing', permission: 'org.settings.manage', icon: CreditCard },
      { title: 'Customization', path: '/customization', permission: 'customization.manage', icon: SlidersHorizontal },
      { title: 'Species', path: '/species', permission: 'org.settings.manage', icon: Fish },
      { title: 'Messaging', path: '/messaging-settings', permission: 'integrations.manage', icon: MessageSquare },
      {
        title: 'Audit Logs',
        path: '/audit-logs',
        permission: 'org.audit.view',
        icon: Eye,
        tourId: 'audit-logs',
      },
      { title: 'Automations', path: '/automations', permission: 'automation.manage', icon: Zap },
      { title: 'API keys', path: '/api-keys', permission: 'integrations.manage', icon: KeyRound },
      { title: 'Webhooks', path: '/webhooks', permission: 'integrations.manage', icon: Webhook },
      { title: 'Inbound webhooks', path: '/inbound-webhooks', permission: 'integrations.manage', icon: Webhook },
      { title: 'AI settings', path: '/ai-settings', permission: 'integrations.manage', icon: Sparkles },
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

/** Every place a member can pin to the phone tab bar (not super-admin pages). */
export const NAV_ITEMS = Object.entries(MENU_SECTIONS)
  .filter(([, section]) => !section.superAdminOnly)
  .flatMap(([section, { items }]) => items.map((item) => ({ ...item, section })))

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
  for (const path of paths) {
    const item = NAV_BY_PATH.get(path)
    if (!item || seen.has(path) || !can(item.permission)) continue
    seen.add(path)
    out.push(item)
    if (out.length >= MAX_MOBILE_SHORTCUTS) break
  }
  return out
}
