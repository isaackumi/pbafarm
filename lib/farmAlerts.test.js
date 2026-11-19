import { describe, expect, it } from 'vitest'
import { ALERT_RULES } from '../convex/lib/earlyWarning'
import { RULE_CATEGORY, alertSummary, categoryCounts, filterAlerts } from './farmAlerts'

const NOW = Date.UTC(2026, 4, 14, 12)
const DAY = 24 * 60 * 60 * 1000
const alerts = [
  { _id: 'a', rule: 'mortality_spike', severity: 'critical', status: 'open' },
  { _id: 'b', rule: 'low_oxygen', severity: 'critical', status: 'acknowledged' },
  { _id: 'c', rule: 'fcr_deterioration', severity: 'warning', status: 'open' },
  { _id: 'd', rule: 'missing_entries', severity: 'info', status: 'open' },
  { _id: 'e', rule: 'feed_drop', severity: 'warning', status: 'resolved', resolvedAt: NOW - 2 * DAY },
  { _id: 'f', rule: 'temperature_out_of_range', severity: 'warning', status: 'resolved', resolvedAt: NOW - 9 * DAY },
]
const ids = (rows) => rows.map((a) => a._id)

describe('alerts page filters (AI-001)', () => {
  it('maps every early-warning rule to a category', () => {
    for (const rule of ALERT_RULES) expect(RULE_CATEGORY[rule]).toBeTruthy()
  })

  it('filters by category and status; live hides resolved', () => {
    expect(ids(filterAlerts(alerts))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(filterAlerts(alerts, { category: 'water' }))).toEqual(['b'])
    expect(ids(filterAlerts(alerts, { category: 'feed', status: 'resolved' }))).toEqual(['e'])
    expect(ids(filterAlerts(alerts, { status: 'acknowledged' }))).toEqual(['b'])
    expect(ids(filterAlerts(alerts, { category: 'water', status: 'resolved' }))).toEqual(['f'])
  })

  it('counts tabs for the current status', () => {
    expect(categoryCounts(alerts)).toEqual({ all: 4, mortality: 1, feed: 1, water: 1, missing: 1 })
    expect(categoryCounts(alerts, 'resolved')).toEqual({ all: 2, mortality: 0, feed: 1, water: 1, missing: 0 })
  })

  it('summarises live severities and resolutions in the last 7 days', () => {
    expect(alertSummary(alerts, NOW)).toEqual({ critical: 2, warning: 1, resolved7d: 1 })
    expect(alertSummary(undefined, NOW)).toEqual({ critical: 0, warning: 0, resolved7d: 0 })
  })
})
