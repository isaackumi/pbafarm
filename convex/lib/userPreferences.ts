/**
 * Per-user display preferences (CUSTOM-007). Shared by the Convex module and
 * the browser (contexts/SettingsContext.js) so both apply the same defaults
 * and rules.
 */

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const
export const TIME_FORMATS = ['12h', '24h'] as const
export const TIME_RANGES = ['7d', '30d', '90d', '1y'] as const
/** Home greeting header: the plain page title, or the "Sky & lake" panel (Paper L · 01 Home). */
export const HOME_HEADERS = ['plain', 'sky'] as const
export type HomeHeader = (typeof HOME_HEADERS)[number]

/** The Home header to show: the user's choice, else "Sky & lake" in light and plain in dark. */
export function effectiveHomeHeader(choice: unknown, theme: string | undefined): HomeHeader {
  if (choice === 'plain' || choice === 'sky') return choice
  return theme === 'light' ? 'sky' : 'plain'
}
/** The phone bottom bar holds at most this many shortcuts plus "More" (UX-004). */
export const MAX_MOBILE_SHORTCUTS = 5

export type NotificationPrefs = {
  email: boolean
  push: boolean
  lowFeed: boolean
  mortalityAlert: boolean
  waterQualityAlert: boolean
}

export type DashboardPrefs = {
  defaultTimeRange: string
  showCharts: boolean
  showMetrics: boolean
  showStockings: boolean
  /**
   * Unset = follow the theme (see effectiveHomeHeader): "Sky & lake" in the
   * light theme, plain in the dark theme. Set only when the user picks one.
   */
  homeHeader?: HomeHeader
}

export type Preferences = {
  dateFormat: string
  timeFormat: string
  currency: string
  notifications: NotificationPrefs
  dashboard: DashboardPrefs
  /** null = the default shortcuts for this member's permissions. */
  mobileShortcuts: string[] | null
}

export const DEFAULT_PREFERENCES: Preferences = {
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12h',
  currency: 'GHS',
  notifications: {
    email: true,
    push: true,
    lowFeed: true,
    mortalityAlert: true,
    waterQualityAlert: true,
  },
  dashboard: {
    defaultTimeRange: '30d',
    showCharts: true,
    showMetrics: true,
    showStockings: true,
  },
  mobileShortcuts: null,
}

const NOTIFICATION_KEYS = Object.keys(DEFAULT_PREFERENCES.notifications) as (keyof NotificationPrefs)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A route path the app can link to: `/x` or `/x/y`, no query or host. */
export function isShortcutPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && /^\/[a-z0-9\-/]*$/.test(value) && !value.includes('//')
}

/** Unique valid paths, in order, at most MAX_MOBILE_SHORTCUTS. */
export function cleanShortcuts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const p of value) {
    if (isShortcutPath(p) && !out.includes(p)) out.push(p)
    if (out.length === MAX_MOBILE_SHORTCUTS) break
  }
  return out
}

/**
 * Keep only valid, known fields from untrusted input (old browser settings,
 * a stale cache). Invalid values are dropped, never thrown.
 */
export function cleanPreferences(input: unknown): Partial<Preferences> {
  if (!isRecord(input)) return {}
  const out: Partial<Preferences> = {}
  if ((DATE_FORMATS as readonly unknown[]).includes(input.dateFormat)) out.dateFormat = input.dateFormat as string
  if ((TIME_FORMATS as readonly unknown[]).includes(input.timeFormat)) out.timeFormat = input.timeFormat as string
  if (typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency)) out.currency = input.currency
  if (isRecord(input.notifications)) {
    const n = input.notifications
    if (NOTIFICATION_KEYS.every((k) => typeof n[k] === 'boolean')) {
      out.notifications = Object.fromEntries(NOTIFICATION_KEYS.map((k) => [k, n[k]])) as NotificationPrefs
    }
  }
  if (isRecord(input.dashboard)) {
    const d = input.dashboard
    if (
      (TIME_RANGES as readonly unknown[]).includes(d.defaultTimeRange) &&
      typeof d.showCharts === 'boolean' &&
      typeof d.showMetrics === 'boolean' &&
      typeof d.showStockings === 'boolean' &&
      (d.homeHeader === undefined || (HOME_HEADERS as readonly unknown[]).includes(d.homeHeader))
    ) {
      out.dashboard = {
        defaultTimeRange: d.defaultTimeRange as string,
        showCharts: d.showCharts,
        showMetrics: d.showMetrics,
        showStockings: d.showStockings,
        ...(d.homeHeader === undefined ? {} : { homeHeader: d.homeHeader as HomeHeader }),
      }
    }
  }
  if (input.mobileShortcuts === null) out.mobileShortcuts = null
  else {
    const shortcuts = cleanShortcuts(input.mobileShortcuts)
    if (shortcuts) out.mobileShortcuts = shortcuts
  }
  return out
}

/** Defaults overlaid with saved values (both may be partial or missing). */
export function resolvePreferences(...layers: unknown[]): Preferences {
  let out: Preferences = { ...DEFAULT_PREFERENCES }
  for (const layer of layers) out = { ...out, ...cleanPreferences(layer) }
  return out
}

/** Fields in `input` that are present but not valid; empty when all are fine. */
export function invalidPreferenceFields(input: Record<string, unknown>): string[] {
  const clean = cleanPreferences(input) as Record<string, unknown>
  const bad = Object.keys(input).filter((k) => input[k] !== undefined && !(k in clean))
  // Shortcuts must all be valid as given: none dropped, none past the limit.
  const shortcuts = input.mobileShortcuts
  if (Array.isArray(shortcuts) && !bad.includes('mobileShortcuts')) {
    const kept = clean.mobileShortcuts as string[]
    if (kept.length !== shortcuts.length || shortcuts.length > MAX_MOBILE_SHORTCUTS) bad.push('mobileShortcuts')
  }
  return bad
}
