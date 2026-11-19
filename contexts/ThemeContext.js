import React, { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

export const CONTRAST_KEY = 'pbafarm:contrast'

export function ThemeProvider({ children }) {
  // Dark is the default (Paper redesign); pages/_document.js applies the saved
  // choice before paint so there is no flash.
  const [theme, setTheme] = useState('dark')
  const [systemTheme, setSystemTheme] = useState('light')
  // Outdoor mode (UX-006): 'high' contrast for bright sun, kept per device.
  const [contrast, setContrastState] = useState('normal')

  useEffect(() => {
    let saved = null
    try {
      saved = localStorage.getItem(CONTRAST_KEY)
    } catch {
      // storage blocked
    }
    if (saved === 'high') setContrastState('high')
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (contrast === 'high') document.documentElement.dataset.contrast = 'high'
    else delete document.documentElement.dataset.contrast
  }, [contrast])

  const setContrast = (next) => {
    const value = next === 'high' ? 'high' : 'normal'
    setContrastState(value)
    try {
      localStorage.setItem(CONTRAST_KEY, value)
    } catch {
      // storage blocked: applies for this visit only
    }
  }

  // Check system theme preference
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light')

    const handleChange = (e) => {
      setSystemTheme(e.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  // Load saved theme preference and apply to <html>
  useEffect(() => {
    let savedTheme = null
    try {
      savedTheme = localStorage.getItem('theme')
    } catch {
      // storage blocked
    }
    const next = savedTheme === 'light' ? 'light' : 'dark'
    setTheme(next)
    if (typeof document !== 'undefined') {
      const dark = next === 'dark'
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
  }, [])

  // Update theme — apply class immediately for user preference
  const updateTheme = (newTheme) => {
    setTheme(newTheme)
    try {
      localStorage.setItem('theme', newTheme)
    } catch {
      // storage blocked: applies for this visit only
    }
    if (typeof document !== 'undefined') {
      const dark = newTheme === 'dark'
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#0a0b0c' : '#f5f6f7')
    }
  }

  // Toggle between light and dark
  const toggleTheme = () => {
    updateTheme(theme === 'light' ? 'dark' : 'light')
  }

  // Use system theme
  const useSystemTheme = () => {
    updateTheme(systemTheme)
  }

  const value = {
    theme,
    systemTheme,
    updateTheme,
    toggleTheme,
    useSystemTheme,
    contrast,
    setContrast,
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
} 