import React, { createContext, useContext, useState, useEffect } from 'react'

const SettingsContext = createContext()

const DEFAULT_SETTINGS = {
  language: 'en',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  currency: 'GHS',
  notifications: {
    email: true,
    push: true,
    lowFeed: true,
    mortalityAlert: true,
    waterQualityAlert: true
  },
  dashboard: {
    defaultTimeRange: '30d',
    showCharts: true,
    showMetrics: true,
    showStockings: true
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load settings from localStorage
    const loadSettings = () => {
      try {
        const savedSettings = localStorage.getItem('userSettings')
        if (savedSettings) {
          setSettings(JSON.parse(savedSettings))
        }
      } catch (error) {
        console.error('Error loading settings:', error)
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  const updateSettings = (newSettings) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings }
      // Save to localStorage
      localStorage.setItem('userSettings', JSON.stringify(updated))
      return updated
    })
  }

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS)
    localStorage.setItem('userSettings', JSON.stringify(DEFAULT_SETTINGS))
  }

  const value = {
    settings,
    loading,
    updateSettings,
    resetSettings
  }

  if (loading) {
    return <div>Loading settings...</div>
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
} 