// components/Sidebar.js — Paper shell sidebar (docs/design/paper-redesign, Shell 7Z-0)
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import {
  ChevronsLeft,
  ChevronsRight,
  X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { usePermissions } from '../hooks/usePermission'
import { useTerm } from '../hooks/useTerm'
import { useT } from '../lib/i18n/context'
import { navKey } from '../lib/i18n'
import { MENU_SECTIONS, canOpenItem } from '../lib/navigation'
import { legacyTabTarget } from '../lib/tabGroups'
import { ChevronDownIcon, ChevronRightIcon } from '../lib/navIcons'
import { routePermission } from '../lib/routePermissions'
import { api } from '../convex/_generated/api'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { addDays, localToday } from '../lib/format'
import FarmSwitcher from './FarmSwitcher'
import { AnowaLockup, AnowaMark } from './brand/AnowaLogo'
import {
  getExpandedSections,
  getSidebarScroll,
  scrollToReveal,
  setExpandedSections as rememberExpanded,
  setSidebarScroll,
} from '../lib/sidebarState'

// useLayoutEffect warns during server rendering; the effect only matters in the browser.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect


/**
 * Tenant block (Paper 7Z-0 EZ-0): the farm row (FarmSwitcher: farm, active
 * site and the switch menu, Paper 69), the feed cover line and the
 * "Stock a new cage" action, 12px apart.
 */
function WorkspaceCard({ feedCover, canStock, showFarm }) {
  const t = useT()
  const { locations, loading } = useLocation()
  return (
    <div className="flex flex-col gap-3" data-tour="location-switcher">
      {showFarm && <FarmSwitcher />}
      {/* Not in the artboard: a farm with no site yet links to set one up. */}
      {!loading && locations.length === 0 && (
        <Link href="/farm-locations" className="px-1.5 text-[12px] leading-4 text-sky-ink hover:underline">
          Set location
        </Link>
      )}
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
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="shrink-0">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Stock a new cage
        </Link>
      )}
    </div>
  )
}

// Paper 71 (TRI-1): pages under 11px uppercase labels, 42px in, 26px rows,
// 4px between groups; the current page sits on a surface-2 pill.
const GROUP_LABEL = 'pt-1 pb-[2px] text-[11px] uppercase leading-[14px] tracking-[0.06em] text-faint'
const SUB_ROW =
  'flex h-[26px] shrink-0 items-center justify-between gap-2 rounded-pill text-[13px] leading-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/** Items of an open section, under group labels when it has two or more groups. */
function SectionGroups({ section, sectionKey, isActive, label, groupLabel, counts }) {
  const groups = section.groups?.length
    ? section.groups
        .map((group) => ({ ...group, items: section.items.filter((item) => item.group === group.key) }))
        .filter((group) => group.items.length > 0)
    : [{ key: sectionKey, items: section.items }]
  const labelled = groups.length >= 2
  return (
    <div className="flex flex-col gap-1 pb-[2px] pl-[42px]">
      {groups.map((group) => (
        <ul key={group.key} className="flex flex-col" aria-label={labelled ? groupLabel(group) : undefined}>
          {labelled && (
            <li aria-hidden className={GROUP_LABEL}>
              {groupLabel(group)}
            </li>
          )}
          {group.items.map((item) => {
            const active = isActive(item.path)
            const count = item.count ? counts?.[item.count] : null
            return (
              <li key={item.path}>
                <Link
                  href={item.path}
                  data-tour={item.tourId ? `nav-${item.tourId}` : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`${SUB_ROW} ${
                    active ? '-ml-[10px] bg-surface-2 px-[10px] font-medium text-text' : 'text-muted hover:text-text'
                  }`}
                >
                  <span className="truncate">{label(item)}</span>
                  {count > 0 &&
                    (item.count === 'openAlerts' ? (
                      <span className="shrink-0 rounded-pill bg-[color-mix(in_oklab,var(--alert)_12%,transparent)] px-[6px] py-px text-[11px] font-normal leading-[14px] text-alert">
                        {count > 99 ? '99+' : count}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] font-normal leading-[14px] text-faint">{count > 99 ? '99+' : count}</span>
                    ))}
                </Link>
              </li>
            )
          })}
        </ul>
      ))}
    </div>
  )
}

const ROW =
  'flex h-10 w-full shrink-0 items-center gap-3 rounded-pill px-3.5 text-left text-[14px] leading-[18px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const ROW_ACTIVE = 'bg-button text-button-text font-medium'
const ROW_IDLE = 'text-text hover:bg-surface-2'

