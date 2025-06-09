// components/Header.js (Updated)
import React, { useState, useRef, useEffect } from 'react'
import { Bell, Sun, Moon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const dummyNotifications = [
  { id: 1, text: 'New member registered', read: false },
  { id: 2, text: 'Feed inventory low', read: false },
  { id: 3, text: 'Cage 3 needs attention', read: true },
]

const TopBar = ({ title }) => {
  const { user, signOut } = useAuth()
  const fullName = user?.user_metadata?.full_name || user?.email || 'User'
  const role = user?.user_metadata?.role || 'User'
  const email = user?.email || ''
  const avatarLetter = fullName.charAt(0).toUpperCase()
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false)
  const [theme, setTheme] = useState('light')
  const profileDropdownRef = useRef(null)
  const notifDropdownRef = useRef(null)

  // Theme toggle
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Close dropdowns on outside click
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

  const unreadCount = dummyNotifications.filter(n => !n.read).length

  return (
    <header className="bg-white dark:bg-gray-900 shadow sticky top-0 z-30">
      <div className="flex justify-between items-center px-6 py-4">
        {/* Page Title */}
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{title}</h1>

        {/* Right Side: Notification, Theme, User Info with Dropdown */}
        <div className="flex items-center space-x-6">
          {/* Notification Bell */}
          <div className="relative" id="notif-dropdown" ref={notifDropdownRef}>
            <button
              className="relative p-2 text-gray-500 hover:text-indigo-600 focus:outline-none"
              aria-label="Notifications"
              onClick={() => setNotifDropdownOpen(open => !open)}
            >
              <Bell className="w-6 h-6" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
              )}
            </button>
            {notifDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 py-1">
                <div className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-700">Notifications</div>
                {dummyNotifications.length === 0 ? (
                  <div className="px-4 py-2 text-sm text-gray-500">No notifications</div>
                ) : (
                  dummyNotifications.map(n => (
                    <div key={n.id} className={`px-4 py-2 text-sm ${n.read ? 'text-gray-400' : 'text-gray-800 dark:text-gray-100 font-medium'} hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer`}>
                      {n.text}
                    </div>
                  ))
                )}
                <div className="px-4 py-2 text-xs text-indigo-600 hover:underline cursor-pointer border-t border-gray-100 dark:border-gray-700">Mark all as read</div>
              </div>
            )}
          </div>
          {/* Theme Switcher */}
          <button
            className="p-2 text-gray-500 hover:text-indigo-600 focus:outline-none"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
          </button>
          {/* User Info with Dropdown */}
          <div className="relative" id="user-profile-dropdown" ref={profileDropdownRef}>
            <button
              className="flex items-center space-x-3 focus:outline-none"
              onClick={() => setProfileDropdownOpen((open) => !open)}
              aria-haspopup="true"
              aria-expanded={profileDropdownOpen}
            >
              <div className="w-10 h-10 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                {avatarLetter}
              </div>
              <div className="hidden sm:block text-right">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[120px]">{fullName}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{role}</div>
              </div>
              <svg className="w-4 h-4 ml-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {profileDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 py-1">
                <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">{email}</div>
                <button className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileDropdownOpen(false)}>
                  My Profile
                </button>
                <button className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileDropdownOpen(false)}>
                  Account Settings
                </button>
                <button className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileDropdownOpen(false)}>
                  Help
                </button>
                <div className="border-t border-gray-100 dark:border-gray-700 my-1"></div>
                <button className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={handleLogout}>
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
