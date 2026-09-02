import React, { createContext, useContext, useEffect, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from './AuthContext'
import { useTheme } from './ThemeContext'

const CompanySettingsContext = createContext(null)

function lightenHex(hex, amount = 12) {
  const raw = (hex || '#18181B').replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (full.length !== 6) return hex
  const num = parseInt(full, 16)
  let r = (num >> 16) + amount
  let g = ((num >> 8) & 0xff) + amount
  let b = (num & 0xff) + amount
  r = Math.min(255, Math.max(0, r))
  g = Math.min(255, Math.max(0, g))
  b = Math.min(255, Math.max(0, b))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

export function applyBrandToDocument(branding, resolvedMode) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const accent = branding?.accentHex || '#18181B'
  root.style.setProperty('--lagoon-950', accent)
  root.style.setProperty('--lagoon-800', lightenHex(accent, 14))
  root.style.setProperty('--lagoon-700', lightenHex(accent, 28))
  root.style.setProperty(
    '--waterline',
    `linear-gradient(90deg, ${accent} 0%, ${lightenHex(accent, 28)} 100%)`,
  )
  root.style.setProperty('--input-focus', accent)

  const dark = resolvedMode === 'dark'
  root.classList.toggle('dark', dark)
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
}

export function CompanySettingsProvider({ children }) {
  const { user } = useAuth()
  const { theme, systemTheme } = useTheme()
  const data = useQuery(
    api.companies.getEffectiveSettings,
    user ? {} : 'skip',
  )

  const settings = data?.settings
  const company = data?.company

  const companyMode = settings?.branding?.themeMode || 'light'
  const resolvedMode = useMemo(() => {
    // Prefer the user's header toggle when company theme is "system"
    // or when the user has explicitly chosen light/dark in this browser.
    if (companyMode === 'system') {
      return theme === 'dark' || theme === 'light' ? theme : systemTheme
    }
    // If the user toggled theme this session, respect it over company default.
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme')
      if (saved === 'dark' || saved === 'light') return saved
    }
    return companyMode
  }, [companyMode, theme, systemTheme])

  useEffect(() => {
    if (!settings?.branding) return
    applyBrandToDocument(settings.branding, resolvedMode)
  }, [settings?.branding, resolvedMode])

  const value = useMemo(
    () => ({
      settings,
      company,
      displayName:
        settings?.branding?.displayName || company?.name || 'PBA Farm',
      logoUrl: company?.logo_url,
      currency: settings?.locale?.currency || 'GHS',
      loading: user && data === undefined,
    }),
    [settings, company, user, data],
  )

  return (
    <CompanySettingsContext.Provider value={value}>
      {children}
    </CompanySettingsContext.Provider>
  )
}

export function useCompanySettings() {
  const ctx = useContext(CompanySettingsContext)
  if (!ctx) {
    return {
      settings: null,
      company: null,
      displayName: 'PBA Farm',
      logoUrl: null,
      currency: 'GHS',
      loading: false,
    }
  }
  return ctx
}
