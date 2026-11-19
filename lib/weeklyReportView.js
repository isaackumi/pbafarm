/**
 * Weekly report page helpers (AI-003, Paper 45): the scopes a reader has
 * reports for, the weeks of one scope and how a week's figures read. Pure.
 */

export const COMPANY_SCOPE = 'company'

/** Scopes with at least one report: each site (by name), then company-wide. */
export function reportScopes(reports) {
  const sites = new Map()
  let company = false
  for (const r of reports || []) {
    if (r.locationId) sites.set(r.locationId, r.siteName ?? '—')
    else company = true
  }
  const out = [...sites].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  if (company) out.push({ value: COMPANY_SCOPE, label: null })
  return out
}

/** The scope to open: the active site when it has reports, else the first one. */
export function defaultScope(scopes, activeLocationId) {
  if (activeLocationId && scopes.some((s) => s.value === activeLocationId)) return activeLocationId
  return scopes[0]?.value ?? null
}

/** A scope's reports, newest week first. */
export function reportsForScope(reports, scope) {
  return (reports || [])
    .filter((r) => (scope === COMPANY_SCOPE ? !r.locationId : r.locationId === scope))
    .sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : a.weekEnd > b.weekEnd ? -1 : 0))
}

/**
 * Costs show only when the server sent them: aiReports.list returns
 * financeText to members with finance.view and null to everyone else.
 */
export function showCosts(report) {
  return typeof report?.financeText === 'string' && report.financeText.trim().length > 0
}

/** FCR change against the week before: lower is better. Null without both weeks. */
export function fcrTrend(figures) {
  if (!figures || figures.fcr == null || figures.previousFcr == null) return null
  const delta = Math.round((figures.fcr - figures.previousFcr) * 100) / 100
  return { delta, direction: delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same' }
}
