// components/Sidebar.js — Harbor Soft collapsible nav
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  ArrowLeftRight,
  Building2,
  Calendar,
  ChartColumn,
  ChevronDown,
  ClipboardList,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleCheck,
  Crosshair,
  Database,
  Download,
  Eye,
  FileText,
  Fish,
  HeartPulse,
  House,
  KeyRound,
  LayoutGrid,
  List,
  LogOut,
  MapPin,
  MessageSquare,
  Package,
  Plus,
  QrCode,
  Receipt,
  Scale,
  Settings,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  Truck,
  Upload,
  Users,
  Waves,
  X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useCompanySettings } from '../contexts/CompanySettingsContext'
import LogoutConfirmationModal from './LogoutConfirmationModal'
import { useToast } from './Toast'

const MENU_SECTIONS = {
  production: {
    title: 'Production',
    icon: Fish,
    tourId: 'production',
    items: [
      { title: 'Dashboard', path: '/dashboard', icon: House, tourId: 'dashboard' },
      { title: 'Daily Entry', path: '/daily-entry', icon: Calendar, tourId: 'daily-entry' },
      { title: 'Daily Records', path: '/daily-data', icon: ClipboardList },
      { title: 'Bi-weekly Entry', path: '/biweekly-entry', icon: Scale, tourId: 'biweekly-entry' },
      { title: 'Bi-weekly Records', path: '/biweekly-records', icon: FileText, tourId: 'biweekly-records' },
      { title: 'Harvest Data', path: '/harvest', icon: Package, tourId: 'harvest' },
      { title: 'Harvest Sampling', path: '/harvest-sampling', icon: Crosshair },
      { title: 'Sales', path: '/sales', icon: ShoppingCart, tourId: 'sales' },
      { title: 'Expenses', path: '/expenses', icon: Receipt },
      { title: 'Health', path: '/health', icon: HeartPulse, tourId: 'health' },
      { title: 'Cage P&L', path: '/pnl', icon: TrendingUp, tourId: 'pnl' },
      { title: 'Stocking Management', path: '/stocking-management', icon: Waves, tourId: 'stocking-management' },
      { title: 'Fish Transfers', path: '/fish-transfers', icon: ArrowLeftRight, tourId: 'fish-transfers' },
      { title: 'New Stocking', path: '/stocking', icon: Plus, tourId: 'stocking' },
    ],
  },
  cages: {
    title: 'Cages',
    icon: LayoutGrid,
    tourId: 'cages-section',
    items: [
      { title: 'All Cages', path: '/cages', icon: Database, tourId: 'cages' },
      { title: 'Analytics', path: '/cages/analytics', icon: ChartColumn },
      { title: 'QR codes', path: '/cages/qr-codes', icon: QrCode },
      { title: 'Settings', path: '/cages/settings', icon: Settings },
      { title: 'Create Cage', path: '/create-cage', icon: Plus, tourId: 'create-cage' },
    ],
  },
  feed: {
    title: 'Feed',
    icon: Package,
    tourId: 'feed-section',
    items: [
      { title: 'Overview', path: '/feed-management', icon: ChartColumn, tourId: 'feed-management' },
      { title: 'Feed Types', path: '/feed-types', icon: List, tourId: 'feed-types' },
      { title: 'Suppliers', path: '/feed-suppliers', icon: Truck, tourId: 'feed-suppliers' },
      { title: 'Purchases', path: '/feed-purchases', icon: ShoppingCart, tourId: 'feed-purchases' },
      { title: 'Purchase Orders', path: '/procurement', icon: ClipboardList },
      { title: 'Issue Feed', path: '/feed-issue', icon: Package, tourId: 'feed-issue' },
      { title: 'Analytics', path: '/feed-management/analytics', icon: TrendingUp },
    ],
  },
  inventory: {
    title: 'Inventory',
    icon: Database,
    tourId: 'inventory-section',
    items: [
      { title: 'Overview', path: '/inventory/overview', icon: ChartColumn, tourId: 'inventory-overview' },
      { title: 'Stock Levels', path: '/stock-levels', icon: Package, tourId: 'stock-levels' },
      { title: 'Stock Items', path: '/inventory/items', icon: List },
      { title: 'Lots', path: '/inventory/lots', icon: Package, tourId: 'inventory-lots' },
      { title: 'Adjust / Transfer', path: '/inventory/adjust', icon: Package, tourId: 'inventory-adjust' },
      { title: 'Alerts', path: '/inventory-alerts', icon: TriangleAlert },
      { title: 'Transactions', path: '/inventory-transactions', icon: FileText, tourId: 'inventory-transactions' },
      { title: 'Analytics', path: '/inventory/analytics', icon: TrendingUp },
    ],
  },
  analytics: {
    title: 'Reports',
    icon: ChartColumn,
    tourId: 'reports-section',
    items: [
      { title: 'Production Report', path: '/report', icon: FileText, tourId: 'report' },
      { title: 'Export Data', path: '/export', icon: Download },
      {
        title: 'Audit Logs',
        path: '/audit-logs',
        icon: Eye,
        adminOnly: true,
        tourId: 'audit-logs',
      },
    ],
  },
  management: {
    title: 'Management',
    icon: Settings,
    tourId: 'management-section',
    items: [
      { title: 'Global Settings', path: '/global-settings', icon: Settings, tourId: 'global-settings' },
      { title: 'Farm Locations', path: '/farm-locations', icon: MapPin, adminOnly: true, tourId: 'farm-locations' },
      { title: 'Users', path: '/users', icon: Users, adminOnly: true },
      { title: 'Company Settings', path: '/company-settings', icon: Building2, adminOnly: true, tourId: 'company-settings' },
      { title: 'Messaging', path: '/messaging-settings', icon: MessageSquare, adminOnly: true },
      { title: 'API keys', path: '/api-keys', icon: KeyRound, adminOnly: true },
      { title: 'Approvals', path: '/approvals', icon: CircleCheck, adminOnly: true, tourId: 'approvals' },
      { title: 'Bulk Upload', path: '/bulk-upload', icon: Upload, adminOnly: true },
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

const Sidebar = ({ collapsed = false, onToggle, mobileOpen = false, onMobileClose }) => {
  const { user, signOut } = useAuth()
  const { displayName, logoUrl } = useCompanySettings()
  const router = useRouter()
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    production: true,
    cages: true,
    feed: true,
    inventory: true,
    analytics: true,
    management: true,
    admin: true,
  })
  const { showToast } = useToast()

  const role = user?.role || 'user'
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isSuperAdmin = role === 'super_admin'

  const menuItems = useMemo(() => {
    const filtered = Object.entries(MENU_SECTIONS)
      .filter(([, section]) => {
        if (section.superAdminOnly && !isSuperAdmin) return false
        if (section.adminOnly && !isAdmin) return false
        return true
      })
      .map(([key, section]) => [
        key,
        {
          ...section,
          items: section.items.filter((item) => {
            if (item.superAdminOnly && !isSuperAdmin) return false
            if (item.adminOnly && !isAdmin) return false
            return true
          }),
        },
      ])
    return Object.fromEntries(filtered)
  }, [isAdmin, isSuperAdmin])

  useEffect(() => {
    const path = router.pathname
    const sectionForPath = Object.entries(MENU_SECTIONS).find(([, section]) =>
      section.items.some(
        (item) => path === item.path || path.startsWith(`${item.path}/`)
      )
    )
    if (sectionForPath) {
      setExpandedSections((prev) => ({ ...prev, [sectionForPath[0]]: true }))
    }
  }, [router.pathname])

  const handleLogout = async () => {
    try {
      const { cancelled } = (await signOut()) || {}
      if (cancelled) return
      showToast('Logged out successfully', 'success')
      router.push('/login')
    } catch (error) {
      console.error('Logout failed:', error)
      showToast('Logout failed', 'error')
    } finally {
      setShowLogoutModal(false)
    }
  }

  const toggleSection = (section) => {
    if (collapsed) return
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  const allNavPaths = useMemo(
    () =>
      Object.values(MENU_SECTIONS).flatMap((section) =>
        section.items.map((item) => item.path),
      ),
    [],
  )

  const isActive = (path) => {
    const current = router.pathname
    if (current === path) return true
    // Nested routes (e.g. /cages/[id], /cages/analytics/growth)
    if (!current.startsWith(`${path}/`)) return false
    // Prefer a more specific nav item when one matches (fixes /cages + /cages/analytics)
    const hasMoreSpecific = allNavPaths.some(
      (other) =>
        other !== path &&
        other.startsWith(`${path}/`) &&
        (current === other || current.startsWith(`${other}/`)),
    )
    return !hasMoreSpecific
  }

  return (
    <aside
      className={`print:hidden fixed top-0 left-0 h-screen flex flex-col z-40 border-r border-lagoon-950/40 bg-lagoon-950 text-foam transition-[width,transform] duration-200 ease-out lg:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } ${collapsed ? 'w-[4.5rem]' : 'w-72 lg:w-64'}`}
      aria-label="Main navigation"
      data-tour="sidebar"
    >
      <div
        className={`flex items-center border-b border-white/10 ${
          collapsed ? 'justify-center px-2 py-4' : 'justify-between px-4 py-4'
        }`}
      >
        <Link
          href="/dashboard"
          className={`flex items-center min-w-0 ${collapsed ? '' : 'gap-2.5'}`}
          title={displayName || 'PBA Farm'}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl object-cover bg-white/10"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
              <Fish size={22} aria-hidden />
            </span>
          )}
          {!collapsed && (
            <span className="truncate font-display text-base font-semibold text-white">
              {displayName || 'PBA Farm'}
            </span>
          )}
        </Link>
        {typeof onMobileClose === 'function' && mobileOpen && (
          <button
            type="button"
            onClick={onMobileClose}
            className="lg:hidden rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        )}
        {typeof onToggle === 'function' && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="hidden lg:block rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label="Collapse sidebar"
          >
            <ChevronsLeft size={18} />
          </button>
        )}
      </div>

      {collapsed && typeof onToggle === 'function' && (
        <div className="flex justify-center py-2 border-b border-white/10">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label="Expand sidebar"
          >
            <ChevronsRight size={18} />
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-5">
        {Object.entries(menuItems).map(([key, section], index) => {
          const SectionIcon = section.icon
          const open = collapsed ? false : expandedSections[key]
          const sectionActive = section.items.some((item) => isActive(item.path))

          return (
            <div key={key}>
              {index > 0 && (
                <div
                  className={`mb-4 ${collapsed ? 'mx-2' : 'mx-1'} border-t border-white/10`}
                  aria-hidden
                />
              )}
              <button
                type="button"
                data-tour-section={key}
                data-tour={
                  key === 'production'
                    ? 'nav-section-production'
                    : section.tourId
                      ? `nav-section-${section.tourId}`
                      : undefined
                }
                aria-expanded={open}
                onClick={() => {
                  if (collapsed) {
                    onToggle?.()
                    setExpandedSections((prev) => ({ ...prev, [key]: true }))
                    return
                  }
                  toggleSection(key)
                }}
                className={`w-full flex items-center rounded-lg px-3 min-h-10 text-left text-sm font-medium leading-5 transition-colors ${
                  sectionActive
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-100 hover:bg-white/5 hover:text-white'
                } ${collapsed ? 'justify-center' : 'justify-between'}`}
                title={collapsed ? section.title : undefined}
              >
                <span className={`flex items-center min-w-0 ${collapsed ? '' : 'gap-2.5'}`}>
                  <SectionIcon
                    size={18}
                    className="shrink-0 text-zinc-200"
                    aria-hidden
                  />
                  {!collapsed && <span className="truncate">{section.title}</span>}
                </span>
                {!collapsed &&
                  (open ? (
                    <ChevronDown size={16} className="text-zinc-400 shrink-0" />
                  ) : (
                    <ChevronRight size={16} className="text-zinc-400 shrink-0" />
                  ))}
              </button>

              {open && (
                <ul className="mt-1.5 mb-1 ml-2.5 border-l border-white/15 pl-2.5 space-y-1">
                  {section.items.map((item) => {
                    const ItemIcon = item.icon
                    const active = isActive(item.path)
                    return (
                      <li key={item.path}>
                        <Link
                          href={item.path}
                          data-tour={item.tourId ? `nav-${item.tourId}` : undefined}
                          className={`group relative flex items-center gap-2.5 rounded-lg px-3 min-h-9 text-sm leading-5 transition-colors ${
                            active
                              ? 'bg-white text-lagoon-950 shadow-sm'
                              : 'text-zinc-200 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          {active && (
                            <span
                              className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-lagoon-950"
                              aria-hidden
                            />
                          )}
                          <ItemIcon
                            size={18}
                            className={active ? 'text-lagoon-950' : 'text-zinc-400'}
                            aria-hidden
                          />
                          <span className="truncate">{item.title}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      <div className={`border-t border-white/10 ${collapsed ? 'p-2' : 'p-3'}`}>
        <div
          className={`flex items-center ${
            collapsed ? 'flex-col gap-2' : 'justify-between gap-2'
          }`}
        >
          <div
            className={`flex items-center min-w-0 ${collapsed ? 'justify-center' : 'gap-2.5'}`}
            title={user?.email || 'User'}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-lagoon-950">
              {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white leading-5">
                  {user?.name || user?.email?.split('@')[0] || 'User'}
                </p>
                <p className="truncate font-data text-xs text-zinc-400 mt-0.5">
                  {user?.email || '—'}
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowLogoutModal(true)}
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {showLogoutModal && (
        <LogoutConfirmationModal
          isOpen={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={handleLogout}
        />
      )}
    </aside>
  )
}

export default Sidebar
