import React, { useState, useRef, useEffect } from 'react'
import { Bell, Sun, Moon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'

const dummyNotifications = [
  { id: 1, text: 'New member registered', read: false },
  { id: 2, text: 'Feed inventory low', read: false },
  { id: 3, text: 'Cage 3 needs attention', read: true },
]

const TopBar = ({ title = 'Dashboard' }) => {
  const { user, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const fullName = user?.name || user?.user_metadata?.full_name || user?.email || 'User'
  const role = user?.role || user?.user_metadata?.role || 'User'
  const email = user?.email || ''
  const avatarLetter = fullName.charAt(0).toUpperCase()
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false)
  const profileDropdownRef = useRef(null)
  const notifDropdownRef = useRef(null)

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
    }
    if (profileDropdownOpen || notifDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [profileDropdownOpen, notifDropdownOpen])

  const handleLogout = async () => {
    setProfileDropdownOpen(false)
    await signOut()
  }

  const unreadCount = dummyNotifications.filter((n) => !n.read).length

  return (
    <header className="bg-surface sticky top-0 z-30">
      <div className="waterline" />
      <div className="flex justify-between items-center px-6 py-4 border-b border-foam-deep">
        <h1 className="text-xl font-semibold text-chart-ink tracking-tight">{title}</h1>

        <div className="flex items-center space-x-6">
          <div className="relative" id="notif-dropdown" ref={notifDropdownRef}>
            <button
              className="relative p-2 text-muted hover:text-lagoon-800 focus:outline-none"
              aria-label="Notifications"
              onClick={() => setNotifDropdownOpen((open) => !open)}
            >
              <Bell className="w-6 h-6" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-signal rounded-full" />
              )}
            </button>
            {notifDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-surface border border-foam-deep rounded-md shadow-lg z-50 py-1">
                <div className="px-4 py-2 text-sm font-semibold text-chart-ink border-b border-foam-deep">
                  Notifications
                </div>
                {dummyNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-4 py-2 text-sm ${
                      n.read ? 'text-muted' : 'text-chart-ink font-medium'
                    } hover:bg-foam cursor-pointer`}
                  >
                    {n.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            className="p-2 text-muted hover:text-lagoon-800 focus:outline-none"
            aria-label="Toggle theme"
            onClick={toggleTheme}
          >
            {theme === 'light' ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
          </button>

          <div className="relative" id="user-profile-dropdown" ref={profileDropdownRef}>
            <button
              className="flex items-center space-x-3 focus:outline-none"
              onClick={() => setProfileDropdownOpen((open) => !open)}
              aria-haspopup="true"
              aria-expanded={profileDropdownOpen}
            >
              <div className="w-10 h-10 bg-lagoon-800 rounded-full flex items-center justify-center text-foam font-semibold text-lg">
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
              <div className="absolute right-0 mt-2 w-56 bg-surface border border-foam-deep rounded-md shadow-lg z-50 py-1">
                <div className="px-4 py-2 text-xs text-muted border-b border-foam-deep font-data">
                  {email}
                </div>
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
