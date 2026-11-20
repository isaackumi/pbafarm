import React, { createContext, useContext, useEffect, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from './AuthContext'
import { useTheme } from './ThemeContext'
import { checkBrandAccent } from '../convex/lib/contrast'

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
  // White button text must stay readable (WCAG AA, CUSTOM-006): a pale brand
  // colour is applied as its nearest accessible variant; the stored value is unchanged.
  const accent = checkBrandAccent(branding?.accentHex || '')?.accessibleHex || '#18181B'
  root.style.setProperty('--lagoon-950', accent)
  root.style.setProperty('--lagoon-800', lightenHex(accent, 14))
  root.style.setProperty('--lagoon-700', lightenHex(accent, 28))
  root.style.setProperty('--waterline', accent)
  root.style.setProperty('--input-focus', accent)

  const dark = resolvedMode === 'dark'
  root.classList.toggle('dark', dark)
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
}

export function CompanySettingsProvider({ children }) {
  const { user: authUser, canUseApp } = useAuth()
  // Tenant data only once access is confirmed (password changed, company approved).
  const user = canUseApp ? authUser : null
  const { theme, systemTheme, explicitTheme, adoptDefaultTheme } = useTheme()
  const data = useQuery(
    api.companies.getEffectiveSettings,
    user ? {} : 'skip',
  )

  const settings = data?.settings
  const company = data?.company

  const companyMode = settings?.branding?.themeMode || 'light'
  // One source of truth for what is on screen: the user's toggle when they
  // have used it in this browser, otherwise the company default (or the
  // system setting when the company chose "system"). The theme context is
  // told about the default so the toggle never shows dark over a light page.
  const resolvedMode = useMemo(() => {
    if (explicitTheme) return theme
    if (companyMode === 'system') return systemTheme
    return companyMode === 'dark' ? 'dark' : 'light'
  }, [explicitTheme, theme, companyMode, systemTheme])

  useEffect(() => {
    if (!settings?.branding) return
    adoptDefaultTheme(resolvedMode)
    applyBrandToDocument(settings.branding, resolvedMode)
    // adoptDefaultTheme is recreated each render; resolvedMode carries the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.branding, resolvedMode])

  const value = useMemo(
    () => ({
      settings,
      company,
      terminology: company?.terminology || {},
      displayName:
        settings?.branding?.displayName || company?.name || 'Anowa',
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
      terminology: {},
      displayName: 'Anowa',
      logoUrl: null,
      currency: 'GHS',
      loading: false,
    }
  }
  return ctx
}