const Sidebar = ({ collapsed = false, onToggle, mobileOpen = false, onMobileClose }) => {
  const { user, canUseApp } = useAuth()
  const router = useRouter()
  // One section open at a time (Paper 71): Production by default, and the
  // section holding the current page opens on navigation (UX-004).
  // Each page renders its own Layout, so this component remounts on every
  // navigation: the open section and the scroll offset come from lib/sidebarState.
  const [expandedSections, setExpandedSections] = useState(() => getExpandedSections({ production: true }))
  const asideRef = useRef(null)
  const t = useT()
  const term = useTerm()

  const role = user?.role || 'user'
  const isSuperAdmin = role === 'super_admin'
  // Menu follows the member's permissions (PERM-003), not the legacy role.
  const { can } = usePermissions()
  const openTasks = useQuery(api.tasks.openCount, canUseApp ? {} : 'skip')
  // Paper 71: red = open alerts, grey = approvals waiting for this member.
  const navCounts = useOptionalQuery(api.navSearch.navCounts, canUseApp ? {} : 'skip')
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
            return canOpenItem(item, can)
          }),
        },
      ])
      .filter(([, section]) => section.items.length > 0)
    return Object.fromEntries(filtered)
  }, [can, isSuperAdmin])

  // An old route of a joined page (Paper 71b) counts as its tabbed page.
  const currentPath = legacyTabTarget(router.pathname, router.query)?.pathname || router.pathname

  useEffect(() => {
    const path = currentPath
    const sectionForPath = Object.entries(MENU_SECTIONS).find(([, section]) =>
      section.items.some(
        (item) => path === item.path || path.startsWith(`${item.path}/`)
      )
    )
    if (sectionForPath && !sectionForPath[1].direct) {
      setExpandedSections({ [sectionForPath[0]]: true })
    }
  }, [currentPath])

  useEffect(() => {
    rememberExpanded(expandedSections)
  }, [expandedSections])

  // Restore the scroll offset before paint (once per mount), then bring the
  // current page's link into view. The link can appear a render later, when
  // the group holding it opens, so the reveal waits for it.
  const pendingReveal = useRef(true)
  useIsoLayoutEffect(() => {
    if (asideRef.current) asideRef.current.scrollTop = getSidebarScroll()
  }, [])
  useEffect(() => {
    pendingReveal.current = true
  }, [router.pathname, collapsed])
  useIsoLayoutEffect(() => {
    const aside = asideRef.current
    if (!aside || !pendingReveal.current) return
    const current = aside.querySelector('[aria-current="page"]')
    if (!current) return
    pendingReveal.current = false
    const asideBox = aside.getBoundingClientRect()
    const itemBox = current.getBoundingClientRect()
    const itemTop = itemBox.top - asideBox.top + aside.scrollTop
    const next = scrollToReveal({
      scrollTop: aside.scrollTop,
      viewHeight: aside.clientHeight,
      itemTop,
      itemBottom: itemTop + itemBox.height,
    })
    if (next !== aside.scrollTop) {
      aside.scrollTop = next
      setSidebarScroll(next)
    }
  })

  const toggleSection = (section) => {
    if (collapsed) return
    // Opening a section closes the one that was open.
    setExpandedSections((prev) => (prev[section] ? {} : { [section]: true }))
  }

  const allNavPaths = useMemo(
    () =>
      Object.values(MENU_SECTIONS).flatMap((section) =>
        section.items.map((item) => item.path),
      ),
    [],
  )

  const isActive = (path) => {
    const current = currentPath
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

  return (
    <aside
      ref={asideRef}
      onScroll={(e) => setSidebarScroll(e.currentTarget.scrollTop)}
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

      {canUseApp && collapsed && <FarmSwitcher collapsed />}

      {!collapsed && (
        <WorkspaceCard
          feedCover={feedCover}
          canStock={can(routePermission('/stocking'))}
          showFarm={canUseApp}
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
                <SectionIcon
                  size={16}
                  strokeWidth={2}
                  className={`shrink-0 ${SectionIcon.muted && !active ? 'text-muted' : ''}`}
                  aria-hidden
                />
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
                    setExpandedSections({ [key]: true })
                    return
                  }
                  toggleSection(key)
                }}
                className={`${ROW} ${rowActive ? ROW_ACTIVE : ROW_IDLE} ${collapsed ? 'justify-center px-0' : ''}`}
                title={collapsed ? title : undefined}
              >
                <SectionIcon
                  size={16}
                  strokeWidth={2}
                  className={`shrink-0 ${SectionIcon.muted && !rowActive ? 'text-muted' : ''}`}
                  aria-hidden
                />
                {!collapsed && <span className="grow basis-0 truncate">{title}</span>}
                {!collapsed &&
                  (open ? (
                    <ChevronDownIcon size={14} strokeWidth={2} className="shrink-0" aria-hidden />
                  ) : (
                    <ChevronRightIcon
                      size={14}
                      strokeWidth={2}
                      className={`shrink-0 ${rowActive ? '' : 'text-muted'}`}
                      aria-hidden
                    />
                  ))}
              </button>

              {open && (
                <SectionGroups
                  section={section}
                  sectionKey={key}
                  isActive={isActive}
                  label={label}
                  groupLabel={(group) => t.or(`navSearch.group.${group.key}`, group.title)}
                  counts={navCounts}
                />
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

export default Sidebar
