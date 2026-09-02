import React, { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light')
  const [systemTheme, setSystemTheme] = useState('light')

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
    const savedTheme = localStorage.getItem('theme')
    const next = savedTheme || systemTheme
    setTheme(next)
    if (typeof document !== 'undefined') {
      const dark = next === 'dark'
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
  }, [systemTheme])

  // Update theme — apply class immediately for user preference
  const updateTheme = (newTheme) => {
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    if (typeof document !== 'undefined') {
      const dark = newTheme === 'dark'
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
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
    useSystemTheme
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