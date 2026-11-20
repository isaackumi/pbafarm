import React, { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

export const CONTRAST_KEY = 'pbafarm:contrast'
// The company's default theme, remembered so pages/_document.js can apply it
// before paint for someone who has never used the toggle.
export const THEME_DEFAULT_KEY = 'pbafarm:theme-default'

function applyThemeToDocument(mode) {
  if (typeof document === 'undefined') return
  const dark = mode === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0a0b0c' : '#f4f7fb')
}

export function ThemeProvider({ children }) {
  // Dark is the default (Paper redesign); pages/_document.js applies the saved
  // choice before paint so there is no flash.
  const [theme, setTheme] = useState('dark')
  // True once this browser has a theme the user picked with the toggle; until
  // then the company's default (CompanySettingsContext) decides.
  const [explicit, setExplicit] = useState(false)
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
    let fallback = null
    try {
      savedTheme = localStorage.getItem('theme')
      fallback = localStorage.getItem(THEME_DEFAULT_KEY)
    } catch {
      // storage blocked
    }
    const picked = savedTheme === 'light' || savedTheme === 'dark'
    const next = picked ? savedTheme : fallback === 'light' ? 'light' : 'dark'
    setExplicit(picked)
    setTheme(next)
    applyThemeToDocument(next)
  }, [])

  // The user's own choice: saved in this browser and wins over the company default.
  const updateTheme = (newTheme) => {
    setTheme(newTheme)
    setExplicit(true)
    try {
      localStorage.setItem('theme', newTheme)
    } catch {
      // storage blocked: applies for this visit only
    }
    applyThemeToDocument(newTheme)
  }

  // The company's default, used only while the user has not picked one, so
  // the toggle always shows the theme that is actually on screen.
  const adoptDefaultTheme = (mode) => {
    if (explicit || (mode !== 'light' && mode !== 'dark')) return
    try {
      localStorage.setItem(THEME_DEFAULT_KEY, mode)
    } catch {
      // storage blocked
    }
    if (mode === theme) return
    setTheme(mode)
    applyThemeToDocument(mode)
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
    explicitTheme: explicit,
    updateTheme,
    adoptDefaultTheme,
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