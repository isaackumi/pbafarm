import React, { useState, useRef, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import {
  Bell,
  Building2,
  Check,
  CircleHelp,
  CloudUpload,
  LogOut,
  Menu,
  Moon,
  ScanLine,
  Sun,
  UserRound,
} from 'lucide-react'
import { AnowaPulseIcon } from './brand/AnowaPulseIcon'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n/context'
import { useTheme } from '../contexts/ThemeContext'
import { useNotifications } from '../contexts/NotificationContext'
import { useTour } from './TourProvider'
import { useOutbox } from '../hooks/useOutbox'
import { api } from '../convex/_generated/api'
import { usePermissions } from '../hooks/usePermission'
import { useTerm } from '../hooks/useTerm'
import { navKey } from '../lib/i18n'
import { NAV_ITEMS } from '../lib/navigation'
import { Avatar } from './ui/Avatar'
import { SearchField } from './ui/SearchField'
import { Toggle } from './ui/Toggle'
import LanguageSwitcher from './LanguageSwitcher'
import LogoutConfirmationModal from './LogoutConfirmationModal'
import { AnowaMark } from './brand/AnowaLogo'
import { useToast } from './Toast'
import { useActiveOrganization } from '../lib/useActiveOrganization'

/**
 * Organizations I belong to (ORG-002). Shown in the profile menu; switching
 * reloads the app so every cached query and the site picker start fresh.
 */
function OrganizationMenu({ onDone }) {
  const t = useT()
  const { orgs, switching, switchTo } = useActiveOrganization()
  if (!orgs || orgs.length === 0) return null
  const choose = async (org) => {
    if (org.isActive || switching) return
    // switchTo starts the reload on success; the menu shows "Switching…" until then.
    if (await switchTo(org.companyId)) onDone?.()
  }
  return (
    <div className="border-b border-line py-1">
      <div className="px-4 pt-1 pb-1 text-xs text-muted">{t('farmSwitcher.organization')}</div>
      {orgs.map((org) => (
        <button
          key={org.companyId}
          type="button"
          disabled={org.companyStatus !== 'approved' || !!switching}
          onClick={() => choose(org)}
          className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-text hover:bg-surface-2 disabled:opacity-50"
        >
          <Building2 size={16} className="text-muted shrink-0" aria-hidden />
          <span className="truncate flex-1">{org.name}</span>
          {org.isActive && <Check size={16} className="text-good shrink-0" aria-label={t('farmSwitcher.active')} />}
          {switching === org.companyId && <span className="text-xs text-muted">{t('farmSwitcher.switching')}</span>}
        </button>
      ))}
      <Link
        href="/register-company"
        onClick={onDone}
        className="block px-4 py-2 text-[13px] text-cyan hover:bg-surface-2"
      >
        {t('farmSwitcher.registerAnother')}
      </Link>
    </div>
  )
}

/**
 * Top-bar search (Paper DC-0): jumps to any page the member may open.
 * ⌘K / Ctrl+K focuses it; arrows + Enter pick a result.
 */
function NavSearch() {
  const router = useRouter()
  const t = useT()
  const term = useTerm()
  const { can } = usePermissions()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''))
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const seen = new Set()
    return NAV_ITEMS.filter((item) => can(item.permission))
      .map((item) => ({ ...item, label: term.text(t.or(item.labelKey || navKey(item.path), item.title)) }))
      .filter((item) => {
        if (seen.has(item.path)) return false
        seen.add(item.path)
        return item.label.toLowerCase().includes(q) || item.title.toLowerCase().includes(q)
      })
      .slice(0, 8)
  }, [query, can, t, term])

  const go = (item) => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    router.push(item.path)
  }

  return (
    <div className="relative hidden md:block w-[320px]" id="nav-search">
      <SearchField
        ref={inputRef}
        value={query}
        placeholder="Search pages"
        hint={isMac ? '⌘K' : 'Ctrl K'}
        aria-label="Search pages"
        aria-expanded={open && results.length > 0}
        aria-controls="nav-search-results"
        role="combobox"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value)
          setCursor(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setCursor((c) => Math.min(c + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(c - 1, 0))
          } else if (e.key === 'Enter' && results[cursor]) {
            e.preventDefault()
            go(results[cursor])
          } else if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
      />
      {open && results.length > 0 && (
        <ul
          id="nav-search-results"
          role="listbox"
          className="absolute left-0 right-0 mt-2 rounded-[14px] border border-line bg-surface py-1 shadow-[var(--shadow-md)] z-50"
        >
          {results.map((item, i) => {
            const Icon = item.icon
            return (
              <li key={item.path} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] leading-4 ${
                    i === cursor ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
                  }`}
                >
                  {Icon && <Icon size={14} className="shrink-0" aria-hidden />}
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * "Ask Anowa" in the top bar: one click to the assistant from any page. Shown
 * to members who may use Anowa, and to admins while it is off (the page then
 * shows how to turn it on). The floating bubble stays for in-page questions.
 */
function AskAnowaButton() {
  const t = useT()
  const { user, canUseApp } = useAuth()
  const status = useQuery(api.companies.aiAssistantStatus, user && canUseApp ? {} : 'skip')
  const show = status && (status.enabled ? status.canUse : status.canManage)
  if (!show) return null
  return (
    <Link
      href="/assistant"
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-pill border border-line-strong px-3 text-[13px] font-medium leading-4 text-text transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:px-3.5"
      aria-label={t('assistantUi.ask')}
    >
      <AnowaPulseIcon size={16} strokeWidth={2} className="shrink-0 text-text" />
      <span className="hidden sm:inline">{t('assistantUi.ask')}</span>
    </Link>
  )
}

// 40px hit area; from lg the negative margin gives each icon Paper's 20px slot
// (7Z-0: bell and avatar 20px apart).
const ICON_BTN =
  'relative flex items-center justify-center rounded-pill text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan h-10 w-10 lg:-m-2.5 transition-colors'
const MENU =
  'absolute right-0 mt-2 rounded-[14px] border border-line bg-surface py-1 shadow-[var(--shadow-md)] z-50'
const MENU_ITEM =
  'flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] leading-4 text-text hover:bg-surface-2'

const TopBar = ({ onOpenMenu }) => {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { theme, toggleTheme, contrast, setContrast } = useTheme()
  const t = useT()
  const { showToast } = useToast()
  const { startSystemWalkthrough } = useTour()
  const { count: outboxCount } = useOutbox()
  const {
    notifications,
    unreadCount,
    loading: notifLoading,
    markAsRead,
    markAllAsRead,
  } = useNotifications()
  const fullName = user?.name || user?.user_metadata?.full_name || user?.email || 'User'
  const role = user?.role || user?.user_metadata?.role || 'User'
  const email = user?.email || ''
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const profileDropdownRef = useRef(null)
  const notifDropdownRef = useRef(null)
  const helpRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        profileDropdownRef.current &&
        !event.target.closest('#user-profile-dropdown')
      ) {
        setProfileDropdownOpen(false)
      }
      if (
        notifDropdownRef.current &&
        !event.target.closest('#notif-dropdown')
      ) {
        setNotifDropdownOpen(false)
      }
      if (helpRef.current && !event.target.closest('#tour-help-menu')) {
        setHelpOpen(false)
      }
    }
    if (profileDropdownOpen || notifDropdownOpen || helpOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [profileDropdownOpen, notifDropdownOpen, helpOpen])

  const handleLogout = async () => {
    try {
      const { cancelled } = (await signOut()) || {}
      if (cancelled) return
      showToast(t('nav.loggedOut'), 'success')
      router.push('/login')
    } catch (error) {
      console.error('Logout failed:', error)
      showToast(t('nav.logoutFailed'), 'error')
    } finally {
      setShowLogoutModal(false)
    }
  }

  const handleNotifClick = async (n) => {
    if (!n.read) await markAsRead(n._id || n.id)
    if (n.link) {
      setNotifDropdownOpen(false)
      router.push(n.link)
    }
  }

  return (
    <header className="print:hidden sticky top-0 z-30 bg-bg text-text">
      <div className="flex h-16 items-center justify-between gap-2 border-b border-line px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-2">
          {typeof onOpenMenu === 'function' && (
            <button
              type="button"
              onClick={onOpenMenu}
              className="lg:hidden -ml-2 inline-flex h-11 w-11 items-center justify-center rounded-pill text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
          )}
          <NavSearch />
          <Link href="/dashboard" className="md:hidden" aria-label="Anowa">
            <AnowaMark size={32} />
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3 lg:gap-5">
          <AskAnowaButton />
          <div
            className="relative hidden sm:block"
            id="tour-help-menu"
            ref={helpRef}
            data-tour="tour-help"
          >
            <button
              type="button"
              className={ICON_BTN}
              aria-label="Help and walkthrough"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((o) => !o)}
            >
              <CircleHelp size={20} strokeWidth={1.8} />
            </button>
            {helpOpen && (
              <div className={`${MENU} w-64`}>
                <div className="px-4 py-2 text-[13px] font-semibold text-text border-b border-line">
                  Help
                </div>
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    setHelpOpen(false)
                    startSystemWalkthrough()
                  }}
                >
                  Start full system walkthrough
                </button>
                <p className="px-4 py-2 text-[12px] text-muted leading-relaxed">
                  Guided tour of cages, feed stock, stocking, daily entry,
                  harvest, and inventory.
                </p>
              </div>
            )}
          </div>

          {outboxCount > 0 && (
            <Link
              href="/outbox"
              aria-label={`${outboxCount} entr${outboxCount === 1 ? 'y' : 'ies'} waiting to send`}
              className={`${ICON_BTN} h-12 w-12 text-text`}
            >
              <CloudUpload size={20} strokeWidth={1.8} aria-hidden />
              <span className="absolute top-1 right-0.5 min-w-5 h-5 px-1 rounded-full bg-alert text-bg text-[11px] font-semibold leading-5 text-center tabular-nums">
                {outboxCount > 99 ? '99+' : outboxCount}
              </span>
            </Link>
          )}

          <Link href="/scan" aria-label="Scan cage label" className={`lg:hidden ${ICON_BTN} h-12 w-12`}>
            <ScanLine size={20} strokeWidth={1.8} aria-hidden />
          </Link>

          <div className="relative" id="notif-dropdown" ref={notifDropdownRef}>
            <button
              className={`${ICON_BTN} text-text`}
              aria-label={
                unreadCount > 0
                  ? `${t('notifications.title')} (${unreadCount})`
                  : t('notifications.title')
              }
              onClick={() => setNotifDropdownOpen((open) => !open)}
            >
              <span className="relative size-5">
                <Bell size={20} strokeWidth={1.8} aria-hidden />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-pill bg-button text-[10px] font-semibold leading-3 text-button-text tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
            </button>
            {notifDropdownOpen && (
              <div className={`${MENU} w-80 max-h-96 overflow-y-auto`}>
                <div className="px-4 py-2 text-[13px] font-semibold text-text border-b border-line flex items-center justify-between">
                  <span>{t('notifications.title')}</span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllAsRead()}
                      className="text-[12px] font-medium text-cyan hover:underline"
                    >
                      {t('notifications.markAllRead')}
                    </button>
                  )}
                </div>
                {notifLoading && (
                  <div className="px-4 py-3 text-[13px] text-muted">{t('common.loading')}</div>
                )}
                {!notifLoading && notifications.length === 0 && (
                  <div className="px-4 py-3 text-[13px] text-muted">{t('notifications.empty')}</div>
                )}
                {!notifLoading &&
                  notifications.map((n) => (
                    <button
                      key={n._id || n.id}
                      type="button"
                      onClick={() => handleNotifClick(n)}
                      className={`w-full text-left px-4 py-2.5 text-[13px] border-b border-line last:border-0 ${
                        n.read ? 'text-muted' : 'text-text bg-surface-2/50'
                      } hover:bg-surface-2 cursor-pointer`}
                    >
                      <div className="font-medium text-text">{n.title}</div>
                      <div className="text-[12px] mt-0.5 line-clamp-3">{n.message}</div>
                      {n.link && <div className="text-[12px] text-cyan mt-1">{t('notifications.open')}</div>}
                    </button>
                  ))}
                <Link
                  href="/notifications"
                  onClick={() => setNotifDropdownOpen(false)}
                  className="block px-4 py-2.5 text-[13px] font-medium text-text hover:bg-surface-2 text-center"
                >
                  {t('notifications.viewAll')}
                </Link>
              </div>
            )}
          </div>

          <div className="relative" id="user-profile-dropdown" ref={profileDropdownRef}>
            <button
              type="button"
              data-tour="theme-toggle"
              className="flex items-center rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              onClick={() => setProfileDropdownOpen((open) => !open)}
              aria-haspopup="true"
              aria-expanded={profileDropdownOpen}
              aria-label={`${fullName}, profile and theme`}
            >
              <Avatar name={fullName} size={32} />
            </button>
            {profileDropdownOpen && (
              <div className={`${MENU} w-72`}>
                <div className="px-4 py-2.5 border-b border-line">
                  <div className="text-[14px] font-medium leading-[18px] text-text truncate">{fullName}</div>
                  <div className="text-[12px] leading-4 text-muted truncate">{email || role}</div>
                </div>
                <OrganizationMenu onDone={() => setProfileDropdownOpen(false)} />
                <div className="border-b border-line py-1">
                  <div className={`${MENU_ITEM} justify-between hover:bg-transparent`}>
                    <span className="flex items-center gap-2.5">
                      {theme === 'light' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
                      {theme === 'light' ? 'Light theme' : 'Dark theme'}
                    </span>
                    <Toggle
                      checked={theme === 'dark'}
                      onChange={toggleTheme}
                      label="Dark theme"
                    />
                  </div>
                  <div className={`${MENU_ITEM} justify-between hover:bg-transparent`}>
                    <span>
                      <span className="block">{t('ui.outdoorMode')}</span>
                      <span className="block text-[12px] text-muted">{t('ui.outdoorModeHint')}</span>
                    </span>
                    <Toggle
                      checked={contrast === 'high'}
                      onChange={(on) => setContrast(on ? 'high' : 'normal')}
                      label={t('ui.outdoorMode')}
                    />
                  </div>
                  <div className="px-4 py-2">
                    <LanguageSwitcher />
                  </div>
                </div>
                <Link
                  href="/account"
                  className={MENU_ITEM}
                  onClick={() => setProfileDropdownOpen(false)}
                >
                  <UserRound size={16} aria-hidden />
                  Account & password
                </Link>
                <button
                  type="button"
                  className={`${MENU_ITEM} text-alert`}
                  onClick={() => {
                    setProfileDropdownOpen(false)
                    setShowLogoutModal(true)
                  }}
                >
                  <LogOut size={16} aria-hidden />
                  {t('nav.logOut')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {showLogoutModal && (
        <LogoutConfirmationModal
          isOpen={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={handleLogout}
        />
      )}
    </header>
  )
}

export default TopBar
