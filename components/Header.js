import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  Bell,
  CircleHelp,
  MapPin,
  Menu,
  Moon,
  Sun,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useNotifications } from '../contexts/NotificationContext'
import { useLocation } from '../contexts/LocationContext'
import { useTour } from './TourProvider'

const TopBar = ({ title = 'Dashboard', onOpenMenu }) => {
  const { user, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { startSystemWalkthrough } = useTour()
  const {
    locations,
    activeLocationId,
    setActiveLocation,
    loading: locationLoading,
  } = useLocation()
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
  const avatarLetter = fullName.charAt(0).toUpperCase()
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
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
    setProfileDropdownOpen(false)
    await signOut()
  }

  const handleNotifClick = async (n) => {
    if (!n.read) await markAsRead(n._id || n.id)
  }

  return (
    <header className="print:hidden bg-surface sticky top-0 z-30 text-chart-ink">
      <div className="flex justify-between items-center gap-2 px-4 sm:px-8 h-16 border-b border-foam-deep">
        <div className="flex items-center gap-2 min-w-0">
          {typeof onOpenMenu === 'function' && (
            <button
              type="button"
              onClick={onOpenMenu}
              className="lg:hidden -ml-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-chart-ink hover:bg-foam focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
          )}
          <h1
            className="font-display text-lg sm:text-xl font-medium text-chart-ink truncate"
            data-tour="header-title"
          >
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div
            className="flex items-center gap-2 min-h-11"
            data-tour="location-switcher"
          >
            <MapPin
              size={18}
              className="text-muted shrink-0"
              aria-hidden
            />
            {locations.length > 0 ? (
              <select
                aria-label="Farm location"
                className="max-w-[7.5rem] sm:max-w-[10rem] md:max-w-[14rem] text-sm border border-input-border rounded-lg bg-surface px-3 h-10 text-chart-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                value={activeLocationId || ''}
                disabled={locationLoading}
                title="Changing location refreshes the page"
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
            ) : (
              <Link
                href="/farm-locations"
                className="text-xs sm:text-sm font-semibold text-lagoon-800 hover:underline whitespace-nowrap"
              >
                Set location
              </Link>
            )}
          </div>

          <div
            className="relative hidden sm:block"
            id="tour-help-menu"
            ref={helpRef}
            data-tour="tour-help"
          >
            <button
              type="button"
              className="relative text-muted hover:text-chart-ink hover:bg-foam focus:outline-none focus-visible:ring-2 focus-visible:ring-lake rounded-lg cursor-pointer h-11 w-11 flex items-center justify-center transition-colors"
              aria-label="Help and walkthrough"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((o) => !o)}
            >
              <CircleHelp size={20} />
            </button>
            {helpOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-surface border border-foam-deep rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] z-50 py-1">
                <div className="px-4 py-2 text-sm font-semibold text-chart-ink border-b border-foam-deep">
                  Help
                </div>
                <button
                  type="button"
                  className="block w-full text-left px-4 py-2.5 text-sm text-chart-ink hover:bg-foam"
                  onClick={() => {
                    setHelpOpen(false)
                    startSystemWalkthrough()
                  }}
                >
                  Start full system walkthrough
                </button>
                <p className="px-4 py-2 text-xs text-muted leading-relaxed">
                  Guided tour of cages, feed stock, stocking, daily entry,
                  harvest, and inventory.
                </p>
              </div>
            )}
          </div>

          <div className="relative" id="notif-dropdown" ref={notifDropdownRef}>
            <button
              className="relative text-muted hover:text-chart-ink hover:bg-foam focus:outline-none focus-visible:ring-2 focus-visible:ring-lake rounded-lg cursor-pointer h-11 w-11 flex items-center justify-center transition-colors"
              aria-label="Notifications"
              onClick={() => setNotifDropdownOpen((open) => !open)}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[0.5rem] h-2 px-0.5 bg-signal rounded-full" />
              )}
            </button>
            {notifDropdownOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-surface border border-foam-deep rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] z-50 py-1 max-h-96 overflow-y-auto">
                <div className="px-4 py-2 text-sm font-semibold text-chart-ink border-b border-foam-deep flex items-center justify-between">
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllAsRead()}
                      className="text-xs font-medium text-lagoon-800 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                {notifLoading && (
                  <div className="px-4 py-3 text-sm text-muted">Loading…</div>
                )}
                {!notifLoading && notifications.length === 0 && (
                  <div className="px-4 py-3 text-sm text-muted">No notifications</div>
                )}
                {!notifLoading &&
                  notifications.map((n) => (
                    <button
                      key={n._id || n.id}
                      type="button"
                      onClick={() => handleNotifClick(n)}
                      className={`w-full text-left px-4 py-2.5 text-sm border-b border-foam-deep/60 last:border-0 ${
                        n.read
                          ? 'text-muted'
                          : 'text-chart-ink font-medium bg-foam/50'
                      } hover:bg-foam cursor-pointer`}
                    >
                      <div className="font-semibold text-chart-ink">{n.title}</div>
                      <div className="text-xs mt-0.5 line-clamp-2">{n.message}</div>
                      {n.link && (
                        <Link
                          href={n.link}
                          className="text-xs text-lagoon-800 mt-1 inline-block"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open
                        </Link>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>

          <button
            type="button"
            data-tour="theme-toggle"
            className="hidden sm:flex text-muted hover:text-chart-ink hover:bg-foam focus:outline-none focus-visible:ring-2 focus-visible:ring-lake rounded-lg h-11 w-11 items-center justify-center transition-colors"
            aria-label="Toggle theme"
            onClick={toggleTheme}
          >
            {theme === 'light' ? (
              <Moon size={20} />
            ) : (
              <Sun size={20} />
            )}
          </button>

          <div className="relative" id="user-profile-dropdown" ref={profileDropdownRef}>
            <button
              className="flex items-center space-x-3 focus:outline-none"
              onClick={() => setProfileDropdownOpen((open) => !open)}
              aria-haspopup="true"
              aria-expanded={profileDropdownOpen}
            >
              <div className="w-9 h-9 bg-lagoon-950 rounded-full flex items-center justify-center text-white font-medium text-sm">
                {avatarLetter}
              </div>
              <div className="hidden sm:block text-right">
                <div className="text-sm font-medium text-chart-ink truncate max-w-[120px]">
                  {fullName}
                </div>
                <div className="text-xs text-muted font-data">{role}</div>
              </div>
            </button>
            {profileDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-surface border border-foam-deep rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] z-50 py-1">
                <div className="px-4 py-2 text-xs text-muted border-b border-foam-deep font-data">
                  {email}
                </div>
                <Link
                  href="/account"
                  className="block w-full text-left px-4 py-2 text-sm text-chart-ink hover:bg-foam"
                  onClick={() => setProfileDropdownOpen(false)}
                >
                  Account & password
                </Link>
                <button
                  className="block w-full text-left px-4 py-2 text-sm text-signal hover:bg-foam"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

export default TopBar
