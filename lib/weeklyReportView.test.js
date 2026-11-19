import { describe, expect, it } from 'vitest'
import { COMPANY_SCOPE, defaultScope, fcrTrend, reportScopes, reportsForScope, showCosts } from './weeklyReportView'

const reports = [
  { _id: '1', locationId: 'kpong', siteName: 'Kpong', weekEnd: '2026-05-03', financeText: null },
  { _id: '2', locationId: 'ako', siteName: 'Akosombo', weekEnd: '2026-05-10', financeText: 'Costs this week: feed 10 GHS' },
  { _id: '3', locationId: null, siteName: null, weekEnd: '2026-05-10', financeText: null },
  { _id: '4', locationId: 'ako', siteName: 'Akosombo', weekEnd: '2026-05-03', financeText: '' },
]

describe('weekly report page (AI-003)', () => {
  it('lists site scopes by name, then company-wide', () => {
    const scopes = reportScopes(reports)
    expect(scopes.map((s) => s.value)).toEqual(['ako', 'kpong', COMPANY_SCOPE])
    expect(defaultScope(scopes, 'kpong')).toBe('kpong')
    expect(defaultScope(scopes, 'elsewhere')).toBe('ako')
    expect(defaultScope([], undefined)).toBeNull()
    // A site-only member gets no company-wide scope.
    expect(reportScopes([reports[0]]).map((s) => s.value)).toEqual(['kpong'])
  })

  it('orders a scope newest week first', () => {
    expect(reportsForScope(reports, 'ako').map((r) => r._id)).toEqual(['2', '4'])
    expect(reportsForScope(reports, COMPANY_SCOPE).map((r) => r._id)).toEqual(['3'])
  })

  it('shows costs only when the server sent them (finance.view)', () => {
    expect(showCosts(reports[1])).toBe(true)
    expect(showCosts(reports[0])).toBe(false)
    expect(showCosts(reports[3])).toBe(false)
    expect(showCosts({})).toBe(false)
  })

  it('reads the FCR trend; lower is better', () => {
    expect(fcrTrend({ fcr: 1.35, previousFcr: 1.38 })).toEqual({ delta: -0.03, direction: 'better' })
    expect(fcrTrend({ fcr: 1.4, previousFcr: 1.38 })).toEqual({ delta: 0.02, direction: 'worse' })
    expect(fcrTrend({ fcr: 1.2, previousFcr: null })).toBeNull()
    expect(fcrTrend(null)).toBeNull()
  })
})
