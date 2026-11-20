import { describe, expect, test } from 'vitest'
import {
  barGeometry,
  budgetPct,
  overBudgetPct,
  projectBrief,
  projectHealth,
  purchaseOrderValue,
  rollupMilestones,
  timelineWindow,
  todayOffset,
} from './projects'

describe('project rules', () => {
  test('budget % and over budget', () => {
    expect(budgetPct(521_000, 840_000)).toBe(62)
    expect(budgetPct(74_000, 60_000)).toBe(123)
    expect(budgetPct(10, 0)).toBeNull()
    expect(overBudgetPct(74_000, 60_000)).toBe(23)
    expect(overBudgetPct(50, 60)).toBe(0)
  })

  test('milestone roll-up', () => {
    expect(rollupMilestones([])).toEqual({ milestonesTotal: 0, milestonesDone: 0, progressPct: 0, nextDueDate: undefined })
    expect(
      rollupMilestones([
        { dueDate: '2026-10-20', progressPct: 100, open: false },
        { dueDate: '2027-01-12', progressPct: 0, open: true },
        { dueDate: '2026-11-28', progressPct: 60, open: true },
      ]),
    ).toEqual({ milestonesTotal: 3, milestonesDone: 1, progressPct: 53, nextDueDate: '2026-11-28' })
  })

  test('health: only open projects are at risk', () => {
    const p = { status: 'active', spent: 0, budget: 100, nextDueDate: '2026-11-01', targetEndDate: '2027-01-01' }
    expect(projectHealth(p, '2026-11-20')).toMatchObject({ lateMilestone: true, atRisk: true })
    expect(projectHealth({ ...p, status: 'done' }, '2026-11-20').atRisk).toBe(false)
    expect(projectHealth({ ...p, nextDueDate: null, spent: 101 }, '2026-11-20')).toMatchObject({ overBudget: true, atRisk: true })
    expect(projectHealth({ ...p, nextDueDate: null, targetEndDate: '2026-11-19' }, '2026-11-20').pastEnd).toBe(true)
  })

  test('timeline window and bars (Paper 20: Oct..Mar with Nov current)', () => {
    const win = timelineWindow('2026-11-20')
    expect(win.months).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
    expect(win.end).toBe('2027-04-01')
    const bar = barGeometry('2026-10-05', '2027-01-31', win)!
    expect(bar.left).toBeGreaterThan(0)
    expect(bar.left + bar.width).toBeLessThanOrEqual(100)
    expect(barGeometry('2026-01-01', '2026-02-01', win)).toBeNull()
    expect(barGeometry('2026-09-01', '2026-10-10', win)).toMatchObject({ left: 0, clippedStart: true })
    const off = todayOffset('2026-11-20', win)!
    expect(off).toBeGreaterThan(16.6)
    expect(off).toBeLessThan(33.4)
    expect(timelineWindow('2026-11-20', 6, 6).months[0]).toBe('2027-04-01')
  })

  test('brief: worst first, one item per project', () => {
    const brief = projectBrief({
      overBudget: [
        { id: 'a', name: 'Solar aeration', spent: 74, budget: 60 },
        { id: 'b', name: 'Roof', spent: 11, budget: 10 },
      ],
      lateMilestones: [{ projectId: 'a', projectName: 'Solar aeration', title: 'Wiring', dueDate: '2026-11-01', progressPct: 10 }],
      dueSoon: [
        { projectId: 'c', projectName: 'Row D', title: 'Mooring install', dueDate: '2026-11-28', progressPct: 60 },
        { projectId: 'd', projectName: 'Hatchery', title: 'Tanks', dueDate: '2026-11-25', progressPct: 95 },
      ],
    })
    expect(brief.count).toBe(3)
    expect(brief.items.map((i) => [i.kind, i.projectId])).toEqual([
      ['over_budget', 'a'],
      ['over_budget', 'b'],
      ['due_soon', 'c'],
    ])
  })

  test('purchase order value', () => {
    const lines = [{ quantityKg: 100, pricePerKg: 2, receivedKg: 90, receivedPricePerKg: 2.5 }]
    expect(purchaseOrderValue(lines, false)).toBe(200)
    expect(purchaseOrderValue(lines, true)).toBe(225)
  })
})
