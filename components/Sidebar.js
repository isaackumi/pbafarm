// components/Sidebar.js — Harbor Soft collapsible nav
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  House,
  Fish,
  CalendarBlank,
  Scales,
  FileText,
  Package,
  Crosshair,
  Waves,
  Plus,
  SquaresFour,
  ChartBar,
  GearSix,
  Database,
  ShoppingCart,
  Truck,
  Warning,
  ChartLineUp,
  DownloadSimple,
  Eye,
  Users,
  Buildings,
  CheckCircle,
  UploadSimple,
  ShieldCheck,
  SignOut,
  CaretDown,
  CaretRight,
  CaretDoubleLeft,
  CaretDoubleRight,
  ListBullets,
} from '@phosphor-icons/react'
import { useAuth } from '../contexts/AuthContext'
import { useCompanySettings } from '../contexts/CompanySettingsContext'
import LogoutConfirmationModal from './LogoutConfirmationModal'
import { useToast } from './Toast'

const MENU_SECTIONS = {
  production: {
    title: 'Production',
    icon: Fish,
    items: [
      { title: 'Dashboard', path: '/dashboard', icon: House },
      { title: 'Daily Entry', path: '/daily-entry', icon: CalendarBlank },
      { title: 'Bi-weekly Entry', path: '/biweekly-entry', icon: Scales },
      { title: 'Bi-weekly Records', path: '/biweekly-records', icon: FileText },
      { title: 'Harvest Data', path: '/harvest', icon: Package },
      { title: 'Harvest Sampling', path: '/harvest-sampling', icon: Crosshair },
      { title: 'Stocking Management', path: '/stocking-management', icon: Waves },
      { title: 'New Stocking', path: '/stocking', icon: Plus },
    ],
  },
  cages: {
    title: 'Cages',
    icon: SquaresFour,
    items: [
      { title: 'All Cages', path: '/cages', icon: Database },
      { title: 'Analytics', path: '/cages/analytics', icon: ChartBar },
      { title: 'Settings', path: '/cages/settings', icon: GearSix },
      { title: 'Create Cage', path: '/create-cage', icon: Plus },
    ],
  },
  feed: {
    title: 'Feed',
    icon: Package,
    items: [
      { title: 'Overview', path: '/feed-management', icon: ChartBar },
      { title: 'Feed Types', path: '/feed-types', icon: ListBullets },
      { title: 'Suppliers', path: '/feed-suppliers', icon: Truck },
      { title: 'Purchases', path: '/feed-purchases', icon: ShoppingCart },
      { title: 'Issue Feed', path: '/feed-issue', icon: Package },
      { title: 'Analytics', path: '/feed-management/analytics', icon: ChartLineUp },
    ],
  },
  inventory: {
    title: 'Inventory',
    icon: Database,
    items: [
      { title: 'Overview', path: '/inventory/overview', icon: ChartBar },
      { title: 'Stock Levels', path: '/stock-levels', icon: Package },
      { title: 'Alerts', path: '/inventory-alerts', icon: Warning },
      { title: 'Transactions', path: '/inventory-transactions', icon: FileText },
      { title: 'Analytics', path: '/inventory/analytics', icon: ChartLineUp },
    ],
  },
  analytics: {
    title: 'Reports',
    icon: ChartBar,
    items: [
      { title: 'Production Report', path: '/report', icon: FileText },
      { title: 'Export Data', path: '/export', icon: DownloadSimple },
      {
        title: 'Audit Logs',
        path: '/audit-logs',
        icon: Eye,
        adminOnly: true,
      },
    ],
  },
  management: {
    title: 'Management',
    icon: GearSix,
    adminOnly: true,
    items: [
      { title: 'Users', path: '/users', icon: Users },
      { title: 'Company Settings', path: '/company-settings', icon: Buildings },
        { title: 'Approvals', path: '/approvals', icon: CheckCircle },
        { title: 'Bulk Upload', path: '/bulk-upload', icon: UploadSimple },
    ],
  },
  admin: {
    title: 'Admin',
    icon: ShieldCheck,
    superAdminOnly: true,
    items: [
      { title: 'Admin Dashboard', path: '/admin/admin', icon: House },
      { title: 'Registrations', path: '/admin/company-registrations', icon: Buildings },
    ],
  },
}

const Sidebar = ({ collapsed = false, onToggle }) => {
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
      await signOut()
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
      className={`fixed top-0 left-0 h-screen flex flex-col z-40 border-r border-lagoon-950/40 bg-lagoon-950 text-foam transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[4.5rem]' : 'w-64'
      }`}
      aria-label="Main navigation"
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
              <Fish size={22} weight="duotone" aria-hidden />
            </span>
          )}
          {!collapsed && (
            <span className="truncate font-display text-lg font-bold tracking-tight text-white">
              {displayName || 'PBA Farm'}
            </span>
          )}
        </Link>
        {typeof onToggle === 'function' && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label="Collapse sidebar"
          >
            <CaretDoubleLeft size={18} weight="bold" />
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
            <CaretDoubleRight size={18} weight="bold" />
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
                onClick={() => {
                  if (collapsed) {
                    onToggle?.()
                    setExpandedSections((prev) => ({ ...prev, [key]: true }))
                    return
                  }
                  toggleSection(key)
                }}
                className={`w-full flex items-center rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold leading-snug tracking-normal transition-colors ${
                  sectionActive
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-100 hover:bg-white/5 hover:text-white'
                } ${collapsed ? 'justify-center' : 'justify-between'}`}
                title={collapsed ? section.title : undefined}
              >
                <span className={`flex items-center min-w-0 ${collapsed ? '' : 'gap-2.5'}`}>
                  <SectionIcon
                    size={22}
                    weight={sectionActive ? 'duotone' : 'regular'}
                    className="shrink-0 text-zinc-200"
                    aria-hidden
                  />
                  {!collapsed && <span className="truncate">{section.title}</span>}
                </span>
                {!collapsed &&
                  (open ? (
                    <CaretDown size={16} className="text-zinc-400 shrink-0" />
                  ) : (
                    <CaretRight size={16} className="text-zinc-400 shrink-0" />
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
                          className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] font-medium leading-snug transition-colors ${
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
                            weight={active ? 'fill' : 'regular'}
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
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-lagoon-950">
              {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-white leading-snug">
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
            title="Logout"
            aria-label="Logout"
          >
            <SignOut size={20} weight="bold" />
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
