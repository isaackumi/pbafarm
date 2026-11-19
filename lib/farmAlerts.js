/**
 * Client helpers for the Alerts & insights page (AI-001, Paper 42): group
 * early-warning rules into the page's filter categories, filter the list and
 * count the summary cards. Pure: "now" is passed in.
 */

/** Filter category of each early-warning rule (convex/lib/earlyWarning ALERT_RULES). */
export const RULE_CATEGORY = {
  mortality_spike: 'mortality',
  feed_drop: 'feed',
  fcr_deterioration: 'feed',
  growth_stall: 'feed',
  low_oxygen: 'water',
  temperature_out_of_range: 'water',
  missing_entries: 'missing',
}

export const ALERT_CATEGORIES = ['all', 'mortality', 'feed', 'water', 'missing']
export const ALERT_STATUSES = ['live', 'open', 'acknowledged', 'resolved']

export function alertCategory(rule) {
  return RULE_CATEGORY[rule] || 'other'
}

/**
 * Alerts matching a category and a status filter. 'live' means not yet
 * resolved (open or acknowledged), the page's default.
 */
export function filterAlerts(alerts, { category = 'all', status = 'live' } = {}) {
  return (alerts || []).filter((a) => {
    if (category !== 'all' && alertCategory(a.rule) !== category) return false
    if (status === 'live') return a.status !== 'resolved'
    return a.status === status
  })
}

/** Count per category among the alerts a status filter keeps (tab labels). */
export function categoryCounts(alerts, status = 'live') {
  const out = Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, 0]))
  for (const a of filterAlerts(alerts, { status })) {
    out.all += 1
    const c = alertCategory(a.rule)
    if (c in out) out[c] += 1
  }
  return out
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Summary cards: live critical and warning alerts, and alerts resolved in the last 7 days. */
export function alertSummary(alerts, now) {
  let critical = 0
  let warning = 0
  let resolved7d = 0
  for (const a of alerts || []) {
    if (a.status === 'resolved') {
      if (a.resolvedAt != null && a.resolvedAt >= now - 7 * DAY_MS) resolved7d += 1
    } else if (a.severity === 'critical') critical += 1
    else if (a.severity === 'warning') warning += 1
  }
  return { critical, warning, resolved7d }
}
