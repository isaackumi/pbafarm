import { describe, expect, test } from 'vitest'
import { barTone, budgetDot, compactMoney, groupProjects } from './projectsView'

const row = (o) => ({ status: 'active', overBudget: false, atRisk: false, progressPct: 40, budgetPct: 50, ...o })

describe('projects view', () => {
  test('bar tone follows status and risk (Paper 20)', () => {
    expect(barTone(row({ status: 'planned' }))).toBe('planned')
    expect(barTone(row({ overBudget: true, atRisk: true }))).toBe('over')
    expect(barTone(row({ atRisk: true }))).toBe('risk')
    expect(barTone(row({ progressPct: 80 }))).toBe('good')
    expect(barTone(row())).toBe('normal')
  })

  test('budget dot: over budget red, near the line amber', () => {
    expect(budgetDot(row({ budgetPct: 123, overBudget: true }))).toBe('alert')
    expect(budgetDot(row({ budgetPct: 95 }))).toBe('warn')
    expect(budgetDot(row({ budgetPct: null }))).toBe('neutral')
  })

  test('grouping keeps row order and labels company-wide projects', () => {
    const rows = [
      { id: 1, locationId: 's1', locationName: 'North', ownerUserId: 'u1', ownerName: 'Ama', status: 'active' },
      { id: 2, locationId: null, locationName: null, ownerUserId: 'u1', ownerName: 'Ama', status: 'done' },
      { id: 3, locationId: 's1', locationName: 'North', ownerUserId: 'u2', ownerName: 'Yaw', status: 'active' },
    ]
    expect(groupProjects(rows, 'none')).toEqual([{ key: 'all', label: null, rows }])
    expect(groupProjects(rows, 'site', { companyWide: 'Company-wide' }).map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['North', [1, 3]],
      ['Company-wide', [2]],
    ])
    expect(groupProjects(rows, 'owner').map((g) => g.label)).toEqual(['Ama', 'Yaw'])
  })

  test('compact money', () => {
    expect(compactMoney(840_000, 'GH₵', 'en')).toBe('GH₵ 840K')
    expect(compactMoney(950, 'GH₵', 'en')).toBe('GH₵ 950')
  })
})
