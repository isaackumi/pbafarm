// components/Sidebar.js — Paper shell sidebar (docs/design/paper-redesign, Shell 7Z-0)
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Plus,
  X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useCompanySettings } from '../contexts/CompanySettingsContext'
import { useLocation } from '../contexts/LocationContext'
import { usePermissions } from '../hooks/usePermission'
import { useTerm } from '../hooks/useTerm'
import { useT } from '../lib/i18n/context'
import { navKey } from '../lib/i18n'
import { MENU_SECTIONS } from '../lib/navigation'
import { routePermission } from '../lib/routePermissions'
import { api } from '../convex/_generated/api'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { addDays, localToday } from '../lib/format'
import { Avatar } from './ui/Avatar'
import { AnowaLockup, AnowaMark } from './brand/AnowaLogo'


/**
 * Workspace switcher (Paper EZ-0): company, active site (switches location),
 * optional feed cover line and the "Stock a new cage" action.
 */
function WorkspaceCard({ displayName, logoUrl, feedCover, canStock }) {
  const t = useT()
  const { locations, activeLocationId, setActiveLocation, loading } = useLocation()
  const active = locations.find((loc) => (loc.id || loc._id) === activeLocationId)
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex items-center gap-2.5 px-1.5" data-tour="location-switcher">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="size-6 shrink-0 rounded-[6px] border border-line-strong object-cover"
          />
        ) : (
          <Avatar name={displayName} size={24} square />
        )}
        <div className="flex min-w-0 grow basis-0 flex-col">
          <div className="truncate text-[14px] font-medium leading-[18px] text-text">{displayName}</div>
          {locations.length > 0 ? (
            <div className="truncate text-[12px] leading-4 text-muted">{active?.name || '—'}</div>
          ) : (
            <Link href="/farm-locations" className="relative z-10 text-[12px] leading-4 text-cyan hover:underline">
              Set location
            </Link>
          )}
        </div>
        {locations.length > 1 && (
          <>
            <ChevronsUpDown size={14} strokeWidth={2} className="shrink-0 text-muted" aria-hidden />
            <select
              aria-label="Farm location"
              title="Changing location refreshes the page"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={activeLocationId || ''}
              disabled={loading}
              onChange={(e) => {
                const next = e.target.value
                if (!next || next === activeLocationId) return
                setActiveLocation(next)
              }}
            >
              {locations.map((loc) => (
                <option key={loc.id || loc._id} value={loc.id || loc._id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {feedCover && (
        <div className="px-1.5 text-[12px] leading-[17px] text-muted">
          {t('nav.feedCover')} <span className="text-text">{t('nav.feedCoverDays', { count: feedCover.days })}</span>
          {feedCover.tonnes != null && <> · {feedCover.tonnes} t</>}
        </div>
      )}
      {canStock && (
        <Link
          href="/stocking"
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-pill border border-line-strong text-[13px] font-medium leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          <Plus size={14} strokeWidth={2} aria-hidden />
          Stock a new cage
        </Link>
      )}
    </div>
  )
}

const ROW =
  'flex h-10 w-full shrink-0 items-center gap-3 rounded-pill px-3.5 text-left text-[14px] leading-[18px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const ROW_ACTIVE = 'bg-button text-button-text font-medium'
const ROW_IDLE = 'text-text hover:bg-surface-2'

const Sidebar = ({ collapsed = false, onToggle, mobileOpen = false, onMobileClose }) => {
  const { user, canUseApp } = useAuth()
  const { displayName, logoUrl } = useCompanySettings()
  const router = useRouter()
  // Production stays open like the Paper shell; the section holding the
  // current page also opens on navigation (UX-004).
  const [expandedSections, setExpandedSections] = useState({ production: true })
  const t = useT()
  const term = useTerm()

  const role = user?.role || 'user'
  const isSuperAdmin = role === 'super_admin'
  // Menu follows the member's permissions (PERM-003), not the legacy role.
  const { can } = usePermissions()
  const openTasks = useQuery(api.tasks.openCount, canUseApp ? {} : 'skip')
  // Feed cover (Paper 7Z-0): stock vs the last 30 days' average use, for the
  // active site. Optional: the line is simply absent if it can't load.
  const { locationArgs } = useLocation()
  const coverWindow = useMemo(() => {
    const to = localToday()
    return { from: addDays(to, -29), to }
  }, [])
  const cover = useOptionalQuery(
    api.inventory.coverSummary,
    canUseApp && can('inventory.view') ? { ...coverWindow, ...(locationArgs || {}) } : 'skip',
  )
  const feedCover = cover
    ? { days: Math.round(cover.cover_days), tonnes: (cover.stock_kg / 1000).toFixed(1) }
    : null

  const menuItems = useMemo(() => {
    const filtered = Object.entries(MENU_SECTIONS)
      .filter(([, section]) => {
        if (section.superAdminOnly && !isSuperAdmin) return false
        return true
      })
      .map(([key, section]) => [
        key,
        {
          ...section,
          items: section.items.filter((item) => {
            if (item.superAdminOnly && !isSuperAdmin) return false
            return can(item.permission)
          }),
        },
      ])
      .filter(([, section]) => section.items.length > 0)
    return Object.fromEntries(filtered)
  }, [can, isSuperAdmin])

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

  const label = (item) => term.text(t.or(item.labelKey || navKey(item.path), item.title))
  const sectionLabel = (key, section) => t.or(`nav.section.${key}`, section.title)
  const name = displayName || 'Anowa'

  return (
    <aside
      className={`print:hidden fixed top-0 left-0 z-40 flex h-screen flex-col overflow-y-auto border-r border-line bg-bg text-text transition-[width,transform] duration-200 ease-out lg:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } ${collapsed ? 'w-[4.5rem] gap-6 px-3 py-7' : 'w-72 gap-7 px-5 py-7 lg:w-sidebar'}`}
      aria-label={t('nav.mainNavigation')}
      data-tour="sidebar"
    >
      <div className={`flex items-center ${collapsed ? 'flex-col gap-3' : 'justify-between gap-2'}`}>
        <Link
          href="/dashboard"
          className={`flex min-w-0 items-center gap-2.5 ${collapsed ? '' : 'h-6 px-1.5'}`}
          title="Anowa"
        >
          {/* Paper Brand row: 22px mark + 20px wordmark on a 24px line */}
          {collapsed ? <AnowaMark size={32} /> : <AnowaLockup height={22} />}
        </Link>
        {typeof onMobileClose === 'function' && mobileOpen && (
          <button
            type="button"
            onClick={onMobileClose}
            className="lg:hidden rounded-pill p-2 text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            aria-label={t('nav.closeMenu')}
          >
            <X size={18} />
          </button>
        )}
        {typeof onToggle === 'function' && (
          <button
            type="button"
            onClick={onToggle}
            className="hidden lg:block -my-1 rounded-pill p-1.5 text-faint hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        )}
      </div>

      {!collapsed && (
        <WorkspaceCard
          displayName={name}
          logoUrl={logoUrl}
          feedCover={feedCover}
          canStock={can(routePermission('/stocking'))}
        />
      )}

      <nav className="flex flex-col gap-[2px]">
        {Object.entries(menuItems).map(([key, section]) => {
          const SectionIcon = section.icon
          const title = sectionLabel(key, section)

          if (section.direct) {
            const item = section.items[0]
            const active = isActive(item.path)
            const count = item.path === '/tasks' ? openTasks : undefined
            return (
              <Link
                key={key}
                href={item.path}
                data-tour={item.tourId ? `nav-${item.tourId}` : undefined}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? title : undefined}
                className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE} ${collapsed ? 'justify-center px-0' : ''}`}
              >
                <SectionIcon size={16} strokeWidth={2} className="shrink-0" aria-hidden />
                {!collapsed && <span className="grow basis-0 truncate">{title}</span>}
                {!collapsed && count > 0 && (
                  <span className={`text-[12px] leading-4 ${active ? 'text-button-text' : 'text-muted'}`}>
                    {count}
                  </span>
                )}
              </Link>
            )
          }

          const open = collapsed ? false : expandedSections[key]
          const sectionActive = section.items.some((item) => isActive(item.path))
          // Paper highlights the group row when the current page belongs to a
          // closed group; an open group highlights the page itself.
          const rowActive = sectionActive && !open
          return (
            <div key={key} className="flex flex-col">
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
                className={`${ROW} ${rowActive ? ROW_ACTIVE : ROW_IDLE} ${collapsed ? 'justify-center px-0' : ''}`}
                title={collapsed ? title : undefined}
              >
                <SectionIcon size={16} strokeWidth={2} className="shrink-0" aria-hidden />
                {!collapsed && <span className="grow basis-0 truncate">{title}</span>}
                {!collapsed &&
                  (open ? (
                    <ChevronDown size={14} strokeWidth={2} className="shrink-0" aria-hidden />
                  ) : (
                    <ChevronRight
                      size={14}
                      strokeWidth={2}
                      className={`shrink-0 ${rowActive ? '' : 'text-muted'}`}
                      aria-hidden
                    />
                  ))}
              </button>

              {open && (
                <ul className="flex flex-col pl-[42px]">
                  {section.items.map((item) => {
                    const active = isActive(item.path)
                    return (
                      <li key={item.path}>
                        <Link
                          href={item.path}
                          data-tour={item.tourId ? `nav-${item.tourId}` : undefined}
                          aria-current={active ? 'page' : undefined}
                          className={`-ml-3 flex h-[34px] items-center rounded-pill px-3 text-[13px] leading-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                            active ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text'
                          }`}
                        >
                          <span className="truncate">{label(item)}</span>
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
    </aside>
  )
}

export default Sidebar
