/**
 * Dashboard layouts (CUSTOM-005, D-007): an organization default and a
 * per-user override, each an ordered list of widgets from the code catalog.
 * Every widget reads existing rollup/report queries, so a layout can never
 * create a new or unbounded query. No imports, so the browser shares it.
 */

export type WidgetSize = 'sm' | 'md' | 'half' | 'lg' | 'full'
export type DashboardWidget = { widget: string; size: WidgetSize }

export const WIDGET_SIZES: WidgetSize[] = ['sm', 'md', 'half', 'lg', 'full']

/** Labels: i18n `dashboardLayout.widget.<key with . → _>`. */
export const WIDGET_CATALOG: Record<string, { defaultSize: WidgetSize; permission?: string }> = {
  'stat.activeUnits': { defaultSize: 'sm' },
  'stat.biomass': { defaultSize: 'sm' },
  'stat.fcr': { defaultSize: 'sm' },
  'stat.mortality': { defaultSize: 'sm' },
  'stat.health': { defaultSize: 'md' },
  'stat.adg': { defaultSize: 'sm' },
  'stat.feed30d': { defaultSize: 'sm' },
  insights: { defaultSize: 'lg' },
  'chart.feedTrend': { defaultSize: 'lg' },
  'chart.mortality': { defaultSize: 'md' },
  siteConditions: { defaultSize: 'full' },
  recentActivity: { defaultSize: 'full' },
  feedingPlan: { defaultSize: 'md', permission: 'production.view' },
}

export const WIDGET_KEYS = Object.keys(WIDGET_CATALOG)
export const DASHBOARD_KEYS = ['home'] as const
export const MAX_WIDGETS = 30

/** Today's dashboard. */
export const DEFAULT_DASHBOARD: DashboardWidget[] = [
  { widget: 'stat.activeUnits', size: 'sm' },
  { widget: 'stat.biomass', size: 'sm' },
  { widget: 'stat.fcr', size: 'sm' },
  { widget: 'stat.mortality', size: 'sm' },
  { widget: 'stat.health', size: 'md' },
  { widget: 'insights', size: 'lg' },
  { widget: 'chart.feedTrend', size: 'lg' },
  { widget: 'chart.mortality', size: 'md' },
  { widget: 'siteConditions', size: 'full' },
  { widget: 'recentActivity', size: 'full' },
]

export function isWidgetKey(k: string): boolean {
  return Object.prototype.hasOwnProperty.call(WIDGET_CATALOG, k)
}

/** Problems with a layout as it would be saved; [] when valid. */
export function dashboardProblems(widgets: DashboardWidget[]): string[] {
  const out: string[] = []
  if (widgets.length > MAX_WIDGETS) out.push(`At most ${MAX_WIDGETS} widgets`)
  const seen = new Set<string>()
  for (const w of widgets) {
    if (!isWidgetKey(w.widget)) out.push(`Unknown widget "${w.widget}"`)
    else if (seen.has(w.widget)) out.push(`Widget "${w.widget}" appears twice`)
    if (!WIDGET_SIZES.includes(w.size)) out.push(`Unknown size "${w.size}"`)
    seen.add(w.widget)
  }
  return out
}

/** A stored layout read defensively: unknown or repeated widgets dropped (catalog changed since). */
export function cleanDashboard(widgets: DashboardWidget[] | null | undefined): DashboardWidget[] {
  const seen = new Set<string>()
  return (widgets ?? []).filter((w) => {
    if (!isWidgetKey(w.widget) || seen.has(w.widget) || !WIDGET_SIZES.includes(w.size)) return false
    seen.add(w.widget)
    return true
  })
}

